import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';

export interface BniMember {
  name: string;
  encryptedMemberId: string;
  chapter: string;
  region: string;
  city: string;
  district: string;
  profession: string;
  company: string;
  profileUrl: string;
}

export interface SearchParams {
  keywords?: string;
  city?: string;
  /** A chapter id from listChapterOptions — scopes the query to that chapter's exact, complete roster instead of a keyword match (and its ~250 result cap). Takes precedence over `keywords` when both are set. */
  chapterId?: string;
  language?: BniSiteLanguage;
}

/** Swaps the last path segment of a site's "find a member" URL for "memberdetails" — verified live for bni.de and bnifrance.fr. */
function buildDetailBaseUrl(findMemberUrl: string): URL {
  const url = new URL(findMemberUrl);
  url.pathname = url.pathname.replace(/\/[^/]*$/, '/memberdetails');
  url.search = '';
  return url;
}

export async function searchMembers(
  site: BniSite,
  config: BniSiteConfig,
  params: SearchParams
): Promise<BniMember[]> {
  const language = params.language ?? site.languages[0];
  const findMemberUrl = language.findMemberUrl;

  const innerParams = new URLSearchParams();
  innerParams.set('countryIds', config.countryIds);
  innerParams.set('keywords', params.chapterId ? '' : params.keywords ?? '');
  if (params.city) innerParams.set('city', params.city);
  // Matches the value attribute of the site's own chapterName <select> (see chapters.ts) —
  // scoping by this id returns the chapter's exact roster, not a keyword match.
  if (params.chapterId) innerParams.set('chapterName', params.chapterId);
  innerParams.set('submit', '');

  const body = new URLSearchParams();
  body.set('parameters', innerParams.toString());
  body.set('languages[availableLanguages][0][type]', 'published');
  body.set('languages[availableLanguages][0][url]', findMemberUrl);
  body.set('languages[availableLanguages][0][descriptionKey]', language.locale);
  body.set('languages[availableLanguages][0][id]', '1');
  body.set('languages[availableLanguages][0][localeCode]', language.locale);
  body.set('languages[activeLanguage][id]', '1');
  body.set('languages[activeLanguage][localeCode]', language.locale);
  body.set('languages[activeLanguage][descriptionKey]', language.locale);
  body.set('languages[activeLanguage][cookieBotCode]', language.locale.split('-')[0]);
  body.set('cmsv3', 'true');
  body.set('website_type', '1');
  body.set('website_id', config.websiteId);
  body.set('pageMode', 'Live_Site');

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/memberlist/display`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: findMemberUrl,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`BNI member search failed for site "${site.id}": HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = load(html);
  const members: BniMember[] = [];
  const seen = new Set<string>();
  const detailBaseUrl = buildDetailBaseUrl(findMemberUrl);

  $('table tr, tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return;

    const nameLink = $(cells[1]).find('a');
    if (!nameLink.length) return;

    const name = nameLink.text().trim();
    if (!name || seen.has(name)) return;

    const href = nameLink.attr('href') ?? '';
    const idMatch = href.match(/encryptedMemberId=([^&]+)/);
    // Never emit a member with a guessed/blank id — skip the row instead of returning partial data.
    if (!idMatch) return;
    const encryptedMemberId = decodeURIComponent(idMatch[1]);
    seen.add(name);

    const chapterFull = $(cells[2]).text().trim();
    const dashIdx = chapterFull.indexOf(' - ');
    const chapter = dashIdx > -1 ? chapterFull.slice(0, dashIdx).trim() : chapterFull;
    const region = dashIdx > -1 ? chapterFull.slice(dashIdx + 3).trim() : '';

    const city = $(cells[3]).text().trim();
    const district = $(cells[4]).text().trim();

    const professionRaw = $(cells[5]).text().trim();
    const professionLeaf = professionRaw.includes('>')
      ? professionRaw.split('>').pop()?.trim() ?? professionRaw
      : professionRaw;
    // Leaf segments carry a trailing "[code]" (e.g. "Steuerberatung [690030]") — strip it to get the display name.
    const profession = professionLeaf.replace(/\s*\[[^\]]*\]\s*$/, '').trim();

    const company = $(cells[6]).text().trim();

    const profileUrl = new URL(detailBaseUrl.toString());
    profileUrl.searchParams.set('encryptedMemberId', encryptedMemberId);
    profileUrl.searchParams.set('name', name);

    members.push({
      name,
      encryptedMemberId,
      chapter,
      region,
      city,
      district,
      profession,
      company,
      profileUrl: profileUrl.toString(),
    });
  });

  return members;
}
