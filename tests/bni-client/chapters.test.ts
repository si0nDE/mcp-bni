import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listChapterOptions, matchChapterOption } from '../../src/bni-client/chapters';
import { BniSite } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/chapters');

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/findamember' }],
};

function mockFetchWithFixture(filename: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const html = readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
      return new Response(html, { status });
    })
  );
}

describe('listChapterOptions', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('extracts chapter id/name pairs from the filter dropdown', async () => {
    mockFetchWithFixture('with-dropdown.html');
    const chapters = await listChapterOptions(testSite);
    expect(chapters).toEqual([
      { id: '501', name: 'Jet BNI (München)' },
      { id: '502', name: 'Example Chapter' },
    ]);
  });

  it('returns [] when the page has no chapter dropdown', async () => {
    mockFetchWithFixture('no-dropdown.html');
    expect(await listChapterOptions(testSite)).toEqual([]);
  });

  it('returns [] on a non-OK response', async () => {
    mockFetchWithFixture('with-dropdown.html', 500);
    expect(await listChapterOptions(testSite)).toEqual([]);
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
