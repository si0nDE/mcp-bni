import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRegions, getEventTypeNames } from '../../src/bni-client/regions';
import { BniSite } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/regions');

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/findamember' }],
};

function mockFetchByCountryId(fixturesByCountryId: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      const countryId = parsed.searchParams.get('countryId')!;
      const file = fixturesByCountryId[countryId];
      if (!file) return new Response('Not Found', { status: 404 });
      return new Response(readFileSync(join(FIXTURES_DIR, file), 'utf-8'), { status: 200 });
    })
  );
}

describe('getRegions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns regions for a single country id', async () => {
    mockFetchByCountryId({ '111': 'regions-country-111.json' });
    const regions = await getRegions(testSite, { websiteId: '999', countryIds: '111' });
    expect(regions).toEqual([
      { id: 10, name: 'Sample Region North' },
      { id: 20, name: 'Sample Region South' },
    ]);
  });

  it('skips a country id whose request fails, without throwing', async () => {
    mockFetchByCountryId({ '111': 'regions-country-111.json' });
    const regions = await getRegions(testSite, { websiteId: '999', countryIds: '111,999' });
    expect(regions).toEqual([
      { id: 10, name: 'Sample Region North' },
      { id: 20, name: 'Sample Region South' },
    ]);
  });
});

describe('getEventTypeNames', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('merges and dedupes event type names across country IDs, stripping country suffixes', async () => {
    mockFetchByCountryId({
      '111': 'event-types-country-111.json',
      '222': 'event-types-country-222.json',
    });
    const names = await getEventTypeNames(testSite, { websiteId: '999', countryIds: '111,222' });
    expect(names).toEqual(['Chapter Team Training', 'Mitglieder-Erfolgs-Training', 'Regionaler-Besuchertag']);
  });

  it('skips a country id whose request fails, without throwing', async () => {
    mockFetchByCountryId({ '111': 'event-types-country-111.json' });
    const names = await getEventTypeNames(testSite, { websiteId: '999', countryIds: '111,999' });
    expect(names).toEqual(['Mitglieder-Erfolgs-Training', 'Regionaler-Besuchertag']);
  });
});
