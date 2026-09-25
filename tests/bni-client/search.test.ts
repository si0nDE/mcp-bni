import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchMembers } from '../../src/bni-client/search';
import { BniSite, BniSiteConfig } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/search');

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/trouverunmembre' }],
};
const testConfig: BniSiteConfig = { websiteId: '999', countryIds: '111' };

function mockFetchWithFixture(filename: string, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const html = readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
      return new Response(html, { status: ok ? status : 500 });
    })
  );
}

describe('searchMembers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses members from the fixture with correct fields', async () => {
    mockFetchWithFixture('results.html');
    const members = await searchMembers(testSite, testConfig, { keywords: 'consultant' });

    expect(members).toHaveLength(2); // third row is a dedup of row 1's name
    const [jane, john] = members;

    expect(jane.name).toBe('Jane Consultant');
    expect(jane.encryptedMemberId).toBe('ZmFrZUlkMTIz');
    expect(jane.chapter).toBe('Example Chapter');
    expect(jane.region).toBe('Sample Region');
    expect(jane.city).toBe('Springfield');
    expect(jane.district).toBe('Sample District');
    expect(jane.profession).toBe('Steuerberatung');
    expect(jane.company).toBe('Consultant GmbH');
    expect(jane.profileUrl).toBe(
      'https://example-bni.test/en/memberdetails?encryptedMemberId=ZmFrZUlkMTIz&name=Jane+Consultant'
    );

    expect(john.name).toBe('John Baker');
    expect(john.district).toBe('');

    // Malformed rows must not contribute members: a row whose name link has no
    // `encryptedMemberId` in its href (never emit a guessed/blank id), and a
    // row with fewer than 7 <td> cells (short/truncated markup).
    expect(members.some((m) => m.name === 'No Id')).toBe(false);
    expect(members.some((m) => m.name === 'Short Row')).toBe(false);
  });

  it('throws a specific error on a non-OK response', async () => {
    mockFetchWithFixture('results.html', false);
    await expect(searchMembers(testSite, testConfig, {})).rejects.toThrow(/test-site/);
  });

  it('scopes the query by chapterId instead of keywords when both are given', async () => {
    let sentBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = String(init?.body ?? '');
        const html = readFileSync(join(FIXTURES_DIR, 'results.html'), 'utf-8');
        return new Response(html, { status: 200 });
      })
    );

    await searchMembers(testSite, testConfig, { keywords: 'consultant', chapterId: '501' });

    const parameters = new URLSearchParams(new URLSearchParams(sentBody).get('parameters') ?? '');
    expect(parameters.get('chapterName')).toBe('501');
    expect(parameters.get('keywords')).toBe('');
  });
});
