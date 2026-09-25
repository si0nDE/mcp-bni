import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getChapterInfo } from '../../src/bni-client/chapter-info';
import { BniSite } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/chapter-info');

const testSite: BniSite = {
  id: 'de',
  countryCode: 'DE',
  label: 'Deutschland',
  baseUrl: 'https://bni.de',
  languages: [{ locale: 'de-DE', findMemberUrl: 'https://bni.de/de-DE/findamember' }],
};

function mockFetchWithFixture(filename: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const json = readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
      return new Response(json, { status });
    })
  );
}

describe('getChapterInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses chapter meeting details from the fixture', async () => {
    mockFetchWithFixture('found.json');
    const info = await getChapterInfo(testSite, 'j+oFYPTGcqZ9rNnmp6W5/Q==');

    expect(info).toEqual({
      name: 'Augustus BNI (Augsburg)',
      meetingDay: 'Donnerstag',
      meetingTime: '6:40',
      meetingType: 'Präsenztreffen',
      meetingDuration: 110,
      locationName: 'N8 NachtStallung Restaurant',
      address: 'Johannes-Haag-Straße 36',
      city: 'Augsburg',
      postalCode: '86153',
      regionName: 'Augsburg',
      phoneNumber: undefined,
      totalMemberCount: 37,
      onlineMeetingLink: undefined,
      chapterUrl: 'http://bni-augsburg.de/de/chapterdetail?chapterId=j%2BoFYPTGcqZ9rNnmp6W5%2FQ%3D%3D',
      visitChapterUrl: 'http://bni-augsburg.de/de/visitorregistration?chapterId=5836',
    });
  });

  it('returns null when chapterDetails is absent', async () => {
    mockFetchWithFixture('not-found.json');
    const info = await getChapterInfo(testSite, 'unknown-id');
    expect(info).toBeNull();
  });

  it('returns null on a non-OK response', async () => {
    mockFetchWithFixture('found.json', 500);
    const info = await getChapterInfo(testSite, 'j+oFYPTGcqZ9rNnmp6W5/Q==');
    expect(info).toBeNull();
  });
});
