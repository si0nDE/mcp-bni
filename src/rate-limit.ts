const lastRequestAtByHost = new Map<string, number>();

export interface RateLimitOptions {
  /** Minimum milliseconds between consecutive requests to the same host. */
  minDelayMs?: number;
}

const DEFAULT_MIN_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until at least `minDelayMs` has passed since the last call for this
 * URL's host. Call this immediately before every outbound request to a BNI
 * site — see design spec §6 for why (courtesy + BNI's own IP-ban threshold).
 */
export async function waitForRateLimit(url: string, options: RateLimitOptions = {}): Promise<void> {
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const host = new URL(url).host;
  const last = lastRequestAtByHost.get(host);
  const now = Date.now();
  if (last !== undefined) {
    const elapsed = now - last;
    if (elapsed < minDelayMs) {
      await sleep(minDelayMs - elapsed);
    }
  }
  lastRequestAtByHost.set(host, Date.now());
}

/** Convenience wrapper: rate-limits, then calls the global `fetch`. */
export async function rateLimitedFetch(
  url: string,
  init?: RequestInit,
  options?: RateLimitOptions
): Promise<Response> {
  await waitForRateLimit(url, options);
  return fetch(url, init);
}
