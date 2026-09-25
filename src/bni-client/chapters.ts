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

/** Finds the option whose name matches `chapterName` exactly, else the first that contains it (both case-insensitive). */
export function findChapterOption(options: BniChapterOption[], chapterName: string): BniChapterOption | undefined {
  const norm = chapterName.trim().toLowerCase();
  if (!norm) return undefined;
  return (
    options.find((o) => o.name.toLowerCase() === norm) ??
    options.find((o) => o.name.toLowerCase().includes(norm))
  );
}
