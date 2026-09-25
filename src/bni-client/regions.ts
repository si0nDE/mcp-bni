import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig } from '../registry/types';

export interface BniRegion {
  id: number;
  name: string;
}

/** Official regions for a site — one request per internal country id, merged. */
export async function getRegions(site: BniSite, config: BniSiteConfig): Promise<BniRegion[]> {
  const countryIds = config.countryIds.split(',').map((c) => c.trim());
  const regionsById = new Map<number, BniRegion>();

  for (const countryId of countryIds) {
    const params = new URLSearchParams();
    params.set('countryId', countryId);
    params.set('request_locale', 'en');
    params.set('siteLocale', 'en');

    const res = await rateLimitedFetch(`${site.baseUrl}/web/open/appsCmsRegionListByCountryIdJson?${params.toString()}`);
    if (!res.ok) continue;

    const items = (await res.json()) as Array<{ id: number; name: string }>;
    for (const item of items) {
      regionsById.set(item.id, { id: item.id, name: item.name });
    }
  }

  return [...regionsById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Official event-type category names for a site. IDs are internally
 * country-specific even for the "same" conceptual type (confirmed during
 * design research — the same type has a different numeric id per country),
 * so this returns names only, with the trailing " - <Country>" suffix
 * stripped and duplicates merged. Only a dash set off by whitespace on both
 * sides is treated as a country suffix — a bare hyphen joining two words of
 * the same name (e.g. "Mitglieder-Erfolgs-Training") is left untouched. This
 * covers every case observed this session, but is a heuristic, not a
 * guarantee for every possible country name shape.
 */
export async function getEventTypeNames(site: BniSite, config: BniSiteConfig): Promise<string[]> {
  const countryIds = config.countryIds.split(',').map((c) => c.trim());
  const names = new Set<string>();

  for (const countryId of countryIds) {
    const params = new URLSearchParams();
    params.set('countryId', countryId);
    params.set('request_locale', 'en');
    params.set('siteLocale', 'en');

    const res = await rateLimitedFetch(
      `${site.baseUrl}/web/open/appsCmsEventTypesForNationalWebsiteJson?${params.toString()}`
    );
    if (!res.ok) continue;

    const items = (await res.json()) as Array<{ id: number; name: string }>;
    for (const item of items) {
      // Only strip a " - <Country>" suffix set off by actual whitespace on both sides of the
      // dash (as BNI renders it) — NOT a bare hyphen joining two words of the same name, e.g.
      // "Mitglieder-Erfolgs-Training" must survive intact.
      names.add(item.name.replace(/ - [A-Za-z][A-Za-z\s]*$/, '').trim());
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}
