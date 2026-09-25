import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { discoverSiteConfig, SiteDiscoveryError, __resetDiscoveryCacheForTests } from '../../src/registry/discovery';
import { BniSite } from '../../src/registry/types';

const FIXTURES_DIR = join(__dirname, '../fixtures/discovery');

function mockFetchWithFixture(filename: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      const html = readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
      return new Response(html, { status: 200 });
    })
  );
}

/** Routes the page fetch to a fixture and the country-name lookup (appsCmsCountryListJson) to a canned JSON response, by URL. */
function mockFetchRouted(pageFixture: string, countryList: { status?: number; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes('appsCmsCountryListJson')) {
        return new Response(JSON.stringify(countryList.body ?? []), { status: countryList.status ?? 200 });
      }
      const html = readFileSync(join(FIXTURES_DIR, pageFixture), 'utf-8');
      return new Response(html, { status: 200 });
    })
  );
}

const testSite: BniSite = {
  id: 'test-site',
  countryCode: 'XX',
  label: 'Test Site',
  baseUrl: 'https://example-bni.test',
  languages: [{ locale: 'en', findMemberUrl: 'https://example-bni.test/en/findamember' }],
};

describe('discoverSiteConfig', () => {
  beforeEach(() => {
    __resetDiscoveryCacheForTests();
    vi.restoreAllMocks();
  });

  it('extracts websiteId and countryIds from hidden inputs', async () => {
    mockFetchWithFixture('success.html');
    const config = await discoverSiteConfig(testSite);
    expect(config).toEqual({ websiteId: '6705', countryIds: '3655' });
  });

  it('caches the result — a second call does not fetch again', async () => {
    mockFetchWithFixture('success.html');
    await discoverSiteConfig(testSite);
    await discoverSiteConfig(testSite);
    expect((fetch as any).mock.calls.length).toBe(1);
  });

  it('throws a specific error naming the missing field when inputs are absent', async () => {
    mockFetchWithFixture('missing-inputs.html');
    await expect(discoverSiteConfig(testSite)).rejects.toThrow(SiteDiscoveryError);
    await expect(discoverSiteConfig(testSite)).rejects.toThrow(/website_id/);
  });

  describe('multi-country sites (e.g. Germany + Austria sharing one database)', () => {
    const germanySite: BniSite = { ...testSite, id: 'de-test', label: 'Germany' };
    const austriaSite: BniSite = { ...testSite, id: 'at-test', label: 'Austria' };

    it("narrows countryIds to the one id whose live name matches this site's label", async () => {
      mockFetchRouted('success-multi-country.html', {
        body: [
          { id: 100, name: 'Austria' },
          { id: 200, name: 'Germany' },
        ],
      });
      expect(await discoverSiteConfig(germanySite)).toEqual({ websiteId: '6705', countryIds: '200' });
    });

    it('resolves the other site sharing the same URL to its own distinct id', async () => {
      mockFetchRouted('success-multi-country.html', {
        body: [
          { id: 100, name: 'Austria' },
          { id: 200, name: 'Germany' },
        ],
      });
      expect(await discoverSiteConfig(austriaSite)).toEqual({ websiteId: '6705', countryIds: '100' });
    });

    it('degrades to the combined countryIds when the country-name lookup fails', async () => {
      mockFetchRouted('success-multi-country.html', { status: 500, body: [] });
      expect(await discoverSiteConfig(germanySite)).toEqual({ websiteId: '6705', countryIds: '100,200' });
    });

    it("degrades to the combined countryIds when no returned name matches this site's label (e.g. a deliberately combined label)", async () => {
      const combinedLabelSite: BniSite = { ...testSite, id: 'ch-test', label: 'Switzerland & Liechtenstein' };
      mockFetchRouted('success-multi-country.html', {
        body: [
          { id: 100, name: 'Switzerland' },
          { id: 200, name: 'Liechtenstein' },
        ],
      });
      expect(await discoverSiteConfig(combinedLabelSite)).toEqual({ websiteId: '6705', countryIds: '100,200' });
    });

    it('only fetches the shared page once across two sites, even though each resolves separately', async () => {
      mockFetchRouted('success-multi-country.html', {
        body: [
          { id: 100, name: 'Austria' },
          { id: 200, name: 'Germany' },
        ],
      });
      await discoverSiteConfig(germanySite);
      await discoverSiteConfig(austriaSite);
      const pageFetches = (fetch as any).mock.calls.filter(([url]: [string]) => !url.includes('appsCmsCountryListJson'));
      expect(pageFetches.length).toBe(1);
    });
  });
});
