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
export declare function redactScreenshot(screenshotBuffer: Buffer, regions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
}>): Promise<Buffer>;
//# sourceMappingURL=screenshot.d.ts.map