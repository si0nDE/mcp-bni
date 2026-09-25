import { BNI_SITES } from './sites';
import { BniSite } from './types';

export interface ResolvedSites {
  sites: BniSite[];
  totalKnown: number;
}

/** Resolves every registered site for a country code, applying the fan-out cap (design §3.3). Defaults to the real registry; tests inject a smaller list. */
export function resolveSitesForCountry(
  countryCode: string,
  fanOutCap = 5,
  sites: BniSite[] = BNI_SITES
): ResolvedSites {
  const matches = sites.filter((s) => s.countryCode.toLowerCase() === countryCode.toLowerCase());
  return { sites: matches.slice(0, fanOutCap), totalKnown: matches.length };
}

/** Finds one specific site by its id — for tools that already know which site to use. */
export function resolveSiteById(siteId: string, sites: BniSite[] = BNI_SITES): BniSite | undefined {
  return sites.find((s) => s.id === siteId);
}
