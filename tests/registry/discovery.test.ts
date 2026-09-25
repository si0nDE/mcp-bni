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
});
