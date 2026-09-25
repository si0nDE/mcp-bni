import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { stripAcademicTitle, detectLeaderFunctions } from '../taxonomy';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';

export interface BniMemberDetail {
  name: string;
  encryptedMemberId: string;
  chapter: string;
  /** The chapter's own encoded id, extracted from its profile link — pass to chapter-info.ts to resolve meeting details. */
  chapterId?: string;
  profession: string;
  company: string;
  profileUrl: string;
  phone?: string;
  email?: string;
  website?: string;
  bio?: string;
  title?: string;
  leaderFunctions?: string[];
}

/** Extracts and decodes a query-string parameter from a (possibly relative) URL/href string. */
export function extractEncodedParam(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`[?&]${key}=([^&]+)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function buildProfileUrl(findMemberUrl: string, encryptedMemberId: string, name: string): URL {
  const url = new URL(findMemberUrl);
  url.pathname = url.pathname.replace(/\/[^/]*$/, '/memberdetails');
  url.search = '';
  url.searchParams.set('encryptedMemberId', encryptedMemberId);
  url.searchParams.set('name', name);
  return url;
}

export async function getMemberDetail(
  site: BniSite,
  config: BniSiteConfig,
  encryptedMemberId: string,
  name: string,
  language?: BniSiteLanguage
): Promise<BniMemberDetail | null> {
  const lang = language ?? site.languages[0];
  const profileUrl = buildProfileUrl(lang.findMemberUrl, encryptedMemberId, name);

  const innerParams = new URLSearchParams();
  innerParams.set('encryptedMemberId', encryptedMemberId);
  innerParams.set('name', name);

  const body = new URLSearchParams();
  body.set('parameters', innerParams.toString());
  body.set('languages[activeLanguage][id]', '1');
  body.set('languages[activeLanguage][localeCode]', lang.locale);
  body.set('languages[activeLanguage][descriptionKey]', lang.locale);
  body.set('pageMode', 'Live_Site');
  body.set('websitetype', '1');
  body.set('website_type', '1');
  body.set('website_id', config.websiteId);
  body.set('memberId', encryptedMemberId);

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/memberdetail/display`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: profileUrl.toString(),
    },
    body: body.toString(),
  });

  if (!res.ok) return null;
  const html = await res.text();
  if (!html.trim()) return null;

  const $ = load(html);
  const getText = (selector: string) => $(selector).first().text().trim();

  const phone = $("a[href^='tel:']").first().attr('href')?.replace('tel:', '').trim() || undefined;
  const email = $("a[href^='mailto:']").first().attr('href')?.replace('mailto:', '').trim() || undefined;

  const ownHost = new URL(site.baseUrl).hostname;
  const excludedHosts = [ownHost, 'facebook.com', 'linkedin.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com'];
  let website: string | undefined;
  $("a[href^='http']").each((_, el) => {
    if (website) return;
    const href = $(el).attr('href') ?? '';
    if (!excludedHosts.some((host) => href.includes(host))) {
      website = href;
    }
  });

  let chapter = '';
  let chapterId: string | undefined;
  $('strong').each((_, el) => {
    if (chapter) return;
    if ($(el).text().trim().toLowerCase() === 'chapter') {
      const link = $(el).parent().find('a').first();
      chapter = link.text().trim();
      chapterId = extractEncodedParam(link.attr('href') ?? '', 'chapterId');
    }
  });

  const bio =
    $('.widgetMemberTxtVideo p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join('\n\n') || undefined;

  const pageTitle = $('h2').first().text().trim();
  const { title, name: cleanName } = await stripAcademicTitle(pageTitle || name);
  const leaderFunctions = await detectLeaderFunctions(bio);

  return {
    name: cleanName,
    encryptedMemberId,
    chapter,
    chapterId,
    profession: getText('h6'),
    company: $('h2').first().next('p').text().trim(),
    profileUrl: profileUrl.toString(),
    phone,
    email,
    website,
    bio,
    title,
    leaderFunctions: leaderFunctions.length > 0 ? leaderFunctions : undefined,
  };
}
