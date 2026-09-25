import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMemberDetail } from '../../src/bni-client/member-detail';
import { BniSite, BniSiteConfig } from '../../src/registry/types';

vi.mock('../../src/taxonomy', () => ({
  stripAcademicTitle: vi.fn(async (fullName: string) => {
    if (fullName.startsWith('Dr. ')) return { title: 'Dr.', name: fullName.slice(4) };
    return { name: fullName };
  }),
  detectLeaderFunctions: vi.fn(async (text?: string) =>
    text?.includes('Chapterdirektor/in') ? ['Chapterdirektor/in'] : []
  ),
}));

const FIXTURES_DIR = join(__dirname, '../fixtures/member-detail');

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/trouverunmembre' }],
};
const testConfig: BniSiteConfig = { websiteId: '999', countryIds: '111' };

function mockFetchWithFixture(filename: string | null, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const html = filename ? readFileSync(join(FIXTURES_DIR, filename), 'utf-8') : '';
      return new Response(html, { status });
    })
  );
}

describe('getMemberDetail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses the fixture profile', async () => {
    mockFetchWithFixture('profile.html');
    const detail = await getMemberDetail(testSite, testConfig, 'ZmFrZUlkMTIz', 'Jane Consultant');

    expect(detail).not.toBeNull();
    expect(detail!.name).toBe('Jane Consultant');
    expect(detail!.title).toBe('Dr.');
    expect(detail!.profession).toBe('Steuerberatung');
    expect(detail!.company).toBe('Consultant GmbH');
    expect(detail!.phone).toBe('+491234567');
    expect(detail!.email).toBe('jane@example.com');
    expect(detail!.website).toBe('https://example-company.test');
    expect(detail!.chapter).toBe('Example Chapter');
    expect(detail!.chapterId).toBe('ZmFrZUNoYXB0ZXJJZA==');
    expect(detail!.bio).toBe('First bio paragraph.\n\nSecond bio paragraph, mentioning Chapterdirektor/in role.');
    expect(detail!.leaderFunctions).toEqual(['Chapterdirektor/in']);
    expect(detail!.profileUrl).toBe(
      'https://example-bni.test/en/memberdetails?encryptedMemberId=ZmFrZUlkMTIz&name=Jane+Consultant'
    );
  });

  it('returns null on a non-OK response', async () => {
    mockFetchWithFixture('profile.html', 500);
    const detail = await getMemberDetail(testSite, testConfig, 'ZmFrZUlkMTIz', 'Jane Consultant');
    expect(detail).toBeNull();
  });

  it('returns null on an empty response body', async () => {
    mockFetchWithFixture(null);
    const detail = await getMemberDetail(testSite, testConfig, 'ZmFrZUlkMTIz', 'Jane Consultant');
    expect(detail).toBeNull();
  });
});
