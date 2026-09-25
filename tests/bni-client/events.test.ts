import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getUpcomingEvents, getEventDetail } from '../../src/bni-client/events';
import { BniSite, BniSiteConfig } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/events');

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/findamember' }],
};

describe('getUpcomingEvents', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('merges and dedupes events across multiple country IDs, sorted by start', async () => {
    const config: BniSiteConfig = { websiteId: '999', countryIds: '111,222' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const parsed = new URL(url);
        const countryId = parsed.searchParams.get('countryId');
        const file = countryId === '111' ? 'calendar-country-111.json' : 'calendar-country-222.json';
        return new Response(readFileSync(join(FIXTURES_DIR, file), 'utf-8'), { status: 200 });
      })
    );

    const events = await getUpcomingEvents(testSite, config, 60);

    expect(events.map((e) => e.id)).toEqual([2, 1, 3]); // sorted by start: 10-01, 10-05, 10-10
    expect(events).toHaveLength(3);
  });
});

describe('getEventDetail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts fields structurally from the fixture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(readFileSync(join(FIXTURES_DIR, 'detail.html'), 'utf-8'), { status: 200 }))
    );
    const config: BniSiteConfig = { websiteId: '999', countryIds: '111' };

    const detail = await getEventDetail(testSite, config, 'some-event-id');

    expect(detail).toEqual({
      title: 'Sample Networking Webinar',
      description: 'Join our monthly networking webinar to learn tips and tricks. Register Now',
      contactName: 'Sample Host',
      contactPhone: '(555) 000-1111',
      costMembers: 'USD 0.00',
      costNonMembers: 'USD 10.00',
      location: 'Sample Venue, 123 Example Street',
      registrationCount: 5,
    });
  });

  it('returns null on a redirect response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response("<script>document.location.href='index';</script>", { status: 200 }))
    );
    const config: BniSiteConfig = { websiteId: '999', countryIds: '111' };
    const detail = await getEventDetail(testSite, config, 'unknown-id');
    expect(detail).toBeNull();
  });

  it('returns null when the response has no <h2> title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<div>no title here</div>', { status: 200 }))
    );
    const config: BniSiteConfig = { websiteId: '999', countryIds: '111' };
    const detail = await getEventDetail(testSite, config, 'unknown-id');
    expect(detail).toBeNull();
  });
});
