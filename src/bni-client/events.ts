import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';

export interface BniEvent {
  id: number;
  title: string;
  description?: string;
  start: string;
  end?: string;
  url: string;
}

/** Public event calendar for a site. Issues one request per internal country ID (the endpoint only accepts one at a time) and merges results. */
export async function getUpcomingEvents(
  site: BniSite,
  config: BniSiteConfig,
  daysAhead: number
): Promise<BniEvent[]> {
  const start = new Date();
  const end = new Date(start.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

  const countryIds = config.countryIds.split(',').map((c) => c.trim());
  const eventsById = new Map<number, BniEvent>();

  for (const countryId of countryIds) {
    const params = new URLSearchParams();
    params.set('countryId', countryId);
    params.set('regionIds', '');
    params.set('eventTypeId', '0');
    params.set('cmsv3', 'true');
    params.set('start', toIsoDate(start));
    params.set('end', toIsoDate(end));

    const res = await rateLimitedFetch(`${site.baseUrl}/web/open/cmsViewEventsCalendarJson?${params.toString()}`);
    if (!res.ok) continue;

    const items = (await res.json()) as BniEvent[];
    for (const item of items) {
      eventsById.set(item.id, item);
    }
  }

  return [...eventsById.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export interface BniEventDetail {
  title: string;
  description?: string;
  contactName?: string;
  contactPhone?: string;
  costMembers?: string;
  costNonMembers?: string;
  location?: string;
  registrationCount?: number;
}

/**
 * Fetches full event details. Box labels (e.g. "Contact person:") were found
 * during design research to sometimes render empty/untranslated depending
 * on request parameters — this extracts by DOM structure instead (which box
 * contains `.contactPersonDetail` vs `.address`), which is reliable
 * regardless of label localization.
 */
export async function getEventDetail(
  site: BniSite,
  config: BniSiteConfig,
  encodedEventId: string,
  language?: BniSiteLanguage
): Promise<BniEventDetail | null> {
  const lang = language ?? site.languages[0];

  const innerParams = new URLSearchParams();
  innerParams.set('eventId', encodedEventId);

  const body = new URLSearchParams();
  body.set('parameters', innerParams.toString());
  body.set('languages[availableLanguages][0][type]', 'published');
  body.set('languages[availableLanguages][0][url]', lang.findMemberUrl);
  body.set('languages[availableLanguages][0][descriptionKey]', lang.locale);
  body.set('languages[availableLanguages][0][id]', '1');
  body.set('languages[availableLanguages][0][localeCode]', lang.locale);
  body.set('languages[activeLanguage][id]', '1');
  body.set('languages[activeLanguage][localeCode]', lang.locale);
  body.set('languages[activeLanguage][descriptionKey]', lang.locale);
  body.set('cmsv3', 'true');
  body.set('pageMode', 'Live_Site');
  body.set('website_type', '1');
  body.set('website_id', config.websiteId);
  body.set('eventId', encodedEventId);

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/eventdetail/display`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  });
  if (!res.ok) return null;

  const html = await res.text();
  if (!html.trim() || html.includes('document.location.href')) return null;

  const $ = load(html);
  const title = $('h2').first().text().trim();
  if (!title) return null;

  const description = $('.threeColRow > div').first().text().replace(/\s+/g, ' ').trim() || undefined;

  const contactBox = $('.box')
    .filter((_, el) => $(el).find('.contactPersonDetail').length > 0)
    .first();
  const locationBox = $('.box')
    .filter((_, el) => $(el).find('.address').length > 0)
    .first();

  let contactName: string | undefined;
  let contactPhone: string | undefined;
  if (contactBox.length) {
    const raw = contactBox.find('.rCol p').first().clone();
    raw.find('br').replaceWith('\n');
    const lines = raw
      .text()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    contactName = lines[0];
    contactPhone = lines.find((l) => /tel|phone/i.test(l))?.replace(/^[^:]*:\s*/, '');
  }

  const costMembers = contactBox.length ? contactBox.find('h4').eq(0).text().trim() || undefined : undefined;
  const costNonMembers = contactBox.length ? contactBox.find('h4').eq(1).text().trim() || undefined : undefined;

  let location: string | undefined;
  let registrationCount: number | undefined;
  if (locationBox.length) {
    const addressEl = locationBox.find('.address').first().clone();
    addressEl.find('br').replaceWith(', ');
    location =
      addressEl
        .text()
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
        .trim()
        .replace(/,$/, '') || undefined;
    const regText = locationBox.find('h4').last().text().trim();
    const regMatch = regText.match(/(\d+)/);
    if (regMatch) registrationCount = parseInt(regMatch[1], 10);
  }

  return { title, description, contactName, contactPhone, costMembers, costNonMembers, location, registrationCount };
}
