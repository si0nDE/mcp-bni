import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listChapterOptions, matchChapterOption, __resetChapterCacheForTests } from '../../src/bni-client/chapters';
import { BniSite, BniSiteConfig } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/chapters');

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/findamember' }],
};
const testConfig: BniSiteConfig = { websiteId: '999', countryIds: '111' };

function mockFetchWithFixture(filename: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const html = readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
      return new Response(html, { status });
    })
  );
}

/** Routes a static-page fetch to a fixture, and the two region-fan-out JSON endpoints to canned responses, by URL. */
function mockFetchForFanOut(pageFixture: string, regionsById: Record<string, Array<{ id: number; name: string }>>, chaptersByRegion: Record<number, Array<{ id: number; name: string }>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('appsCmsRegionListByCountryIdJson')) {
        const countryId = new URL(urlStr).searchParams.get('countryId') ?? '';
        return new Response(JSON.stringify(regionsById[countryId] ?? []), { status: 200 });
      }
      if (urlStr.includes('appsCmsNationalMemberSearchFilterJson')) {
        const params = new URLSearchParams(String(init?.body ?? ''));
        const regionId = Number(params.get('regionId'));
        return new Response(JSON.stringify({ chapters: chaptersByRegion[regionId] ?? [] }), { status: 200 });
      }
      const html = readFileSync(join(FIXTURES_DIR, pageFixture), 'utf-8');
      return new Response(html, { status: 200 });
    })
  );
}

describe('listChapterOptions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetChapterCacheForTests();
  });

  it('extracts chapter id/name pairs from the filter dropdown', async () => {
    mockFetchWithFixture('with-dropdown.html');
    const chapters = await listChapterOptions(testSite, testConfig);
    expect(chapters).toEqual([
      { id: '501', name: 'Jet BNI (München)' },
      { id: '502', name: 'Example Chapter' },
    ]);
  });

  it('returns [] on a non-OK response for both the static page and the region fan-out', async () => {
    mockFetchWithFixture('with-dropdown.html', 500);
    expect(await listChapterOptions(testSite, testConfig)).toEqual([]);
  });

  it('falls back to a region-by-region fan-out when the static dropdown is empty (e.g. client-side-populated)', async () => {
    mockFetchForFanOut(
      'no-dropdown.html',
      { '111': [{ id: 9, name: 'Würzburg-Erlangen' }] },
      { 9: [{ id: 36852, name: 'Juwel Würzburg' }] }
    );
    expect(await listChapterOptions(testSite, testConfig)).toEqual([{ id: '36852', name: 'Juwel Würzburg' }]);
  });

  it('merges and dedupes chapters across multiple regions and country ids in the fan-out, sorted by name', async () => {
    mockFetchForFanOut(
      'no-dropdown.html',
      {
        '111': [{ id: 9, name: 'Würzburg-Erlangen' }],
        '222': [{ id: 10, name: 'Wien' }],
      },
      {
        9: [{ id: 36852, name: 'Juwel Würzburg' }],
        10: [{ id: 6041, name: 'Galaxis BNI (Ulm)' }],
      }
    );
    const multiCountryConfig: BniSiteConfig = { websiteId: '999', countryIds: '111,222' };
    expect(await listChapterOptions(testSite, multiCountryConfig)).toEqual([
      { id: '6041', name: 'Galaxis BNI (Ulm)' },
      { id: '36852', name: 'Juwel Würzburg' },
    ]);
  });

  it('caches the result — a second call does not re-fetch', async () => {
    mockFetchWithFixture('with-dropdown.html');
    await listChapterOptions(testSite, testConfig);
    await listChapterOptions(testSite, testConfig);
    expect((fetch as any).mock.calls.length).toBe(1);
  });
});

describe('matchChapterOption', () => {
  const options = [
    { id: '501', name: 'Jet BNI (München)' },
    { id: '502', name: 'Example Chapter' },
  ];

  it('matches an exact name case-insensitively', () => {
    expect(matchChapterOption(options, 'example chapter')).toEqual({ match: { id: '502', name: 'Example Chapter' }, candidates: [] });
  });

  it('falls back to a substring match when exactly one option contains the query', () => {
    expect(matchChapterOption(options, 'Jet')).toEqual({ match: { id: '501', name: 'Jet BNI (München)' }, candidates: [] });
  });

  it('returns no match and no candidates when nothing matches', () => {
    expect(matchChapterOption(options, 'Nonexistent Chapter')).toEqual({ candidates: [] });
  });

  it('returns no match and no candidates for an empty query', () => {
    expect(matchChapterOption(options, '  ')).toEqual({ candidates: [] });
  });

  it('surfaces ambiguous candidates instead of picking the first substring match', () => {
    const ambiguous = [
      { id: '601', name: 'Juwel Würzburg' },
      { id: '602', name: 'Scheurebe Würzburg' },
    ];
    const result = matchChapterOption(ambiguous, 'Würzburg');
    expect(result.match).toBeUndefined();
    expect(result.candidates).toEqual(ambiguous);
  });

  it('an exact match wins even when other options would also substring-match', () => {
    const options = [
      { id: '601', name: 'Würzburg' },
      { id: '602', name: 'Juwel Würzburg' },
    ];
    expect(matchChapterOption(options, 'Würzburg')).toEqual({ match: { id: '601', name: 'Würzburg' }, candidates: [] });
  });
});
