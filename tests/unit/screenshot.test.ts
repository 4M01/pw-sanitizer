import { describe, it, expect, vi, afterEach } from 'vitest';
import { redactScreenshot } from '../../src/processors/screenshot.js';

afterEach(() => vi.restoreAllMocks());

describe('redactScreenshot', () => {
  it('returns the original buffer immediately when regions is empty', async () => {
    const buf = Buffer.from([1, 2, 3]);
    const result = await redactScreenshot(buf, []);
    expect(result).toBe(buf);
  });

  it('returns the original buffer and logs a warning when sharp is not installed', async () => {
    // Force the dynamic import of 'sharp' to fail
    vi.doMock('sharp', () => {
      throw new Error('Cannot find module sharp');
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buf = Buffer.from([1, 2, 3]);

    const result = await redactScreenshot(buf, [{ x: 0, y: 0, width: 10, height: 10 }]);

    expect(result).toBe(buf);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sharp')
    );
  });
});
