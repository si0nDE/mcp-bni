import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listChapterOptions, findChapterOption } from '../../src/bni-client/chapters';
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

describe('findChapterOption', () => {
  const options = [
    { id: '501', name: 'Jet BNI (München)' },
    { id: '502', name: 'Example Chapter' },
  ];

  it('matches an exact name case-insensitively', () => {
    expect(findChapterOption(options, 'example chapter')).toEqual({ id: '502', name: 'Example Chapter' });
  });

  it('falls back to a substring match', () => {
    expect(findChapterOption(options, 'Jet')).toEqual({ id: '501', name: 'Jet BNI (München)' });
  });

  it('returns undefined when nothing matches', () => {
    expect(findChapterOption(options, 'Nonexistent Chapter')).toBeUndefined();
  });

  it('returns undefined for an empty query', () => {
    expect(findChapterOption(options, '  ')).toBeUndefined();
  });
});
