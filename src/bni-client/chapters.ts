import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';
import { getRegionsForCountryId } from './regions';

export interface BniChapterOption {
  /** The internal id BNI's own filter form uses for this chapter — pass to searchMembers as `chapterId`. */
  id: string;
  name: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // chapter existence changes rarely, but not never.

interface CacheEntry {
  options: BniChapterOption[];
  fetchedAt: number;
}

// Keyed by site id, not by the underlying page URL: the region-fan-out result (see below) depends
// on config.countryIds, which can legitimately differ between two sites sharing one URL.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<BniChapterOption[]>>();

/**
 * The complete chapter list for a country, resolved by whichever of two sources this site
 * actually has data for — a static dropdown, or (when that's empty) a live region-by-region
 * fan-out. Not subject to keyword matching or bni_search's ~250 result cap either way, so a
 * chapter matched by `id` from here gets its exact, complete roster.
 */
export async function listChapterOptions(
  site: BniSite,
  config: BniSiteConfig,
  language?: BniSiteLanguage
): Promise<BniChapterOption[]> {
  const cached = cache.get(site.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.options;

  const existing = inflight.get(site.id);
  if (existing) return existing;

  const promise = resolveChapterOptions(site, config, language)
    .then((options) => {
      cache.set(site.id, { options, fetchedAt: Date.now() });
      inflight.delete(site.id);
      return options;
    })
    .catch((err) => {
      inflight.delete(site.id);
      throw err;
    });
  inflight.set(site.id, promise);
  return promise;
}

async function resolveChapterOptions(
  site: BniSite,
  config: BniSiteConfig,
  language?: BniSiteLanguage
): Promise<BniChapterOption[]> {
  const staticOptions = await scrapeStaticChapterOptions(site, language);
  if (staticOptions.length > 0) return staticOptions;
  return fetchChaptersViaRegionFanOut(site, config);
}

/**
 * Reads the site's own "find a member" page and extracts its chapter filter dropdown, if the
 * markup renders it server-side with its options already populated. Returns [] when it doesn't
 * (either no such dropdown, or one populated client-side by JS after the page loads — see
 * fetchChaptersViaRegionFanOut for that case) so callers fall back to the region fan-out below.
 */
async function scrapeStaticChapterOptions(site: BniSite, language?: BniSiteLanguage): Promise<BniChapterOption[]> {
  const lang = language ?? site.languages[0];
  const res = await rateLimitedFetch(lang.findMemberUrl);
  if (!res.ok) return [];

  const html = await res.text();
  const $ = load(html);
  const select = $('select[name="chapterName"]');
  if (!select.length) return [];

  const options: BniChapterOption[] = [];
  const seen = new Set<string>();
  select.find('option').each((_, el) => {
    const id = $(el).attr('value')?.trim();
    const chapterName = $(el).text().trim();
    if (!id || id === '0' || !chapterName || seen.has(id)) return;
    seen.add(id);
    options.push({ id, name: chapterName });
  });
  return options;
}

/**
 * Live-verified (bni.de, 2026-09-25): the "find a member" page's #chapterName <select> exists in
 * the static markup but is populated client-side by JS after a region is picked — the initial page
 * fetch alone (scrapeStaticChapterOptions) never sees any <option>s, even though BNI's own site
 * clearly has this data. The JS itself calls
 * POST /web/open/appsCmsNationalMemberSearchFilterJson with {countryId, regionId}, which returns
 * {chapters: [{id, name}]} for that one region (confirmed live: for Würzburg-Erlangen this
 * includes "Juwel Würzburg", id 36852 — matching bni_member_detail's own independently-derived
 * chapterId exactly). There is no "every chapter at once" variant of this endpoint (confirmed
 * live: omitting regionId returns regions/areas but no chapters), so this fans out over every
 * region for the site's own country id(s) and merges — the same per-country-id fan-out shape
 * getRegions already uses, reused here via getRegionsForCountryId.
 */
async function fetchChaptersViaRegionFanOut(site: BniSite, config: BniSiteConfig): Promise<BniChapterOption[]> {
  const countryIds = config.countryIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const chaptersById = new Map<string, BniChapterOption>();
  for (const countryId of countryIds) {
    const regions = await getRegionsForCountryId(site, countryId);
    for (const region of regions) {
      const chapters = await fetchChaptersForRegion(site, countryId, region.id);
      for (const chapter of chapters) chaptersById.set(chapter.id, chapter);
    }
  }

  return [...chaptersById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchChaptersForRegion(site: BniSite, countryId: string, regionId: number): Promise<BniChapterOption[]> {
  const body = new URLSearchParams({ countryId, regionId: String(regionId) });
  const res = await rateLimitedFetch(
    `${site.baseUrl}/web/open/appsCmsNationalMemberSearchFilterJson?&request_locale=en&siteLocale=en`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    }
  );
  if (!res.ok) return [];

  const data = (await res.json()) as { chapters?: Array<{ id: number; name: string }> };
  return (data.chapters ?? []).map((c) => ({ id: String(c.id), name: c.name }));
}

/** Test-only escape hatch — clears the in-process cache between test cases. */
export function __resetChapterCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export interface ChapterMatch {
  /** The single confidently-resolved option, if any (an exact name match, or the one option containing the query). */
  match?: BniChapterOption;
  /** Populated only when ambiguous: 2+ options contain the query and none matched it exactly — the caller decides, rather than one being silently picked. */
  candidates: BniChapterOption[];
}

/**
 * Resolves `chapterName` against a site's chapter dropdown. An exact case-insensitive name match
 * wins outright; otherwise every option whose name contains the query is a candidate. Exactly one
 * candidate becomes `match` (this used to just be "the first substring match wins"); two or more
 * are surfaced as `candidates` instead, since a generic query (e.g. a city shared by several
 * chapters) could otherwise silently resolve to the wrong one with no signal anything was unsure.
 */
export function matchChapterOption(options: BniChapterOption[], chapterName: string): ChapterMatch {
  const norm = chapterName.trim().toLowerCase();
  if (!norm) return { candidates: [] };

  const exact = options.find((o) => o.name.toLowerCase() === norm);
  if (exact) return { match: exact, candidates: [] };

  const substringMatches = options.filter((o) => o.name.toLowerCase().includes(norm));
  if (substringMatches.length === 1) return { match: substringMatches[0], candidates: [] };
  if (substringMatches.length > 1) return { candidates: substringMatches };
  return { candidates: [] };
}
