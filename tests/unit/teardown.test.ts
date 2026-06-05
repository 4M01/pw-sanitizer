import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// We mock the `sanitize` export from `../../src/index.js` before importing
// the teardown module so the teardown function uses the mocked version.
// ---------------------------------------------------------------------------

vi.mock('../../src/index.js', () => ({
  sanitize: vi.fn(),
}));

import teardown from '../../src/teardown.js';
import { sanitize } from '../../src/index.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('teardown', () => {
  it('calls sanitize() with no arguments', async () => {
    vi.mocked(sanitize).mockResolvedValue([]);

    await teardown();

    expect(sanitize).toHaveBeenCalledOnce();
    expect(sanitize).toHaveBeenCalledWith();
  });

  it('does not throw when sanitize() rejects — logs error instead', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sanitize).mockRejectedValue(new Error('sanitize failed'));

    await expect(teardown()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('sanitize failed')
    );

    errorSpy.mockRestore();
  });

  it('handles non-Error rejections gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sanitize).mockRejectedValue('string-rejection');

    await expect(teardown()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('string-rejection')
    );

    errorSpy.mockRestore();
  });
});
