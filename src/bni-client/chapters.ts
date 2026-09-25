import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteLanguage } from '../registry/types';

export interface BniChapterOption {
  /** The internal id BNI's own filter form uses for this chapter — pass to searchMembers as `chapterId`. */
  id: string;
  name: string;
}

/**
 * Reads the site's own "find a member" page and extracts its chapter filter dropdown, if present.
 * This is the same list BNI's own UI uses to scope a search to one chapter, so a member fetched by
 * `id` from here is not subject to keyword matching or its result cap — the caller gets that
 * chapter's exact, complete roster. Returns [] for sites whose page doesn't expose this dropdown
 * (older markup, or a region-only filter) so callers can fall back to keyword search.
 */
export async function listChapterOptions(site: BniSite, language?: BniSiteLanguage): Promise<BniChapterOption[]> {
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
