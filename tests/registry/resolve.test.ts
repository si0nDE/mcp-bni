import { describe, it, expect } from 'vitest';
import { resolveSitesForCountry, resolveSiteById } from '../../src/registry/resolve';
import { BniSite } from '../../src/registry/types';

const testSites: BniSite[] = [
  { id: 'a', countryCode: 'US', label: 'A', baseUrl: 'https://a.test', languages: [{ locale: 'en', findMemberUrl: 'https://a.test/en/findamember' }] },
  { id: 'b', countryCode: 'US', label: 'B', baseUrl: 'https://b.test', languages: [{ locale: 'en', findMemberUrl: 'https://b.test/en/findamember' }] },
  { id: 'c', countryCode: 'US', label: 'C', baseUrl: 'https://c.test', languages: [{ locale: 'en', findMemberUrl: 'https://c.test/en/findamember' }] },
  { id: 'de', countryCode: 'DE', label: 'Germany', baseUrl: 'https://d.test', languages: [{ locale: 'de', findMemberUrl: 'https://d.test/de/findamember' }] },
];

describe('resolveSitesForCountry', () => {
  it('returns all matching sites when under the fan-out cap', () => {
    const { sites, totalKnown } = resolveSitesForCountry('DE', 5, testSites);
    expect(sites.map((s) => s.id)).toEqual(['de']);
    expect(totalKnown).toBe(1);
  });

  it('caps the returned sites but reports the true total known', () => {
    const { sites, totalKnown } = resolveSitesForCountry('US', 2, testSites);
    expect(sites).toHaveLength(2);
    expect(totalKnown).toBe(3);
  });

  it('is case-insensitive on country code', () => {
    const { sites } = resolveSitesForCountry('de', 5, testSites);
    expect(sites).toHaveLength(1);
  });
});

describe('resolveSiteById', () => {
  it('finds a site by id', () => {
    const site = resolveSiteById('de', testSites);
    expect(site?.label).toBe('Germany');
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveSiteById('unknown', testSites)).toBeUndefined();
  });
});
