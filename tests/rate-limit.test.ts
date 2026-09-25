import { describe, it, expect } from 'vitest';
import { waitForRateLimit } from '../src/rate-limit';

describe('waitForRateLimit', () => {
  it('delays a second call to the same host by at least minDelayMs', async () => {
    const url = 'https://example-a.test/path';
    await waitForRateLimit(url, { minDelayMs: 150 });
    const start = Date.now();
    await waitForRateLimit(url, { minDelayMs: 150 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(140); // small tolerance
  });

  it('does not delay calls to different hosts', async () => {
    await waitForRateLimit('https://example-b.test/path', { minDelayMs: 300 });
    const start = Date.now();
    await waitForRateLimit('https://example-c.test/path', { minDelayMs: 300 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
