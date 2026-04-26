/**
 * Optional screenshot redaction module.
 *
 * When `output.redactScreenshots` is `true`, this module is used to blur
 * pixel regions of screenshots captured during a Playwright test run. Regions
 * are identified by mapping CSS selectors from redact patterns to pixel
 * coordinates recorded in the trace.
 *
 * **Current status**: placeholder implementation. The function signature and
 * `sharp` integration skeleton are in place, but the coordinate-mapping logic
 * and blur overlay are not yet implemented. Requires the optional `sharp`
 * peer dependency (`npm install sharp`).
 */
/**
 * Applies pixel-level redaction to a screenshot buffer by blurring the
 * specified rectangular regions.
 *
 * @remarks
 * This is a **placeholder** — the function currently returns the original
 * buffer unchanged. A full implementation would use `sharp` to composite
 * blurred rectangles over the matching coordinates.
 *
 * If `sharp` is not installed, a warning is logged and the original buffer
 * is returned (no-op behaviour).
 *
 * @param _screenshotBuffer - The raw PNG/JPEG screenshot buffer from the trace archive.
 * @param _regions          - Pixel-coordinate rectangles to blur (x, y, width, height — all in px).
 * @returns The (potentially blurred) screenshot buffer.
 *   Currently always returns `_screenshotBuffer` unchanged.
 */
export declare function redactScreenshot(_screenshotBuffer: Buffer, _regions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
}>): Promise<Buffer>;
//# sourceMappingURL=screenshot.d.ts.map