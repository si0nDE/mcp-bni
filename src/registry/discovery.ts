import * as cheerio from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig } from './types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — see design §3.2

interface CacheEntry {
  config: BniSiteConfig;
  fetchedAt: number;
}

// Keyed by findMemberUrl, not by site id, so sites that share one URL
// (e.g. Germany + Austria) only ever trigger one real fetch.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<BniSiteConfig>>();

export class SiteDiscoveryError extends Error {
  constructor(site: BniSite, message: string) {
    super(`Could not discover config for site "${site.id}" (${site.label}): ${message}`);
    this.name = 'SiteDiscoveryError';
  }
}

export async function discoverSiteConfig(site: BniSite): Promise<BniSiteConfig> {
  const url = site.languages[0].findMemberUrl;

  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = fetchSiteConfig(site, url)
    .then((config) => {
      cache.set(url, { config, fetchedAt: Date.now() });
      inflight.delete(url);
      return config;
    })
    .catch((err) => {
      inflight.delete(url);
      throw err;
    });
  inflight.set(url, promise);
  return promise;
}

async function fetchSiteConfig(site: BniSite, url: string): Promise<BniSiteConfig> {
  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    throw new SiteDiscoveryError(site, `GET ${url} returned HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const websiteId = $('input#website_id').attr('value')?.trim();
  const countryIds = $('input[name="countryIds"]').attr('value')?.trim();

  if (!websiteId) {
    throw new SiteDiscoveryError(site, `no <input id="website_id"> found on ${url}`);
  }
  if (!countryIds) {
    throw new SiteDiscoveryError(site, `no <input name="countryIds"> found on ${url}`);
  }

  return { websiteId, countryIds };
}

/** Test-only escape hatch — clears the in-process cache between test cases. */
export function __resetDiscoveryCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
