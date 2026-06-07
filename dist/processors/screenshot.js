"use strict";
/**
 * Optional screenshot redaction module.
 *
 * When `output.redactScreenshots` is `true`, this module is used to blur
 * pixel regions of screenshots captured during a Playwright test run. Regions
 * are identified by mapping CSS selectors from redact patterns to pixel
 * coordinates recorded in the trace.
 *
 * Requires the optional `sharp` peer dependency (`npm install sharp`).
 * Falls back to a no-op (returning the original buffer) when `sharp` is absent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactScreenshot = redactScreenshot;
const logger_js_1 = require("../logger.js");
/**
 * Applies pixel-level redaction to a screenshot buffer by blurring the
 * specified rectangular regions.
 *
 * For each region the function:
 * 1. Extracts the pixel rectangle from the original image.
 * 2. Applies a Gaussian blur (sigma = 20) to the extracted patch.
 * 3. Composites the blurred patch back over the original at the same position.
 *
 * Regions that fall entirely outside the image bounds are silently skipped.
 * If `regions` is empty, the original buffer is returned immediately.
 *
 * If `sharp` is not installed, a warning is logged and the original buffer is
 * returned unchanged.
 *
 * @param screenshotBuffer - The raw PNG/JPEG screenshot buffer from the trace archive.
 * @param regions          - Pixel-coordinate rectangles to blur (x, y, width, height — all in px).
 * @returns The (potentially blurred) screenshot buffer.
 */
async function redactScreenshot(screenshotBuffer, regions) {
    if (regions.length === 0)
        return screenshotBuffer;
    let sharp;
    try {
        // Dynamic import to respect optional peer dependency.
        // The variable indirection prevents TypeScript from resolving the module at
        // compile time and avoids a hard dependency on @types/sharp.
        const sharpModule = 'sharp';
        const mod = await import(sharpModule);
        sharp = mod.default;
    }
    catch {
        logger_js_1.logger.warn('Screenshot redaction requires the "sharp" package. ' +
            'Install it with: npm install sharp');
        return screenshotBuffer;
    }
    try {
        const image = sharp(screenshotBuffer);
        const metadata = await image.metadata();
        const imgWidth = metadata.width ?? 0;
        const imgHeight = metadata.height ?? 0;
        const composites = [];
        for (const region of regions) {
            const left = Math.max(0, Math.round(region.x));
            const top = Math.max(0, Math.round(region.y));
            const width = Math.max(1, Math.min(Math.round(region.width), imgWidth - left));
            const height = Math.max(1, Math.min(Math.round(region.height), imgHeight - top));
            // Skip regions that are entirely outside the image
            if (left >= imgWidth || top >= imgHeight || width <= 0 || height <= 0) {
                logger_js_1.logger.verbose(`Screenshot redaction: skipping out-of-bounds region ` +
                    `(x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height})`);
                continue;
            }
            const blurredPatch = await sharp(screenshotBuffer)
                .extract({ left, top, width, height })
                .blur(20)
                .toBuffer();
            composites.push({ input: blurredPatch, left, top });
        }
        if (composites.length === 0)
            return screenshotBuffer;
        logger_js_1.logger.verbose(`Screenshot redaction: blurring ${composites.length} region(s)`);
        return image.composite(composites).toBuffer();
    }
    catch (err) {
        logger_js_1.logger.warn(`Screenshot redaction failed: ${err instanceof Error ? err.message : String(err)}. ` +
            'Returning original screenshot.');
        return screenshotBuffer;
    }
}
//# sourceMappingURL=screenshot.js.map