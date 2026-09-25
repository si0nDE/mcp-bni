import * as cheerio from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig } from './types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — see design §3.2

interface RawSiteConfig {
  websiteId: string;
  /** Exactly as found on the page — for a site shared by more than one country (see below), this is every country's id combined, not just this one's. */
  countryIds: string;
}

interface CacheEntry<T> {
  config: T;
  fetchedAt: number;
}

// The page fetch is keyed by findMemberUrl, not by site id, so sites that share one URL (e.g.
// Germany + Austria) only ever trigger one real page fetch — narrowing (below) then still gives
// each of them its own correct, distinct countryIds from that one shared fetch.
const rawCache = new Map<string, CacheEntry<RawSiteConfig>>();
const rawInflight = new Map<string, Promise<RawSiteConfig>>();

// The final, per-site config is cached by site id: unlike the raw page data, it can legitimately
// differ between two sites that share a URL (see narrowCountryIds).
const resolvedCache = new Map<string, CacheEntry<BniSiteConfig>>();
const resolvedInflight = new Map<string, Promise<BniSiteConfig>>();

export class SiteDiscoveryError extends Error {
  constructor(site: BniSite, message: string) {
    super(`Could not discover config for site "${site.id}" (${site.label}): ${message}`);
    this.name = 'SiteDiscoveryError';
  }
}

export async function discoverSiteConfig(site: BniSite): Promise<BniSiteConfig> {
  const cached = resolvedCache.get(site.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const existing = resolvedInflight.get(site.id);
  if (existing) return existing;

  const promise = resolveSiteConfig(site)
    .then((config) => {
      resolvedCache.set(site.id, { config, fetchedAt: Date.now() });
      resolvedInflight.delete(site.id);
      return config;
    })
    .catch((err) => {
      resolvedInflight.delete(site.id);
      throw err;
    });
  resolvedInflight.set(site.id, promise);
  return promise;
}

async function resolveSiteConfig(site: BniSite): Promise<BniSiteConfig> {
  const raw = await getRawSiteConfig(site);
  const countryIds = await narrowCountryIds(site, raw.countryIds);
  return { websiteId: raw.websiteId, countryIds };
}

async function getRawSiteConfig(site: BniSite): Promise<RawSiteConfig> {
  const url = site.languages[0].findMemberUrl;

  const cached = rawCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const existing = rawInflight.get(url);
  if (existing) return existing;

  const promise = fetchRawSiteConfig(site, url)
    .then((config) => {
      rawCache.set(url, { config, fetchedAt: Date.now() });
      rawInflight.delete(url);
      return config;
    })
    .catch((err) => {
      rawInflight.delete(url);
      throw err;
    });
  rawInflight.set(url, promise);
  return promise;
}

async function fetchRawSiteConfig(site: BniSite, url: string): Promise<RawSiteConfig> {
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

/**
 * Some sites serve more than one of our registry's countries from one shared database (Germany +
 * Austria on bni.de, confirmed live: both registry entries' findMemberUrl resolves to the same
 * page, with countryIds="5723,5768" naming both). Passing that combined value straight through
 * (the previous behavior) meant every query for either country silently also returned the other
 * country's members/regions/events/event-types — there was no way to ask for just one.
 *
 * BNI's own page already resolves this ambiguity for its own country dropdown, via a live
 * endpoint that maps each id in `countryIds` to its actual country name (confirmed live:
 * id 5723 → "Austria", id 5768 → "Germany"). This narrows to just the one id whose name matches
 * this site's own registry `label` — nothing hardcoded or guessed. A site representing exactly
 * one id already (every other registry entry today) is returned unchanged without the extra
 * request. If the lookup is unreachable, or no id's name matches this site's label (e.g.
 * Switzerland's single registry entry deliberately covers two countries under one combined
 * label — see sites.ts), this degrades to the previous combined behavior rather than failing the
 * whole discovery.
 */
async function narrowCountryIds(site: BniSite, rawCountryIds: string): Promise<string> {
  const ids = rawCountryIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length <= 1) return rawCountryIds;

  try {
    const params = new URLSearchParams({ countryIds: rawCountryIds, request_locale: 'en', siteLocale: 'en' });
    const res = await rateLimitedFetch(`${site.baseUrl}/web/open/appsCmsCountryListJson?${params.toString()}`);
    if (!res.ok) return rawCountryIds;

    const items = (await res.json()) as Array<{ id: number; name: string }>;
    const match = items.find((item) => item.name.trim().toLowerCase() === site.label.trim().toLowerCase());
    return match ? String(match.id) : rawCountryIds;
  } catch {
    return rawCountryIds;
  }
}

/** Test-only escape hatch — clears the in-process cache between test cases. */
export function __resetDiscoveryCacheForTests(): void {
  rawCache.clear();
  rawInflight.clear();
  resolvedCache.clear();
  resolvedInflight.clear();
}
