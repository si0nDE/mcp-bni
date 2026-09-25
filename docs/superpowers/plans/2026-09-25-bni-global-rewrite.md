# mcp-bni v2 (BNI Global rewrite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite mcp-bni as an independent, English-only MCP server that supports any BNI country/region via live-discovered site configuration instead of a hardcoded 2-entry map.

**Architecture:** A `registry` module holds a curated list of BNI "find a member" site URLs grouped by country code; a `discovery` module fetches each site's page once and parses two hidden `<input>` fields to get its technical IDs, caching the result. `bni-client` modules (search, chapter-info, events, regions) use a resolved site to query BNI's public `bnicms/v3` endpoints, all routed through a shared rate limiter. `index.ts` wires MCP tools on top, fanning out over multiple sites per country where needed (capped, sequential).

**Tech Stack:** TypeScript (Node >=18, native `fetch`), `cheerio` for HTML parsing, `@modelcontextprotocol/sdk`, `vitest` + `tsx` for fixture-based tests.

**Spec:** [docs/superpowers/specs/2026-09-25-bni-global-rewrite-design.md](../specs/2026-09-25-bni-global-rewrite-design.md) (site list seed data: [docs/superpowers/specs/2026-09-25-bni-country-sites-research.md](../specs/2026-09-25-bni-country-sites-research.md))

## Global Constraints

- No hardcoded `website_id`/`countryIds` anywhere — always discovered live and cached (design §3.2).
- Every user-facing tool output string is English.
- All outbound HTTP calls to BNI hosts go through the shared rate limiter (design §6): min 400ms between consecutive requests to the same host, fan-out sequential never parallel, fan-out cap of 5 sites per country-scoped call.
- On discovery/parse failure: throw a specific error naming the site and what was missing. Never return a guessed or silently-partial result.
- This is a from-scratch repo: no code is copied or transcribed from the old `si0nDE/mcp-bni` / `alexaltovate/bni-mcp` sources. Implementers write parsing logic against the documented live endpoint shapes in this plan and the spec, not by reading old project history.
- README must include the ToS disclaimer language from spec §8 near-verbatim (no "personal use is exempt" framing).

**User decisions (already made):** Package/repo name `mcp-bni`, MIT license, private GitHub repo + public npm publish, English-only output (no i18n layer), fixture-based vitest tests (no CI dependency on live BNI sites), rate limiting is mandatory infrastructure (not configurable-off), fan-out cap default 5, discovery cache TTL 24h, taxonomy source unchanged (existing live-fetched `bnimanager.de` public API), no new tools beyond what already exists in the old project's tool set.

---

## Task 1: Project scaffold + shared rate limiter

**Goal:** Fresh, buildable, testable TypeScript project skeleton with a shared, host-aware rate limiter that every later HTTP-calling module will use.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `src/rate-limit.ts`
- Test: `tests/rate-limit.test.ts`

**Acceptance Criteria:**
- [ ] `npm install && npm run build` succeeds with zero TypeScript errors
- [ ] `npm test` runs and passes
- [ ] Two calls to `waitForRateLimit` for the same host, back to back, are measurably spaced by at least `minDelayMs`
- [ ] Two calls for two *different* hosts are not delayed relative to each other

**Verify:** `npm run build && npm test` → build succeeds, all tests green

**Steps:**

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mcp-bni",
  "version": "0.1.0",
  "description": "MCP server for searching BNI (Business Network International) members worldwide",
  "type": "commonjs",
  "main": "dist/index.js",
  "bin": {
    "mcp-bni": "dist/index.js"
  },
  "files": [
    "dist/**/*",
    "skills/**/*",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "prepublishOnly": "npm run build"
  },
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "cheerio": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0",
    "tsx": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.js.map
.env
```

- [ ] **Step 4: Create `LICENSE`** (MIT, standard text)

```
MIT License

Copyright (c) 2026 si0nDE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Write the failing test for the rate limiter**

`tests/rate-limit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { waitForRateLimit } from '../src/rate-limit';

describe('waitForRateLimit', () => {
  it('delays a second call to the same host by at least minDelayMs', async () => {
    const url = 'https://example-a.test/path';
    await waitForRateLimit(url, { minDelayMs: 150 });
    const start = Date.now();
    await waitForRateLimit(url, { minDelayMs: 150 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(140); // small tolerance
  });

  it('does not delay calls to different hosts', async () => {
    await waitForRateLimit('https://example-b.test/path', { minDelayMs: 300 });
    const start = Date.now();
    await waitForRateLimit('https://example-c.test/path', { minDelayMs: 300 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/rate-limit.test.ts`
Expected: FAIL — `Cannot find module '../src/rate-limit'`

- [ ] **Step 7: Implement `src/rate-limit.ts`**

```typescript
const lastRequestAtByHost = new Map<string, number>();

export interface RateLimitOptions {
  /** Minimum milliseconds between consecutive requests to the same host. */
  minDelayMs?: number;
}

const DEFAULT_MIN_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until at least `minDelayMs` has passed since the last call for this
 * URL's host. Call this immediately before every outbound request to a BNI
 * site — see design spec §6 for why (courtesy + BNI's own IP-ban threshold).
 */
export async function waitForRateLimit(url: string, options: RateLimitOptions = {}): Promise<void> {
  const minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
  const host = new URL(url).host;
  const last = lastRequestAtByHost.get(host);
  const now = Date.now();
  if (last !== undefined) {
    const elapsed = now - last;
    if (elapsed < minDelayMs) {
      await sleep(minDelayMs - elapsed);
    }
  }
  lastRequestAtByHost.set(host, Date.now());
}

/** Convenience wrapper: rate-limits, then calls the global `fetch`. */
export async function rateLimitedFetch(
  url: string,
  init?: RequestInit,
  options?: RateLimitOptions
): Promise<Response> {
  await waitForRateLimit(url, options);
  return fetch(url, init);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/rate-limit.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git init
git add package.json tsconfig.json .gitignore LICENSE src/rate-limit.ts tests/rate-limit.test.ts
git commit -m "feat: scaffold project with shared rate limiter"
```

Note: `git init` only if this is genuinely a fresh repo per design §9. If the working directory still has the old project's git history, confirm with the user before removing/reinitializing it — that is a destructive, one-way action outside this plan's authority to decide silently.

```json:metadata
{"files": ["package.json", "tsconfig.json", ".gitignore", "LICENSE", "src/rate-limit.ts", "tests/rate-limit.test.ts"], "verifyCommand": "npm run build && npm test", "acceptanceCriteria": ["npm run build succeeds with zero errors", "npm test passes", "same-host calls are spaced by minDelayMs", "different-host calls are not delayed"], "modelTier": "standard"}
```

---

## Task 2: Site registry types + seed data

**Goal:** The `BniSite`/`BniSiteConfig` types and the curated list of known BNI sites, ready for the discovery module (Task 3) to resolve.

**Context:** A "site" is one independently-queryable BNI member database — usually a whole country, sometimes a region within one (design §3.2). Some real sites legitimately serve **two** country codes from one shared database (Germany+Austria: `bni.de/de-DE/findamember` covers both). The type stays single-`countryCode`-per-entry (matches the approved design); a combined site is represented as **two `BniSite` entries pointing at the identical `findMemberUrl`** — one per country code. Task 3's discovery cache is keyed by URL, not by site id, so this costs nothing extra (one real HTTP fetch, reused for both entries).

**Files:**
- Create: `src/registry/types.ts`
- Create: `src/registry/sites.ts`

**Acceptance Criteria:**
- [ ] `BNI_SITES` contains one entry per confirmed URL in the research doc (skipping rows with no URL and the regional-only countries called out below)
- [ ] Germany/Austria is represented as two entries (`countryCode: "DE"` and `countryCode: "AT"`) sharing one `findMemberUrl`
- [ ] Switzerland is represented as **one** entry with three `languages` (`de-CH`, `fr-CH`, `it-CH`)
- [ ] `baseUrl` on every entry is derived (not hand-typed) from `languages[0].findMemberUrl`
- [ ] `npm run build` succeeds

**Verify:** `npm run build && node -e "const {BNI_SITES}=require('./dist/registry/sites'); console.log(BNI_SITES.length, BNI_SITES.find(s=>s.id==='fr'))"` → prints a count ≥ 40 and a valid France entry

**Steps:**

- [ ] **Step 1: Create `src/registry/types.ts`**

```typescript
export interface BniSiteLanguage {
  /** Locale parsed from the URL, e.g. "fr", "de-CH", "en-GB" — no internal numeric ID needed (see design §3.1). */
  locale: string;
  /** The public "find a member" page for this language variant. */
  findMemberUrl: string;
}

export interface BniSite {
  /** Stable key, e.g. "de", "at", "ch", "fr", "us-wisconsin". */
  id: string;
  /** Groups sites for country-scoped queries. A site spanning two countries gets two BniSite entries (see Task 2 Context). */
  countryCode: string;
  /** Human label, e.g. "Deutschland", "Frankreich", "Wisconsin". */
  label: string;
  /** Derived from languages[0].findMemberUrl's origin — never hand-typed. */
  baseUrl: string;
  /** First entry is the default language for this site. */
  languages: BniSiteLanguage[];
}

export interface BniSiteConfig {
  websiteId: string;
  /** Comma-joined if the underlying site itself uses more than one internal country ID. */
  countryIds: string;
}
```

- [ ] **Step 2: Create `src/registry/sites.ts`**

Start the file with the seed entries below, which demonstrate every pattern that appears in the research doc (single-language site, multi-language single-country site, multi-country shared site, non-Latin locale, an accented/umlaut label). Then **transcribe every remaining row from
[docs/superpowers/specs/2026-09-25-bni-country-sites-research.md](../specs/2026-09-25-bni-country-sites-research.md)
that has a concrete URL**, one `BniSite` per row, following exactly this shape. Use the row's own country name for `label` and a 2-letter country code you derive from it for `countryCode` (e.g. "Portugal" → "PT", "Griechenland" → "GR"). Parse `locale` from the URL's own language segment (e.g. `/pt/findamember` → `"pt"`, `/hu-HU/findamember` → `"hu-HU"`). **Skip** every row marked "Kein nationaler BNI-Auftritt... gefunden" (no URL exists) and the regional-only countries (USA, Brazil, Spain, Indonesia — no single national URL, out of scope per design §3.4; the three example US regional URLs in the research doc's last table are illustrative only, not part of this seed).

```typescript
import { BniSite, BniSiteLanguage } from './types';

type SiteSeed = Omit<BniSite, 'baseUrl'>;

function withBaseUrl(seed: SiteSeed): BniSite {
  return { ...seed, baseUrl: new URL(seed.languages[0].findMemberUrl).origin };
}

const SITE_SEEDS: SiteSeed[] = [
  // Germany + Austria share one member database (countryIds "5723,5768" in
  // the old project's hardcoded config) — represented as two entries over
  // the same URL, per this task's Context.
  {
    id: 'de',
    countryCode: 'DE',
    label: 'Deutschland',
    languages: [{ locale: 'de-DE', findMemberUrl: 'https://bni.de/de-DE/findamember' }],
  },
  {
    id: 'at',
    countryCode: 'AT',
    label: 'Österreich',
    languages: [{ locale: 'de-DE', findMemberUrl: 'https://bni.de/de-DE/findamember' }],
  },
  // Switzerland: one site, three language variants (confirmed pattern from
  // the previous mcp-bni implementation's BNI_COUNTRIES.ch entry).
  {
    id: 'ch',
    countryCode: 'CH',
    label: 'Schweiz & Liechtenstein',
    languages: [
      { locale: 'de-CH', findMemberUrl: 'https://bni.swiss/de-CH/findamember' },
      { locale: 'fr-CH', findMemberUrl: 'https://bni.swiss/fr-CH/findamember' },
      { locale: 'it-CH', findMemberUrl: 'https://bni.swiss/it-CH/findamember' },
    ],
  },
  {
    id: 'fr',
    countryCode: 'FR',
    label: 'Frankreich',
    languages: [{ locale: 'fr', findMemberUrl: 'https://bnifrance.fr/fr/trouverunmembre' }],
  },
  {
    id: 'jp',
    countryCode: 'JP',
    label: 'Japan',
    languages: [{ locale: 'ja', findMemberUrl: 'https://bni.jp/ja/findamember' }],
  },
  {
    id: 'gr',
    countryCode: 'GR',
    label: 'Griechenland',
    languages: [{ locale: 'el', findMemberUrl: 'https://bni.bni-greece.com/el/findamember' }],
  },
  // ... transcribe every remaining confirmed row from the research doc here,
  // following the exact same { id, countryCode, label, languages } shape.
];

export const BNI_SITES: BniSite[] = SITE_SEEDS.map(withBaseUrl);
```

- [ ] **Step 3: Build and spot-check**

Run: `npm run build && node -e "const {BNI_SITES}=require('./dist/registry/sites'); console.log(BNI_SITES.length); console.log(BNI_SITES.filter(s=>s.countryCode==='DE'||s.countryCode==='AT'))"`
Expected: a count in the low-to-mid 40s, and the DE/AT pair both showing `baseUrl: 'https://bni.de'`

- [ ] **Step 4: Commit**

```bash
git add src/registry/types.ts src/registry/sites.ts
git commit -m "feat: add BNI site registry types and seed data"
```

```json:metadata
{"files": ["src/registry/types.ts", "src/registry/sites.ts"], "verifyCommand": "npm run build && node -e \"const {BNI_SITES}=require('./dist/registry/sites'); console.log(BNI_SITES.length)\"", "acceptanceCriteria": ["one BniSite entry per confirmed research-doc URL", "DE and AT share one findMemberUrl as two entries", "CH is one entry with 3 languages", "baseUrl is derived, not hand-typed", "build succeeds"], "modelTier": "standard"}
```

---

## Task 3: Live site-config discovery + cache

**Goal:** Given a `BniSite`, fetch its `findMemberUrl` once and extract `websiteId`/`countryIds` from the two hidden `<input>` fields (design §3.1), caching by URL for 24h so repeat calls don't re-fetch; fail with a specific, actionable error if either input is missing.

**Files:**
- Create: `src/registry/discovery.ts`
- Create: `tests/fixtures/discovery/success.html`
- Create: `tests/fixtures/discovery/missing-inputs.html`
- Test: `tests/registry/discovery.test.ts`

**Acceptance Criteria:**
- [ ] `discoverSiteConfig` returns `{ websiteId, countryIds }` parsed from a fixture with both hidden inputs present
- [ ] A second call for the same site does not trigger a second fetch (cache hit)
- [ ] A fixture missing the inputs causes a rejected promise with a `SiteDiscoveryError` naming the site and which field was missing
- [ ] Discovery cache is keyed by URL, not by site id (so two `BniSite` entries sharing one `findMemberUrl` — e.g. DE/AT — only fetch once)

**Verify:** `npm test tests/registry/discovery.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/discovery/success.html` (mirrors the real shape captured from `bnifrance.fr` during design research):

```html
<!doctype html>
<html>
<body>
<form>
<input type="hidden" name="countryIds" id="countryIds2" value="3655">
<input type="hidden" id="website_type" value="1">
<input type="hidden" id="website_id" value="6705">
</form>
</body>
</html>
```

`tests/fixtures/discovery/missing-inputs.html` (simulates an unexpected/broken page):

```html
<!doctype html>
<html>
<body>
<h1>Page not found</h1>
</body>
</html>
```

- [ ] **Step 2: Write the failing test**

`tests/registry/discovery.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/registry/discovery.test.ts`
Expected: FAIL — `Cannot find module '../../src/registry/discovery'`

- [ ] **Step 4: Implement `src/registry/discovery.ts`**

```typescript
import * as cheerio from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig } from './types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — see design §3.2

interface CacheEntry {
  config: BniSiteConfig;
  fetchedAt: number;
}

// Keyed by findMemberUrl, not by site id, so sites that share one URL
// (e.g. Germany + Austria) only ever trigger one real fetch.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<BniSiteConfig>>();

export class SiteDiscoveryError extends Error {
  constructor(site: BniSite, message: string) {
    super(`Could not discover config for site "${site.id}" (${site.label}): ${message}`);
    this.name = 'SiteDiscoveryError';
  }
}

export async function discoverSiteConfig(site: BniSite): Promise<BniSiteConfig> {
  const url = site.languages[0].findMemberUrl;

  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = fetchSiteConfig(site, url)
    .then((config) => {
      cache.set(url, { config, fetchedAt: Date.now() });
      inflight.delete(url);
      return config;
    })
    .catch((err) => {
      inflight.delete(url);
      throw err;
    });
  inflight.set(url, promise);
  return promise;
}

async function fetchSiteConfig(site: BniSite, url: string): Promise<BniSiteConfig> {
  const res = await rateLimitedFetch(url);
  if (!res.ok) {
    throw new SiteDiscoveryError(site, `GET ${url} returned HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const websiteId = $('input#website_id').attr('value')?.trim();
  const countryIds = $('input[name="countryIds"]').attr('value')?.trim();

  if (!websiteId) {
    throw new SiteDiscoveryError(site, `no <input id="website_id"> found on ${url}`);
  }
  if (!countryIds) {
    throw new SiteDiscoveryError(site, `no <input name="countryIds"> found on ${url}`);
  }

  return { websiteId, countryIds };
}

/** Test-only escape hatch — clears the in-process cache between test cases. */
export function __resetDiscoveryCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/registry/discovery.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/registry/discovery.ts tests/fixtures/discovery tests/registry/discovery.test.ts
git commit -m "feat: add live site-config discovery with caching"
```

```json:metadata
{"files": ["src/registry/discovery.ts", "tests/fixtures/discovery/success.html", "tests/fixtures/discovery/missing-inputs.html", "tests/registry/discovery.test.ts"], "verifyCommand": "npx vitest run tests/registry/discovery.test.ts", "acceptanceCriteria": ["parses websiteId/countryIds from hidden inputs", "second call for same URL does not re-fetch", "missing inputs throws SiteDiscoveryError naming the field", "cache keyed by URL not site id"], "modelTier": "standard"}
```

---

## Task 4: Profession taxonomy module (English port, fixture-tested)

**Goal:** Port the existing live-fetched, cached BNI profession taxonomy (English comments, native `fetch`, routed through the rate limiter) with fixture-based tests — the old project's version worked but only had live verification, never unit tests.

**Context:** This logic is not derived from the old `si0nDE`/`alexaltovate` fork — it was written fresh earlier in this session against `bnimanager.de`'s public API (confirmed to mirror BNI Global's own official worldwide profession classification; see design §4). Porting it is not a derivative-work concern; only the two Buchmann-derived scraping functions (search/detail, Task 5) need re-deriving from scratch.

**Files:**
- Create: `src/taxonomy.ts`
- Create: `tests/fixtures/taxonomy/professions.json`
- Create: `tests/fixtures/taxonomy/titles.json`
- Create: `tests/fixtures/taxonomy/functions.json`
- Test: `tests/taxonomy.test.ts`

**Acceptance Criteria:**
- [ ] `getProfessions`/`getProfessionCategories`/`getCategory` return fixture data
- [ ] `matchProfession` matches an exact name and falls back to substring matching
- [ ] `matchProfession` returns `undefined` (not a thrown error) when the source is unreachable
- [ ] `stripAcademicTitle` separates a known title from a name
- [ ] `detectLeaderFunctions` finds a mentioned function in free text
- [ ] All three source calls (`/professions`, `/titles`, `/functions`) go through the shared rate limiter

**Verify:** `npx vitest run tests/taxonomy.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/taxonomy/professions.json`:

```json
{
  "professions": [
    { "id": 690030, "name": "Steuerberatung", "categoryId": 69 },
    { "id": 621020, "name": "IT-Beratung", "categoryId": 62 },
    { "id": 430130, "name": "Malerei und Lackiererei", "categoryId": 43 }
  ],
  "professionCategories": [
    { "id": 69, "name": "Recht & Steuer" },
    { "id": 62, "name": "Computer & Programmierung" },
    { "id": 43, "name": "Handwerk" }
  ]
}
```

`tests/fixtures/taxonomy/titles.json`:

```json
{
  "items": [
    { "id": 9, "name": "Prof. Dr." },
    { "id": 1, "name": "Dr." }
  ]
}
```

`tests/fixtures/taxonomy/functions.json`:

```json
{
  "items": ["Chapterdirektor/in", "Mentorkoordinator/in"]
}
```

- [ ] **Step 2: Write the failing test**

`tests/taxonomy.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getProfessions,
  getProfessionCategories,
  getCategory,
  matchProfession,
  stripAcademicTitle,
  detectLeaderFunctions,
  __resetTaxonomyCacheForTests,
} from '../src/taxonomy';

const FIXTURES_DIR = join(__dirname, 'fixtures/taxonomy');

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

function mockTaxonomyEndpoints() {
  const fn = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/professions')) return new Response(JSON.stringify(readFixture('professions.json')));
    if (url.includes('/titles')) return new Response(JSON.stringify(readFixture('titles.json')));
    if (url.includes('/functions')) return new Response(JSON.stringify(readFixture('functions.json')));
    throw new Error(`unexpected URL in test: ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('taxonomy', () => {
  beforeEach(() => {
    __resetTaxonomyCacheForTests();
    vi.restoreAllMocks();
  });

  it('getProfessions returns the fixture professions', async () => {
    mockTaxonomyEndpoints();
    const professions = await getProfessions();
    expect(professions).toHaveLength(3);
    expect(professions.find((p) => p.name === 'Steuerberatung')).toBeDefined();
  });

  it('getProfessionCategories returns the fixture categories', async () => {
    mockTaxonomyEndpoints();
    const categories = await getProfessionCategories();
    expect(categories.map((c) => c.name)).toContain('Recht & Steuer');
  });

  it('getCategory looks up by id', async () => {
    mockTaxonomyEndpoints();
    const category = await getCategory(69);
    expect(category?.name).toBe('Recht & Steuer');
  });

  it('matchProfession matches an exact name', async () => {
    mockTaxonomyEndpoints();
    const match = await matchProfession('Steuerberatung');
    expect(match?.id).toBe(690030);
  });

  it('matchProfession falls back to substring matching', async () => {
    mockTaxonomyEndpoints();
    const match = await matchProfession('IT-Beratung / Consulting');
    expect(match?.id).toBe(621020);
  });

  it('matchProfession returns undefined when the source is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const match = await matchProfession('Steuerberatung');
    expect(match).toBeUndefined();
  });

  it('stripAcademicTitle separates a known title', async () => {
    mockTaxonomyEndpoints();
    const result = await stripAcademicTitle('Prof. Dr. Max Mustermann');
    expect(result).toEqual({ title: 'Prof. Dr.', name: 'Max Mustermann' });
  });

  it('detectLeaderFunctions finds a mentioned function in free text', async () => {
    mockTaxonomyEndpoints();
    const functions = await detectLeaderFunctions('I have been Chapterdirektor/in for 2 years.');
    expect(functions).toEqual(['Chapterdirektor/in']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: FAIL — `Cannot find module '../src/taxonomy'`

- [ ] **Step 4: Implement `src/taxonomy.ts`**

```typescript
import { rateLimitedFetch } from './rate-limit';

// ── BNI profession taxonomy (live-fetched, never hardcoded) ─────────────────
// This classification ("Fachgebietsliste") is BNI's own worldwide profession
// system: unified across BNI Global since 2017, aligned to the ISIC standard
// (UN classification of economic activities), centrally maintained by BNI
// Global (documented in BNI's own FAQ PDF at https://bni.de/de/fachgebietsliste).
// BNI's own website no longer serves this list in machine-readable form (the
// display widget on that page is empty); the source used here is a public,
// unauthenticated reference-data endpoint of a BNI admin tool that mirrors
// the same official BNI taxonomy 1:1 (no login, no member data).
//
// Deliberately NOT frozen as a static array: BNI extends this list over time
// (e.g. "Cybersicherheitsdienste", "KI-Beratung" were added after the 2020
// baseline), so a hardcoded snapshot would go stale. Instead it's fetched
// live on demand and cached briefly in-process.

const TAXONOMY_BASE_URL = 'https://bnimanager.de/api';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — the taxonomy changes rarely, but not never.

export interface ProfessionCategory {
  id: number;
  name: string;
}

export interface Profession {
  id: number;
  name: string;
  categoryId: number;
}

interface TaxonomyData {
  professions: Profession[];
  categories: ProfessionCategory[];
  /** Longest first — matters for prefix matching (e.g. "Prof. Dr." before "Dr."). */
  academicTitles: string[];
  leaderFunctions: string[];
}

async function fetchJson(path: string): Promise<any> {
  const res = await rateLimitedFetch(`${TAXONOMY_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Taxonomy source responded ${res.status} on ${path}`);
  return res.json();
}

async function fetchTaxonomy(): Promise<TaxonomyData> {
  const [professionsData, titlesData, functionsData] = await Promise.all([
    fetchJson('/professions'),
    fetchJson('/titles'),
    fetchJson('/functions'),
  ]);

  const professions: Profession[] = (professionsData.professions ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
  }));
  const categories: ProfessionCategory[] = (professionsData.professionCategories ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
  }));
  const academicTitles: string[] = (titlesData.items ?? [])
    .map((t: any) => t.name as string)
    .sort((a: string, b: string) => b.length - a.length);
  const leaderFunctions: string[] = functionsData.items ?? [];

  return { professions, categories, academicTitles, leaderFunctions };
}

let cache: { data: TaxonomyData; fetchedAt: number } | null = null;
let inflight: Promise<TaxonomyData> | null = null;

/** Returns the taxonomy from cache, otherwise fetches it live (deduplicates concurrent calls). */
async function getTaxonomy(): Promise<TaxonomyData> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = fetchTaxonomy()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      inflight = null;
      return data;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Full profession catalog (for bni_list_professions). Throws if the source is unreachable. */
export async function getProfessions(): Promise<Profession[]> {
  return (await getTaxonomy()).professions;
}

/** Full category list (for bni_list_professions / bni_chapter_gaps). Throws if the source is unreachable. */
export async function getProfessionCategories(): Promise<ProfessionCategory[]> {
  return (await getTaxonomy()).categories;
}

export async function getCategory(categoryId: number): Promise<ProfessionCategory | undefined> {
  const categories = await getProfessionCategories();
  return categories.find((c) => c.id === categoryId);
}

/**
 * Matches a free-text profession (as scraped from a BNI country site) to the
 * official taxonomy. Degrades to "no match" (not a thrown error) if the
 * taxonomy source is unreachable, so callers like member search still work.
 */
export async function matchProfession(rawProfession: string): Promise<Profession | undefined> {
  if (!rawProfession) return undefined;
  let professions: Profession[];
  try {
    professions = await getProfessions();
  } catch {
    return undefined;
  }

  const norm = normalize(rawProfession);
  let best: Profession | undefined;
  let bestLen = -1;
  for (const p of professions) {
    const pNorm = normalize(p.name);
    if (pNorm === norm) return p;
    if ((norm.includes(pNorm) || pNorm.includes(norm)) && pNorm.length > bestLen) {
      best = p;
      bestLen = pNorm.length;
    }
  }
  return best;
}

/**
 * Separates a known academic title from the start of a name.
 * Degrades to "no title detected" if the source is unreachable.
 */
export async function stripAcademicTitle(fullName: string): Promise<{ title?: string; name: string }> {
  const trimmed = fullName.trim();
  let titles: string[];
  try {
    titles = (await getTaxonomy()).academicTitles;
  } catch {
    return { name: trimmed };
  }

  for (const title of titles) {
    if (trimmed.startsWith(title + ' ')) {
      return { title, name: trimmed.slice(title.length).trim() };
    }
  }
  return { name: trimmed };
}

/** Detects mentioned BNI leader functions in free text (e.g. a profile bio). */
export async function detectLeaderFunctions(text?: string): Promise<string[]> {
  if (!text) return [];
  let functions: string[];
  try {
    functions = (await getTaxonomy()).leaderFunctions;
  } catch {
    return [];
  }
  return functions.filter((fn) => text.includes(fn));
}

/** Test-only escape hatch — clears the in-process cache between test cases. */
export function __resetTaxonomyCacheForTests(): void {
  cache = null;
  inflight = null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/taxonomy.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/taxonomy.ts tests/fixtures/taxonomy tests/taxonomy.test.ts
git commit -m "feat: port profession taxonomy module with fixture tests"
```

```json:metadata
{"files": ["src/taxonomy.ts", "tests/fixtures/taxonomy/professions.json", "tests/fixtures/taxonomy/titles.json", "tests/fixtures/taxonomy/functions.json", "tests/taxonomy.test.ts"], "verifyCommand": "npx vitest run tests/taxonomy.test.ts", "acceptanceCriteria": ["getProfessions/getProfessionCategories/getCategory return fixture data", "matchProfession matches exact and substring", "matchProfession returns undefined (not throw) when source unreachable", "stripAcademicTitle separates a known title", "detectLeaderFunctions finds a mentioned function"], "modelTier": "standard"}
```

---

## Task 5: Member search (`bni-client/search.ts`)

**Goal:** Query a resolved site's public member-search endpoint and parse results, using the real 7-column row structure confirmed live this session (not the old project's fragile fallback-index guessing).

**Context:** The real column layout (confirmed via the site's own DataTables config, `oSettings.aoColumns`, and cross-checked against an actual captured response row) is fixed: `td[0]` match-type indicator (ignore), `td[1]` name link, `td[2]` "Chapter - Region", `td[3]` city, `td[4]` district, `td[5]` profession (often written as a `>`-joined hierarchy — take the last segment), `td[6]` company. The member-detail page URL is derived from the site's own `findMemberUrl` by swapping its last path segment for `memberdetails` — verified live this session for both `bni.de` (`/de/memberlist` → `/de/memberdetails`) and `bnifrance.fr` (`/fr/trouverunmembre` → `/fr/memberdetails`, HTTP 200).

**Files:**
- Create: `src/bni-client/search.ts`
- Create: `tests/fixtures/search/results.html`
- Test: `tests/bni-client/search.test.ts`

**Acceptance Criteria:**
- [ ] Parses both members from the fixture with correct name, decoded `encryptedMemberId`, chapter, region, city, district, leaf profession name, and company
- [ ] Duplicate name rows are deduplicated (keep first)
- [ ] `profileUrl` is built from the site's `findMemberUrl` with `memberdetails` swapped in, plus the correct query params
- [ ] A non-OK HTTP response throws a specific error naming the site
- [ ] The outbound request goes through `rateLimitedFetch`

**Verify:** `npx vitest run tests/bni-client/search.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixture**

`tests/fixtures/search/results.html` — mirrors the real shape captured from a live BNI search this session (fictional example data, no real member data):

```html
<div id="responcemessageerror" align="center" style="display: none; margin-top:10px;"></div>
<section class="widgetDataTable">
<table id="memberListTable" class="table table-hover listtables" width="100%">
<tbody>
<tr>
<td><span class="2999">Exact Matches</span></td>
<td><a href='memberdetails?encryptedMemberId=ZmFrZUlkMTIz&name=Jane+Consultant' class='linkone'>Jane Consultant</a></td>
<td>Example Chapter - Sample Region</td>
<td>Springfield</td>
<td>Sample District</td>
<td>Recht &amp; Steuer [69] &gt; Steuerberatung [690030] &gt; Steuerberatung [690030]</td>
<td>Consultant GmbH</td>
</tr>
<tr>
<td><span class="2999">Exact Matches</span></td>
<td><a href='memberdetails?encryptedMemberId=ZmFrZUlkNDU2&name=John+Baker' class='linkone'>John Baker</a></td>
<td>Second Chapter - Sample Region</td>
<td>Shelbyville</td>
<td></td>
<td>Handwerk [43] &gt; Malerei und Lackiererei [430130] &gt; Malerei und Lackiererei [430130]</td>
<td>Baker &amp; Co</td>
</tr>
<tr>
<td><span class="2999">Exact Matches</span></td>
<td><a href='memberdetails?encryptedMemberId=ZHVwbGljYXRl&name=Jane+Consultant' class='linkone'>Jane Consultant</a></td>
<td>Duplicate Row Chapter - Sample Region</td>
<td>Springfield</td>
<td></td>
<td>Recht &amp; Steuer [69] &gt; Steuerberatung [690030]</td>
<td>Consultant GmbH</td>
</tr>
</tbody>
</table>
</section>
```

- [ ] **Step 2: Write the failing test**

`tests/bni-client/search.test.ts`:

```typescript
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
  });

  it('throws a specific error on a non-OK response', async () => {
    mockFetchWithFixture('results.html', false);
    await expect(searchMembers(testSite, testConfig, {})).rejects.toThrow(/test-site/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bni-client/search.test.ts`
Expected: FAIL — `Cannot find module '../../src/bni-client/search'`

- [ ] **Step 4: Implement `src/bni-client/search.ts`**

```typescript
import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';

export interface BniMember {
  name: string;
  encryptedMemberId: string;
  chapter: string;
  region: string;
  city: string;
  district: string;
  profession: string;
  company: string;
  profileUrl: string;
}

export interface SearchParams {
  keywords?: string;
  city?: string;
  language?: BniSiteLanguage;
}

/** Swaps the last path segment of a site's "find a member" URL for "memberdetails" — verified live for bni.de and bnifrance.fr. */
function buildDetailBaseUrl(findMemberUrl: string): URL {
  const url = new URL(findMemberUrl);
  url.pathname = url.pathname.replace(/\/[^/]*$/, '/memberdetails');
  url.search = '';
  return url;
}

export async function searchMembers(
  site: BniSite,
  config: BniSiteConfig,
  params: SearchParams
): Promise<BniMember[]> {
  const language = params.language ?? site.languages[0];
  const findMemberUrl = language.findMemberUrl;

  const innerParams = new URLSearchParams();
  innerParams.set('countryIds', config.countryIds);
  innerParams.set('keywords', params.keywords ?? '');
  if (params.city) innerParams.set('city', params.city);
  innerParams.set('submit', '');

  const body = new URLSearchParams();
  body.set('parameters', innerParams.toString());
  body.set('languages[availableLanguages][0][type]', 'published');
  body.set('languages[availableLanguages][0][url]', findMemberUrl);
  body.set('languages[availableLanguages][0][descriptionKey]', language.locale);
  body.set('languages[availableLanguages][0][id]', '1');
  body.set('languages[availableLanguages][0][localeCode]', language.locale);
  body.set('languages[activeLanguage][id]', '1');
  body.set('languages[activeLanguage][localeCode]', language.locale);
  body.set('languages[activeLanguage][descriptionKey]', language.locale);
  body.set('languages[activeLanguage][cookieBotCode]', language.locale.split('-')[0]);
  body.set('cmsv3', 'true');
  body.set('website_type', '1');
  body.set('website_id', config.websiteId);
  body.set('pageMode', 'Live_Site');

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/memberlist/display`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: findMemberUrl,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`BNI member search failed for site "${site.id}": HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = load(html);
  const members: BniMember[] = [];
  const seen = new Set<string>();
  const detailBaseUrl = buildDetailBaseUrl(findMemberUrl);

  $('table tr, tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return;

    const nameLink = $(cells[1]).find('a');
    if (!nameLink.length) return;

    const name = nameLink.text().trim();
    if (!name || seen.has(name)) return;
    seen.add(name);

    const href = nameLink.attr('href') ?? '';
    const idMatch = href.match(/encryptedMemberId=([^&]+)/);
    const encryptedMemberId = idMatch ? decodeURIComponent(idMatch[1]) : '';

    const chapterFull = $(cells[2]).text().trim();
    const dashIdx = chapterFull.indexOf(' - ');
    const chapter = dashIdx > -1 ? chapterFull.slice(0, dashIdx).trim() : chapterFull;
    const region = dashIdx > -1 ? chapterFull.slice(dashIdx + 3).trim() : '';

    const city = $(cells[3]).text().trim();
    const district = $(cells[4]).text().trim();

    const professionRaw = $(cells[5]).text().trim();
    const profession = professionRaw.includes('>')
      ? professionRaw.split('>').pop()?.trim() ?? professionRaw
      : professionRaw;

    const company = $(cells[6]).text().trim();

    const profileUrl = new URL(detailBaseUrl.toString());
    profileUrl.searchParams.set('encryptedMemberId', encryptedMemberId);
    profileUrl.searchParams.set('name', name);

    members.push({
      name,
      encryptedMemberId,
      chapter,
      region,
      city,
      district,
      profession,
      company,
      profileUrl: profileUrl.toString(),
    });
  });

  return members;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bni-client/search.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/bni-client/search.ts tests/fixtures/search tests/bni-client/search.test.ts
git commit -m "feat: add member search client"
```

```json:metadata
{"files": ["src/bni-client/search.ts", "tests/fixtures/search/results.html", "tests/bni-client/search.test.ts"], "verifyCommand": "npx vitest run tests/bni-client/search.test.ts", "acceptanceCriteria": ["parses both fixture members with correct fields", "duplicate name rows deduplicated", "profileUrl derived from findMemberUrl with memberdetails swapped in", "non-OK response throws error naming the site"], "modelTier": "standard"}
```

---

## Task 6: Member detail (`bni-client/member-detail.ts`)

**Goal:** Fetch and parse a single member's full profile (phone, email, website, bio, chapter name + its link's `chapterId`, academic title, mentioned leader functions), reusing the taxonomy module for the last two.

**Context:** `chapterId` is extracted here and returned in the result, but this module does **not** call the chapter-info endpoint itself (Task 7) — per the design's module boundary (§5), composing "member detail + its chapter's meeting info" is `index.ts`'s job (Task 9), not this module's.

**Files:**
- Create: `src/bni-client/member-detail.ts`
- Create: `tests/fixtures/member-detail/profile.html`
- Test: `tests/bni-client/member-detail.test.ts`

**Acceptance Criteria:**
- [ ] Parses name, academic title (via mocked `stripAcademicTitle`), profession, company, phone, email, website (social-media/own-domain links excluded), chapter name, `chapterId` (decoded), bio (paragraphs joined), leader functions (via mocked `detectLeaderFunctions`)
- [ ] A non-OK HTTP response returns `null`
- [ ] An empty response body returns `null`
- [ ] `profileUrl` matches the `memberdetails`-derived URL with the right query params

**Verify:** `npx vitest run tests/bni-client/member-detail.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixture**

`tests/fixtures/member-detail/profile.html` (fictional example data):

```html
<h2>Dr. Jane Consultant</h2>
<p>Consultant GmbH</p>
<h6>Steuerberatung</h6>
<a href="tel:+491234567">Call</a>
<a href="mailto:jane@example.com">Email</a>
<a href="https://example-company.test">Website</a>
<a href="https://facebook.com/example">Facebook</a>
<p><strong>Chapter</strong> <a href="chapterdetail?chapterId=ZmFrZUNoYXB0ZXJJZA%3D%3D">Example Chapter</a></p>
<div class="widgetMemberTxtVideo">
<p>First bio paragraph.</p>
<p>Second bio paragraph, mentioning Chapterdirektor/in role.</p>
</div>
```

- [ ] **Step 2: Write the failing test**

`tests/bni-client/member-detail.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bni-client/member-detail.test.ts`
Expected: FAIL — `Cannot find module '../../src/bni-client/member-detail'`

- [ ] **Step 4: Implement `src/bni-client/member-detail.ts`**

```typescript
import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { stripAcademicTitle, detectLeaderFunctions } from '../taxonomy';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';

export interface BniMemberDetail {
  name: string;
  encryptedMemberId: string;
  chapter: string;
  /** The chapter's own encoded id, extracted from its profile link — pass to chapter-info.ts to resolve meeting details. */
  chapterId?: string;
  profession: string;
  company: string;
  profileUrl: string;
  phone?: string;
  email?: string;
  website?: string;
  bio?: string;
  title?: string;
  leaderFunctions?: string[];
}

/** Extracts and decodes a query-string parameter from a (possibly relative) URL/href string. */
export function extractEncodedParam(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`[?&]${key}=([^&]+)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function buildProfileUrl(findMemberUrl: string, encryptedMemberId: string, name: string): URL {
  const url = new URL(findMemberUrl);
  url.pathname = url.pathname.replace(/\/[^/]*$/, '/memberdetails');
  url.search = '';
  url.searchParams.set('encryptedMemberId', encryptedMemberId);
  url.searchParams.set('name', name);
  return url;
}

export async function getMemberDetail(
  site: BniSite,
  config: BniSiteConfig,
  encryptedMemberId: string,
  name: string,
  language?: BniSiteLanguage
): Promise<BniMemberDetail | null> {
  const lang = language ?? site.languages[0];
  const profileUrl = buildProfileUrl(lang.findMemberUrl, encryptedMemberId, name);

  const innerParams = new URLSearchParams();
  innerParams.set('encryptedMemberId', encryptedMemberId);
  innerParams.set('name', name);

  const body = new URLSearchParams();
  body.set('parameters', innerParams.toString());
  body.set('languages[activeLanguage][id]', '1');
  body.set('languages[activeLanguage][localeCode]', lang.locale);
  body.set('languages[activeLanguage][descriptionKey]', lang.locale);
  body.set('pageMode', 'Live_Site');
  body.set('websitetype', '1');
  body.set('website_type', '1');
  body.set('website_id', config.websiteId);
  body.set('memberId', encryptedMemberId);

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/memberdetail/display`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: profileUrl.toString(),
    },
    body: body.toString(),
  });

  if (!res.ok) return null;
  const html = await res.text();
  if (!html.trim()) return null;

  const $ = load(html);
  const getText = (selector: string) => $(selector).first().text().trim();

  const phone = $("a[href^='tel:']").first().attr('href')?.replace('tel:', '').trim() || undefined;
  const email = $("a[href^='mailto:']").first().attr('href')?.replace('mailto:', '').trim() || undefined;

  const ownHost = new URL(site.baseUrl).hostname;
  const excludedHosts = [ownHost, 'facebook.com', 'linkedin.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com'];
  let website: string | undefined;
  $("a[href^='http']").each((_, el) => {
    if (website) return;
    const href = $(el).attr('href') ?? '';
    if (!excludedHosts.some((host) => href.includes(host))) {
      website = href;
    }
  });

  let chapter = '';
  let chapterId: string | undefined;
  $('strong').each((_, el) => {
    if (chapter) return;
    if ($(el).text().trim().toLowerCase() === 'chapter') {
      const link = $(el).parent().find('a').first();
      chapter = link.text().trim();
      chapterId = extractEncodedParam(link.attr('href') ?? '', 'chapterId');
    }
  });

  const bio =
    $('.widgetMemberTxtVideo p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join('\n\n') || undefined;

  const pageTitle = $('h2').first().text().trim();
  const { title, name: cleanName } = await stripAcademicTitle(pageTitle || name);
  const leaderFunctions = await detectLeaderFunctions(bio);

  return {
    name: cleanName,
    encryptedMemberId,
    chapter,
    chapterId,
    profession: getText('h6'),
    company: $('h2').first().next('p').text().trim(),
    profileUrl: profileUrl.toString(),
    phone,
    email,
    website,
    bio,
    title,
    leaderFunctions: leaderFunctions.length > 0 ? leaderFunctions : undefined,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bni-client/member-detail.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/bni-client/member-detail.ts tests/fixtures/member-detail tests/bni-client/member-detail.test.ts
git commit -m "feat: add member detail client"
```

```json:metadata
{"files": ["src/bni-client/member-detail.ts", "tests/fixtures/member-detail/profile.html", "tests/bni-client/member-detail.test.ts"], "verifyCommand": "npx vitest run tests/bni-client/member-detail.test.ts", "acceptanceCriteria": ["parses all documented fields from the fixture", "non-OK response returns null", "empty body returns null", "profileUrl matches memberdetails-derived URL"], "modelTier": "standard"}
```

---

## Task 7: Chapter info (`bni-client/chapter-info.ts`)

**Goal:** Given a chapter's `encodedChapterId` (from `member-detail.ts`'s output), fetch its public meeting logistics (day/time/type, address, member count, visit link) from the `chapterInfo` JSON endpoint confirmed live this session.

**Files:**
- Create: `src/bni-client/chapter-info.ts`
- Create: `tests/fixtures/chapter-info/found.json`
- Create: `tests/fixtures/chapter-info/not-found.json`
- Test: `tests/bni-client/chapter-info.test.ts`

**Acceptance Criteria:**
- [ ] Parses all fields from the fixture (this is real, previously-verified chapter data — a public business chapter, not personal member data)
- [ ] Combines `addressLine1`/`addressLine2` into a single `address` string, omitting empty parts
- [ ] Returns `null` when `chapterDetails` is absent/empty
- [ ] Returns `null` on a non-OK HTTP response

**Verify:** `npx vitest run tests/bni-client/chapter-info.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/chapter-info/found.json` (real chapter data captured during design research — public business info, not personal data):

```json
{
  "content": {
    "orgId": 5836,
    "orgType": "CHAPTER",
    "chapterDetails": {
      "id": 5836,
      "name": "Augustus BNI (Augsburg)",
      "phoneNumber": "",
      "meetingDay": "Donnerstag",
      "meetingTime": "6:40",
      "locationName": "N8 NachtStallung Restaurant",
      "addressLine1": "Johannes-Haag-Straße 36",
      "addressLine2": "",
      "city": "Augsburg",
      "postalCode": "86153",
      "regionName": "Augsburg",
      "totalMemberCount": 37,
      "chapterUrl": "http://bni-augsburg.de/de/chapterdetail?chapterId=j%2BoFYPTGcqZ9rNnmp6W5%2FQ%3D%3D",
      "visitChapterUrl": "http://bni-augsburg.de/de/visitorregistration?chapterId=5836",
      "onlineMeetingLink": "",
      "meetingType": "IN_PERSON",
      "meetingTypeText": "Präsenztreffen",
      "meetingDuration": 110
    }
  }
}
```

`tests/fixtures/chapter-info/not-found.json`:

```json
{ "content": {} }
```

- [ ] **Step 2: Write the failing test**

`tests/bni-client/chapter-info.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bni-client/chapter-info.test.ts`
Expected: FAIL — `Cannot find module '../../src/bni-client/chapter-info'`

- [ ] **Step 4: Implement `src/bni-client/chapter-info.ts`**

```typescript
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteLanguage } from '../registry/types';

export interface BniChapterInfo {
  name: string;
  meetingDay?: string;
  meetingTime?: string;
  meetingType?: string;
  meetingDuration?: number;
  locationName?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  regionName?: string;
  phoneNumber?: string;
  totalMemberCount?: number;
  onlineMeetingLink?: string;
  chapterUrl?: string;
  visitChapterUrl?: string;
}

interface ChapterInfoResponse {
  content?: {
    chapterDetails?: {
      name?: string;
      meetingDay?: string;
      meetingTime?: string;
      meetingTypeText?: string;
      meetingDuration?: number;
      locationName?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      postalCode?: string;
      regionName?: string;
      phoneNumber?: string;
      totalMemberCount?: number;
      onlineMeetingLink?: string;
      chapterUrl?: string;
      visitChapterUrl?: string;
    };
  };
}

/** Fetches a chapter's public meeting logistics via its encoded chapter id (see design §3/member-detail's `chapterId` output). */
export async function getChapterInfo(
  site: BniSite,
  encodedChapterId: string,
  language?: BniSiteLanguage
): Promise<BniChapterInfo | null> {
  const lang = language ?? site.languages[0];
  const params = new URLSearchParams();
  params.set('encodedChapterId', encodedChapterId);
  params.set('locale', lang.locale);

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/consume/chapterInfo/?${params.toString()}`);
  if (!res.ok) return null;

  const data = (await res.json()) as ChapterInfoResponse;
  const d = data.content?.chapterDetails;
  if (!d?.name) return null;

  const address = [d.addressLine1, d.addressLine2].filter(Boolean).join(', ') || undefined;

  return {
    name: d.name,
    meetingDay: d.meetingDay || undefined,
    meetingTime: d.meetingTime || undefined,
    meetingType: d.meetingTypeText || undefined,
    meetingDuration: d.meetingDuration,
    locationName: d.locationName || undefined,
    address,
    city: d.city || undefined,
    postalCode: d.postalCode || undefined,
    regionName: d.regionName || undefined,
    phoneNumber: d.phoneNumber || undefined,
    totalMemberCount: d.totalMemberCount,
    onlineMeetingLink: d.onlineMeetingLink || undefined,
    chapterUrl: d.chapterUrl || undefined,
    visitChapterUrl: d.visitChapterUrl || undefined,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bni-client/chapter-info.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/bni-client/chapter-info.ts tests/fixtures/chapter-info tests/bni-client/chapter-info.test.ts
git commit -m "feat: add chapter info client"
```

```json:metadata
{"files": ["src/bni-client/chapter-info.ts", "tests/fixtures/chapter-info/found.json", "tests/fixtures/chapter-info/not-found.json", "tests/bni-client/chapter-info.test.ts"], "verifyCommand": "npx vitest run tests/bni-client/chapter-info.test.ts", "acceptanceCriteria": ["parses all fields from the fixture", "combines address lines correctly", "returns null when chapterDetails absent", "returns null on non-OK response"], "modelTier": "standard"}
```

---

## Task 8: Events — calendar + detail (`bni-client/events.ts`)

**Goal:** List upcoming public events for a site (merging one calendar call per internal country ID, since the calendar endpoint only accepts a single ID at a time even for combined-country sites) and fetch a single event's full detail (contact, cost, location, registration count) using structural extraction, not label text — label text was found to be unreliably localized during design research.

**Files:**
- Create: `src/bni-client/events.ts`
- Create: `tests/fixtures/events/calendar-country-111.json`
- Create: `tests/fixtures/events/calendar-country-222.json`
- Create: `tests/fixtures/events/detail.html`
- Test: `tests/bni-client/events.test.ts`

**Acceptance Criteria:**
- [ ] `getUpcomingEvents` issues one calendar request per comma-separated `countryIds` entry, merges by event `id` (dedup), sorted by `start` ascending
- [ ] `getEventDetail` extracts title, description, contact name/phone, member/non-member cost, location, registration count from the fixture using **structural** selectors (which `.box` contains `.contactPersonDetail` vs `.address`), not label text
- [ ] `getEventDetail` returns `null` when the response redirects (contains `document.location.href`) or has no `<h2>` title

**Verify:** `npx vitest run tests/bni-client/events.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/events/calendar-country-111.json`:

```json
[
  { "id": 1, "title": "Event A", "description": "Event A", "start": "2026-10-05T10:00", "end": "2026-10-05T11:00", "url": "eventdetails?eventId=aaa" },
  { "id": 2, "title": "Event B", "description": "Event B", "start": "2026-10-01T10:00", "end": "2026-10-01T11:00", "url": "eventdetails?eventId=bbb" }
]
```

`tests/fixtures/events/calendar-country-222.json`:

```json
[
  { "id": 2, "title": "Event B", "description": "Event B", "start": "2026-10-01T10:00", "end": "2026-10-01T11:00", "url": "eventdetails?eventId=bbb" },
  { "id": 3, "title": "Event C", "description": "Event C", "start": "2026-10-10T10:00", "end": "2026-10-10T11:00", "url": "eventdetails?eventId=ccc" }
]
```

`tests/fixtures/events/detail.html` (fictional example data, structurally faithful to a real captured event-detail response):

```html
<div class="holder headingRow">
<div class="col-xs-12 col-sm-12 col-md-12"><h2>Sample Networking Webinar</h2></div>
</div>
<div class="holder threeColRow">
<div class="col-xs-12 col-sm-12 col-md-4"><p>Join our monthly networking webinar to learn tips and tricks. <a href="https://example.test/register">Register Now</a></p></div>
<div class="col-xs-12 col-sm-6 col-md-4">
<div class="box"><h3></h3>
<div class="twoColRow">
<div class="contactPersonDetail lCol"><a href="sendmessage?userId=abc">icon</a></div>
<div class="rCol"><p>Sample Host<br/>Phone No: (555) 000-1111<br/>Fax No: (555) 000-2222<br/></p></div>
</div>
<div class="twoColRow">
<div class="lCol"><h4><span></span>USD 0.00</h4></div>
<div class="rCol"><h4><span></span>USD 10.00</h4></div>
</div>
</div>
</div>
<div class="col-xs-12 col-sm-6 col-md-4 lastCol">
<div class="box"><h3></h3>
<p class="address">Sample Venue<br/>123 Example Street<br/></p>
<div class="twoColRow">
<div class="lCol"><h4><span></span></h4></div>
<div class="rCol"><h4><span></span>5</h4></div>
</div>
</div>
</div>
</div>
```

- [ ] **Step 2: Write the failing test**

`tests/bni-client/events.test.ts`:

```typescript
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bni-client/events.test.ts`
Expected: FAIL — `Cannot find module '../../src/bni-client/events'`

- [ ] **Step 4: Implement `src/bni-client/events.ts`**

```typescript
import { load } from 'cheerio';
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig, BniSiteLanguage } from '../registry/types';

export interface BniEvent {
  id: number;
  title: string;
  description?: string;
  start: string;
  end?: string;
  url: string;
}

/** Public event calendar for a site. Issues one request per internal country ID (the endpoint only accepts one at a time) and merges results. */
export async function getUpcomingEvents(
  site: BniSite,
  config: BniSiteConfig,
  daysAhead: number
): Promise<BniEvent[]> {
  const start = new Date();
  const end = new Date(start.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

  const countryIds = config.countryIds.split(',').map((c) => c.trim());
  const eventsById = new Map<number, BniEvent>();

  for (const countryId of countryIds) {
    const params = new URLSearchParams();
    params.set('countryId', countryId);
    params.set('regionIds', '');
    params.set('eventTypeId', '0');
    params.set('cmsv3', 'true');
    params.set('start', toIsoDate(start));
    params.set('end', toIsoDate(end));

    const res = await rateLimitedFetch(`${site.baseUrl}/web/open/cmsViewEventsCalendarJson?${params.toString()}`);
    if (!res.ok) continue;

    const items = (await res.json()) as BniEvent[];
    for (const item of items) {
      eventsById.set(item.id, item);
    }
  }

  return [...eventsById.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export interface BniEventDetail {
  title: string;
  description?: string;
  contactName?: string;
  contactPhone?: string;
  costMembers?: string;
  costNonMembers?: string;
  location?: string;
  registrationCount?: number;
}

/**
 * Fetches full event details. Box labels (e.g. "Contact person:") were found
 * during design research to sometimes render empty/untranslated depending
 * on request parameters — this extracts by DOM structure instead (which box
 * contains `.contactPersonDetail` vs `.address`), which is reliable
 * regardless of label localization.
 */
export async function getEventDetail(
  site: BniSite,
  config: BniSiteConfig,
  encodedEventId: string,
  language?: BniSiteLanguage
): Promise<BniEventDetail | null> {
  const lang = language ?? site.languages[0];

  const innerParams = new URLSearchParams();
  innerParams.set('eventId', encodedEventId);

  const body = new URLSearchParams();
  body.set('parameters', innerParams.toString());
  body.set('languages[availableLanguages][0][type]', 'published');
  body.set('languages[availableLanguages][0][url]', lang.findMemberUrl);
  body.set('languages[availableLanguages][0][descriptionKey]', lang.locale);
  body.set('languages[availableLanguages][0][id]', '1');
  body.set('languages[availableLanguages][0][localeCode]', lang.locale);
  body.set('languages[activeLanguage][id]', '1');
  body.set('languages[activeLanguage][localeCode]', lang.locale);
  body.set('languages[activeLanguage][descriptionKey]', lang.locale);
  body.set('cmsv3', 'true');
  body.set('pageMode', 'Live_Site');
  body.set('website_type', '1');
  body.set('website_id', config.websiteId);
  body.set('eventId', encodedEventId);

  const res = await rateLimitedFetch(`${site.baseUrl}/bnicms/v3/frontend/eventdetail/display`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  });
  if (!res.ok) return null;

  const html = await res.text();
  if (!html.trim() || html.includes('document.location.href')) return null;

  const $ = load(html);
  const title = $('h2').first().text().trim();
  if (!title) return null;

  const description = $('.threeColRow > div').first().text().replace(/\s+/g, ' ').trim() || undefined;

  const contactBox = $('.box')
    .filter((_, el) => $(el).find('.contactPersonDetail').length > 0)
    .first();
  const locationBox = $('.box')
    .filter((_, el) => $(el).find('.address').length > 0)
    .first();

  let contactName: string | undefined;
  let contactPhone: string | undefined;
  if (contactBox.length) {
    const raw = contactBox.find('.rCol p').first().clone();
    raw.find('br').replaceWith('\n');
    const lines = raw
      .text()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    contactName = lines[0];
    contactPhone = lines.find((l) => /tel|phone/i.test(l))?.replace(/^[^:]*:\s*/, '');
  }

  const costMembers = contactBox.length ? contactBox.find('h4').eq(0).text().trim() || undefined : undefined;
  const costNonMembers = contactBox.length ? contactBox.find('h4').eq(1).text().trim() || undefined : undefined;

  let location: string | undefined;
  let registrationCount: number | undefined;
  if (locationBox.length) {
    const addressEl = locationBox.find('.address').first().clone();
    addressEl.find('br').replaceWith(', ');
    location =
      addressEl
        .text()
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
        .trim()
        .replace(/,$/, '') || undefined;
    const regText = locationBox.find('h4').last().text().trim();
    const regMatch = regText.match(/(\d+)/);
    if (regMatch) registrationCount = parseInt(regMatch[1], 10);
  }

  return { title, description, contactName, contactPhone, costMembers, costNonMembers, location, registrationCount };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bni-client/events.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/bni-client/events.ts tests/fixtures/events tests/bni-client/events.test.ts
git commit -m "feat: add events client (calendar + detail)"
```

```json:metadata
{"files": ["src/bni-client/events.ts", "tests/fixtures/events/calendar-country-111.json", "tests/fixtures/events/calendar-country-222.json", "tests/fixtures/events/detail.html", "tests/bni-client/events.test.ts"], "verifyCommand": "npx vitest run tests/bni-client/events.test.ts", "acceptanceCriteria": ["one calendar request per country ID, merged and deduped by event id, sorted by start", "event detail extracted structurally not via label text", "redirect/no-title response returns null"], "modelTier": "standard"}
```

---

## Task 9: Regions + event types (`bni-client/regions.ts`)

**Goal:** List a site's official regions and official event-type names (live, official BNI endpoints confirmed this session) — the latter mainly so callers can discover good search terms for `bni_upcoming_events` (e.g. "Regional Visitor Day") without needing internal numeric IDs, which differ per country for the same conceptual type.

**Files:**
- Create: `src/bni-client/regions.ts`
- Create: `tests/fixtures/regions/regions-country-111.json`
- Create: `tests/fixtures/regions/event-types-country-111.json`
- Create: `tests/fixtures/regions/event-types-country-222.json`
- Test: `tests/bni-client/regions.test.ts`

**Acceptance Criteria:**
- [ ] `getRegions` returns `{id, name}` pairs from the fixture for a single country id
- [ ] `getEventTypeNames` merges names across multiple country IDs, deduplicated, with the trailing `" - <Country>"` suffix stripped and sorted alphabetically

**Verify:** `npx vitest run tests/bni-client/regions.test.ts` → all tests pass

**Steps:**

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/regions/regions-country-111.json`:

```json
[
  { "id": 10, "name": "Sample Region North" },
  { "id": 20, "name": "Sample Region South" }
]
```

`tests/fixtures/regions/event-types-country-111.json`:

```json
[
  { "id": 1, "name": "Mitglieder-Erfolgs-Training" },
  { "id": 429, "name": "Regionaler-Besuchertag - Germany" }
]
```

`tests/fixtures/regions/event-types-country-222.json`:

```json
[
  { "id": 1547, "name": "Regionaler-Besuchertag - Austria" },
  { "id": 5, "name": "Chapter Team Training" }
]
```

- [ ] **Step 2: Write the failing test**

`tests/bni-client/regions.test.ts`:

```typescript
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bni-client/regions.test.ts`
Expected: FAIL — `Cannot find module '../../src/bni-client/regions'`

- [ ] **Step 4: Implement `src/bni-client/regions.ts`**

```typescript
import { rateLimitedFetch } from '../rate-limit';
import { BniSite, BniSiteConfig } from '../registry/types';

export interface BniRegion {
  id: number;
  name: string;
}

/** Official regions for a site — one request per internal country id, merged. */
export async function getRegions(site: BniSite, config: BniSiteConfig): Promise<BniRegion[]> {
  const countryIds = config.countryIds.split(',').map((c) => c.trim());
  const regionsById = new Map<number, BniRegion>();

  for (const countryId of countryIds) {
    const params = new URLSearchParams();
    params.set('countryId', countryId);
    params.set('request_locale', 'en');
    params.set('siteLocale', 'en');

    const res = await rateLimitedFetch(`${site.baseUrl}/web/open/appsCmsRegionListByCountryIdJson?${params.toString()}`);
    if (!res.ok) continue;

    const items = (await res.json()) as Array<{ id: number; name: string }>;
    for (const item of items) {
      regionsById.set(item.id, { id: item.id, name: item.name });
    }
  }

  return [...regionsById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Official event-type category names for a site. IDs are internally
 * country-specific even for the "same" conceptual type (confirmed during
 * design research — the same type has a different numeric id per country),
 * so this returns names only, with the trailing " - <Country>" suffix
 * stripped and duplicates merged. The suffix pattern (a trailing dash
 * followed by one or more capitalized words) covers every case observed
 * this session, but is a heuristic, not a guarantee for every possible
 * country name shape.
 */
export async function getEventTypeNames(site: BniSite, config: BniSiteConfig): Promise<string[]> {
  const countryIds = config.countryIds.split(',').map((c) => c.trim());
  const names = new Set<string>();

  for (const countryId of countryIds) {
    const params = new URLSearchParams();
    params.set('countryId', countryId);
    params.set('request_locale', 'en');
    params.set('siteLocale', 'en');

    const res = await rateLimitedFetch(
      `${site.baseUrl}/web/open/appsCmsEventTypesForNationalWebsiteJson?${params.toString()}`
    );
    if (!res.ok) continue;

    const items = (await res.json()) as Array<{ id: number; name: string }>;
    for (const item of items) {
      names.add(item.name.replace(/\s*-\s*[A-Za-z][A-Za-z\s]*$/, '').trim());
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/bni-client/regions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/bni-client/regions.ts tests/fixtures/regions tests/bni-client/regions.test.ts
git commit -m "feat: add regions and event-type-names client"
```

```json:metadata
{"files": ["src/bni-client/regions.ts", "tests/fixtures/regions/regions-country-111.json", "tests/fixtures/regions/event-types-country-111.json", "tests/fixtures/regions/event-types-country-222.json", "tests/bni-client/regions.test.ts"], "verifyCommand": "npx vitest run tests/bni-client/regions.test.ts", "acceptanceCriteria": ["getRegions returns id/name pairs from fixture", "getEventTypeNames merges/dedupes across country IDs with country suffix stripped, sorted"], "modelTier": "standard"}
```

---

## Task 10: Site resolution helper + MCP bootstrap + simple tools

**Goal:** The country→sites resolver (with fan-out cap, design §3.3), the MCP server bootstrap with all 10 tool schemas registered, and the three tools that need no per-site discovery: `bni_list_countries`, `bni_list_professions`, `bni_enrich_member`.

**Files:**
- Create: `src/registry/resolve.ts`
- Create: `src/index.ts`
- Test: `tests/registry/resolve.test.ts`

**Acceptance Criteria:**
- [ ] `resolveSitesForCountry` returns all matching sites (case-insensitive) when under the cap, and reports the true `totalKnown` count even when capped
- [ ] `resolveSiteById` finds a site by id, `undefined` for unknown ids
- [ ] `bni_list_countries` groups every registered site by country code
- [ ] `bni_list_professions` mirrors the old tool's category/search filtering, now via `src/taxonomy.ts`
- [ ] `bni_enrich_member` is pure (no network call) and unchanged in behavior from the old project, translated to English
- [ ] All 10 tool schemas are present in the `ListToolsRequestSchema` handler (the other 7 handlers throw `"Not yet implemented"` for now — completed in Tasks 11–12)

**Verify:** `npx vitest run tests/registry/resolve.test.ts && npm run build` → tests pass, build succeeds

**Steps:**

- [ ] **Step 1: Write the failing test for the resolver**

`tests/registry/resolve.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSitesForCountry, resolveSiteById } from '../../src/registry/resolve';
import { BniSite } from '../../src/registry/types';

const testSites: BniSite[] = [
  { id: 'a', countryCode: 'US', label: 'A', baseUrl: 'https://a.test', languages: [{ locale: 'en', findMemberUrl: 'https://a.test/en/findamember' }] },
  { id: 'b', countryCode: 'US', label: 'B', baseUrl: 'https://b.test', languages: [{ locale: 'en', findMemberUrl: 'https://b.test/en/findamember' }] },
  { id: 'c', countryCode: 'US', label: 'C', baseUrl: 'https://c.test', languages: [{ locale: 'en', findMemberUrl: 'https://c.test/en/findamember' }] },
  { id: 'de', countryCode: 'DE', label: 'Germany', baseUrl: 'https://d.test', languages: [{ locale: 'de', findMemberUrl: 'https://d.test/de/findamember' }] },
];

describe('resolveSitesForCountry', () => {
  it('returns all matching sites when under the fan-out cap', () => {
    const { sites, totalKnown } = resolveSitesForCountry('DE', 5, testSites);
    expect(sites.map((s) => s.id)).toEqual(['de']);
    expect(totalKnown).toBe(1);
  });

  it('caps the returned sites but reports the true total known', () => {
    const { sites, totalKnown } = resolveSitesForCountry('US', 2, testSites);
    expect(sites).toHaveLength(2);
    expect(totalKnown).toBe(3);
  });

  it('is case-insensitive on country code', () => {
    const { sites } = resolveSitesForCountry('de', 5, testSites);
    expect(sites).toHaveLength(1);
  });
});

describe('resolveSiteById', () => {
  it('finds a site by id', () => {
    const site = resolveSiteById('de', testSites);
    expect(site?.label).toBe('Germany');
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveSiteById('unknown', testSites)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry/resolve.test.ts`
Expected: FAIL — `Cannot find module '../../src/registry/resolve'`

- [ ] **Step 3: Implement `src/registry/resolve.ts`**

```typescript
import { BNI_SITES } from './sites';
import { BniSite } from './types';

export interface ResolvedSites {
  sites: BniSite[];
  totalKnown: number;
}

/** Resolves every registered site for a country code, applying the fan-out cap (design §3.3). Defaults to the real registry; tests inject a smaller list. */
export function resolveSitesForCountry(
  countryCode: string,
  fanOutCap = 5,
  sites: BniSite[] = BNI_SITES
): ResolvedSites {
  const matches = sites.filter((s) => s.countryCode.toLowerCase() === countryCode.toLowerCase());
  return { sites: matches.slice(0, fanOutCap), totalKnown: matches.length };
}

/** Finds one specific site by its id — for tools that already know which site to use. */
export function resolveSiteById(siteId: string, sites: BniSite[] = BNI_SITES): BniSite | undefined {
  return sites.find((s) => s.id === siteId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry/resolve.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Implement `src/index.ts`** (bootstrap + schemas + 3 simple tools; the rest are stubs completed in later tasks)

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BNI_SITES } from './registry/sites';
import { getProfessions, getProfessionCategories } from './taxonomy';

const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

const FAN_OUT_CAP = 5;

const server = new Server({ name: 'mcp-bni', version: PACKAGE_VERSION }, { capabilities: { tools: {} } });

const COUNTRY_PROP = {
  country: {
    type: 'string',
    description: 'Two-letter country code (e.g. "DE", "FR", "US"). See bni_list_countries for every registered code.',
  },
} as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'bni_search',
      description:
        'Searches the public BNI member directory for a country. Fans out across every registered site for that country (capped; see bni_list_countries). Max 250 results per site — narrow with keywords/city for precise results.',
      inputSchema: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: 'Search term: name, profession, company, or specialty (e.g. "Marketing", "Tax advisor")' },
          city: { type: 'string', description: 'Filters by exact stored city — use keywords for anything less precise' },
          ...COUNTRY_PROP,
        },
        required: ['country'],
      },
    },
    {
      name: 'bni_member_detail',
      description: 'Fetches a member\'s full public profile (phone, email, website, bio, title, chapter, chapter meeting info if resolvable).',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'The site id this member was found on (from bni_search results)' },
          encryptedMemberId: { type: 'string', description: 'From bni_search results' },
          name: { type: 'string', description: "Member's name (required to build the profile URL)" },
        },
        required: ['site', 'encryptedMemberId', 'name'],
      },
    },
    {
      name: 'bni_chapter_gaps',
      description:
        'Analyzes a chapter: lists existing professions with counts, and identifies whitespace using the official BNI profession taxonomy (empty categories + specific open professions in thinly-covered categories).',
      inputSchema: {
        type: 'object',
        properties: {
          chapterName: { type: 'string', description: 'Chapter name (as it appears in search results)' },
          ...COUNTRY_PROP,
        },
        required: ['chapterName', 'country'],
      },
    },
    {
      name: 'bni_list_countries',
      description: 'Lists every registered country code and the sites known for it.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'bni_upcoming_events',
      description: 'Lists upcoming public BNI events for a country (trainings, webinars, regional visitor days). See bni_list_event_types for good search terms.',
      inputSchema: {
        type: 'object',
        properties: {
          daysAhead: { type: 'number', description: 'Days ahead from today (default 60)' },
          search: { type: 'string', description: 'Filters title/description by keyword (e.g. "Visitor Day")' },
          ...COUNTRY_PROP,
        },
        required: ['country'],
      },
    },
    {
      name: 'bni_event_detail',
      description: 'Fetches an event\'s full details: contact, member/non-member cost, location or online link, registration count.',
      inputSchema: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'The site id this event was found on' },
          eventId: { type: 'string', description: 'Event id or full eventdetails URL from bni_upcoming_events' },
        },
        required: ['site', 'eventId'],
      },
    },
    {
      name: 'bni_list_regions',
      description: 'Lists the official BNI regions for a country.',
      inputSchema: { type: 'object', properties: { ...COUNTRY_PROP }, required: ['country'] },
    },
    {
      name: 'bni_list_event_types',
      description: 'Lists the official BNI event-type names for a country — useful search terms for bni_upcoming_events.',
      inputSchema: { type: 'object', properties: { ...COUNTRY_PROP }, required: ['country'] },
    },
    {
      name: 'bni_list_professions',
      description: 'Lists the official BNI worldwide profession catalog (professions + categories), searchable and filterable.',
      inputSchema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Filters professions by keyword (e.g. "advisor", "IT")' },
          category: { type: 'string', description: 'Filters by category name (e.g. "Legal & Tax", "Computers & Technology")' },
        },
      },
    },
    {
      name: 'bni_enrich_member',
      description: 'Generates LinkedIn search URLs and suggested web searches to find more information about a BNI member (no external requests).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Member's full name" },
          company: { type: 'string' },
          city: { type: 'string' },
          profession: { type: 'string' },
        },
        required: ['name'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'bni_list_countries') {
      const grouped = new Map<string, typeof BNI_SITES>();
      for (const site of BNI_SITES) {
        if (!grouped.has(site.countryCode)) grouped.set(site.countryCode, []);
        grouped.get(site.countryCode)!.push(site);
      }
      const lines = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, sites]) => `- **${code}** — ${sites.map((s) => s.label).join(', ')}`);
      return {
        content: [
          { type: 'text', text: `**${grouped.size} countries, ${BNI_SITES.length} registered sites**\n\n${lines.join('\n')}` },
        ],
      };
    }

    if (name === 'bni_list_professions') {
      const { search, category } = args as { search?: string; category?: string };

      let categories: Awaited<ReturnType<typeof getProfessionCategories>>;
      let professions: Awaited<ReturnType<typeof getProfessions>>;
      try {
        [categories, professions] = await Promise.all([getProfessionCategories(), getProfessions()]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Profession catalog unavailable live: ${msg}` }], isError: true };
      }

      let filteredCategories = categories;
      if (category) {
        const catNorm = category.toLowerCase();
        filteredCategories = categories.filter((c) => c.name.toLowerCase().includes(catNorm));
        if (filteredCategories.length === 0) {
          return {
            content: [
              { type: 'text', text: `No category matches "${category}". Available: ${categories.map((c) => c.name).join(', ')}` },
            ],
          };
        }
      }

      const searchNorm = search?.toLowerCase();
      const sections = filteredCategories
        .map((cat) => {
          const profs = professions.filter(
            (p) => p.categoryId === cat.id && (!searchNorm || p.name.toLowerCase().includes(searchNorm))
          );
          if (profs.length === 0) return null;
          return `**${cat.name}** (${profs.length})\n${profs.map((p) => `  - ${p.name}`).join('\n')}`;
        })
        .filter(Boolean);

      if (sections.length === 0) {
        return { content: [{ type: 'text', text: 'No professions found.' }] };
      }

      return {
        content: [
          {
            type: 'text',
            text: `**Official BNI profession catalog** (${professions.length} professions, ${categories.length} categories)\n\n${sections.join('\n\n')}`,
          },
        ],
      };
    }

    if (name === 'bni_enrich_member') {
      const { name: memberName, company, city, profession } = args as {
        name: string;
        company?: string;
        city?: string;
        profession?: string;
      };

      const linkedinUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
        memberName + (company ? ' ' + company : '')
      )}`;
      const queries = [
        `"${memberName}"${company ? ` "${company}"` : ''} contact`,
        `"${memberName}" ${city ?? ''} ${profession ?? ''} LinkedIn`.trim(),
        company ? `${company} imprint email` : `"${memberName}" imprint`,
      ];

      return {
        content: [
          {
            type: 'text',
            text: [
              `**Enrichment: ${memberName}**`,
              company ? `Company: ${company}` : null,
              city ? `City: ${city}` : null,
              profession ? `Profession: ${profession}` : null,
              `\nLinkedIn search: ${linkedinUrl}`,
              `\nSuggested queries:`,
              ...queries.map((q) => `  - ${q}`),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    }

    // Completed in Tasks 11–12.
    if (
      ['bni_search', 'bni_member_detail', 'bni_chapter_gaps', 'bni_upcoming_events', 'bni_event_detail', 'bni_list_regions', 'bni_list_event_types'].includes(
        name
      )
    ) {
      return { content: [{ type: 'text', text: `Not yet implemented: ${name}` }], isError: true };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

- [ ] **Step 6: Build and manually sanity-check the wired tools**

Run: `npm run build`
Expected: zero errors. Then manually invoke the server once (as done throughout the design session) to confirm `bni_list_countries`, `bni_list_professions`, and `bni_enrich_member` respond correctly — a full stdio round-trip script, e.g.:

```bash
node -e "
const { spawn } = require('child_process');
const p = spawn('node', ['dist/index.js']);
let buf = '';
p.stdout.on('data', (d) => (buf += d.toString()));
function send(msg) { p.stdin.write(JSON.stringify(msg) + '\n'); }
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } });
setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bni_list_countries', arguments: {} } });
}, 300);
setTimeout(() => { console.log(buf); p.kill(); process.exit(0); }, 3000);
"
```

Expected: a `bni_list_countries` result listing every seeded country code.

- [ ] **Step 7: Commit**

```bash
git add src/registry/resolve.ts src/index.ts tests/registry/resolve.test.ts
git commit -m "feat: add site resolver, MCP bootstrap, and simple tools"
```

```json:metadata
{"files": ["src/registry/resolve.ts", "src/index.ts", "tests/registry/resolve.test.ts"], "verifyCommand": "npx vitest run tests/registry/resolve.test.ts && npm run build", "acceptanceCriteria": ["resolveSitesForCountry caps results but reports true totalKnown", "resolveSiteById finds/misses correctly", "all 10 tool schemas registered", "bni_list_countries/bni_list_professions/bni_enrich_member fully implemented and English", "remaining 7 tools stubbed as not-yet-implemented"], "modelTier": "standard"}
```

---

## Task 11: Fan-out tools (`bni_search`, `bni_upcoming_events`, `bni_list_regions`, `bni_list_event_types`)

**Goal:** Wire the four country-scoped tools that fan out sequentially over every resolved site for a country, merging results and transparently reporting capped/partial coverage per design §3.3 (never silent).

**Context:** No new unit-test file for this task — `index.ts`'s dispatch logic is orchestration glue over already-unit-tested modules (Tasks 3, 5, 6, 8, 9). Verification is a live manual smoke test against a real site, the same way every endpoint in this project was validated during design research (design §7 explicitly keeps live verification manual/ad-hoc, not a CI dependency). Note: `event.id` (a `BniEvent`'s internal numeric id) and the encoded `eventId` string `bni_event_detail` needs are two different values — the encoded one must be extracted from `event.url` using `extractEncodedParam` (exported from Task 6's `member-detail.ts`).

**Files:**
- Modify: `src/index.ts` (add imports; add 4 tool-handler blocks; shrink the "not yet implemented" stub list to the remaining 3 tools)

**Acceptance Criteria:**
- [ ] Each of the 4 tools resolves sites via `resolveSitesForCountry`, returns a clear error if none are registered for the given country code
- [ ] Sites are queried **sequentially** (a `for...of` with `await` inside, never `Promise.all`)
- [ ] A per-site discovery/fetch failure is caught, named in the output, and does not prevent other sites' results from being returned
- [ ] When the country has more known sites than the fan-out cap, the output says so explicitly (e.g. "Searched 5 of 12 known sites")
- [ ] `bni_search` results show which site each member came from
- [ ] `bni_upcoming_events` supports `daysAhead` (default 60) and a `search` keyword filter over title/description
- [ ] `bni_upcoming_events` output shows the **encoded** `eventId` (extracted from `event.url`), not the internal numeric `event.id` — the encoded string is what `bni_event_detail` (Task 12) actually accepts

**Verify:** `npm run build`, then the manual stdio smoke test in Step 3 → `bni_search` and `bni_upcoming_events` return real results for `country: "DE"`

**Steps:**

- [ ] **Step 1: Add imports to `src/index.ts`**

Add near the top, alongside the existing imports:

```typescript
import { resolveSitesForCountry } from './registry/resolve';
import { discoverSiteConfig } from './registry/discovery';
import { searchMembers, BniMember } from './bni-client/search';
import { getUpcomingEvents, BniEvent } from './bni-client/events';
import { getRegions, getEventTypeNames } from './bni-client/regions';
import { extractEncodedParam } from './bni-client/member-detail';

function formatEventDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, year, month, day, hour, minute] = m;
  return `${day}.${month}.${year}, ${hour}:${minute}`;
}

function noSiteError(country: string) {
  return {
    content: [{ type: 'text' as const, text: `No registered site for country code "${country}". See bni_list_countries.` }],
    isError: true,
  };
}

function coverageAndFailureNotes(sites: number, totalKnown: number, country: string, failedSites: string[]): string {
  const coverage = totalKnown > sites ? `\n(Searched ${sites} of ${totalKnown} known sites for "${country}".)` : '';
  const failures = failedSites.length > 0 ? `\n(Some sites failed: ${failedSites.join('; ')})` : '';
  return coverage + failures;
}
```

`FAN_OUT_CAP` is already declared in `src/index.ts` from Task 10 — this task only adds the imports and helpers above it, it does not redeclare the constant.

- [ ] **Step 2: Add the 4 tool handlers to the `CallToolRequestSchema` switch, before the "not yet implemented" check**

```typescript
    if (name === 'bni_search') {
      const { keywords, city, country } = args as { keywords?: string; city?: string; country: string };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const results: Array<{ site: string; member: BniMember }> = [];
      const failedSites: string[] = [];

      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const members = await searchMembers(site, config, { keywords, city });
          for (const member of members) results.push({ site: site.id, member });
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const notes = coverageAndFailureNotes(sites.length, totalKnown, country, failedSites);

      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No members found.${notes}` }] };
      }

      const text = results
        .map(
          ({ site, member }, i) =>
            `${i + 1}. **${member.name}** | ${member.company}\n   Profession: ${member.profession}\n   Chapter: ${member.chapter}${member.region ? ` - ${member.region}` : ''}\n   City: ${member.city}${member.district ? ` (${member.district})` : ''}\n   Site: ${site} | ID: ${member.encryptedMemberId}`
        )
        .join('\n\n');

      return {
        content: [{ type: 'text', text: `**${results.length} members found** (max 250 per site)${notes}\n\n${text}` }],
      };
    }

    if (name === 'bni_upcoming_events') {
      const { daysAhead, search, country } = args as { daysAhead?: number; search?: string; country: string };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const results: Array<{ site: string; event: BniEvent }> = [];
      const failedSites: string[] = [];

      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const events = await getUpcomingEvents(site, config, daysAhead && daysAhead > 0 ? daysAhead : 60);
          for (const event of events) results.push({ site: site.id, event });
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const searchNorm = search?.toLowerCase();
      const filtered = searchNorm
        ? results.filter(
            ({ event }) =>
              event.title.toLowerCase().includes(searchNorm) || (event.description ?? '').toLowerCase().includes(searchNorm)
          )
        : results;

      const notes = coverageAndFailureNotes(sites.length, totalKnown, country, failedSites);

      if (filtered.length === 0) {
        return { content: [{ type: 'text', text: `No events found in the selected period.${notes}` }] };
      }

      const text = filtered
        .map(({ site, event }) => {
          const desc = event.description && event.description !== event.title ? `\n   ${event.description}` : '';
          // event.id is an internal numeric id, NOT what bni_event_detail needs — extract the
          // encoded eventId string from event.url (see design research: these are different values).
          const encodedEventId = extractEncodedParam(event.url, 'eventId') ?? String(event.id);
          return `- **${event.title}** — ${formatEventDate(event.start)} (site: ${site})${desc}\n   eventId: ${encodedEventId}`;
        })
        .join('\n\n');

      return { content: [{ type: 'text', text: `**${filtered.length} events**${notes}\n\n${text}` }] };
    }

    if (name === 'bni_list_regions') {
      const { country } = args as { country: string };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const regionsById = new Map<number, string>();
      const failedSites: string[] = [];
      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const regions = await getRegions(site, config);
          for (const r of regions) regionsById.set(r.id, r.name);
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const regions = [...regionsById.values()].sort((a, b) => a.localeCompare(b));
      const notes = coverageAndFailureNotes(sites.length, totalKnown, country, failedSites);

      if (regions.length === 0) {
        return { content: [{ type: 'text', text: `No regions found.${notes}` }] };
      }
      return { content: [{ type: 'text', text: `**${regions.length} regions**${notes}\n\n${regions.map((r) => `  - ${r}`).join('\n')}` }] };
    }

    if (name === 'bni_list_event_types') {
      const { country } = args as { country: string };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const names = new Set<string>();
      const failedSites: string[] = [];
      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const siteNames = await getEventTypeNames(site, config);
          siteNames.forEach((n) => names.add(n));
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      const notes = coverageAndFailureNotes(sites.length, totalKnown, country, failedSites);

      if (sorted.length === 0) {
        return { content: [{ type: 'text', text: `No event types found.${notes}` }] };
      }
      return { content: [{ type: 'text', text: `**${sorted.length} event types**${notes}\n\n${sorted.map((n) => `  - ${n}`).join('\n')}` }] };
    }
```

- [ ] **Step 3: Update the stub check to only cover the 3 remaining tools**

```typescript
    // Completed in Task 12.
    if (['bni_member_detail', 'bni_chapter_gaps', 'bni_event_detail'].includes(name)) {
      return { content: [{ type: 'text', text: `Not yet implemented: ${name}` }], isError: true };
    }
```

- [ ] **Step 4: Build, then manually verify against a real site**

Run: `npm run build`

Then run a stdio smoke test (same pattern as Task 10 Step 6) calling `bni_search` with `{ country: "DE", keywords: "Steuerberatung" }` and `bni_upcoming_events` with `{ country: "DE", daysAhead: 30 }`.
Expected: both return real, non-empty results from the live `bni.de` site.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire fan-out tools (search, events, regions, event types)"
```

```json:metadata
{"files": ["src/index.ts"], "verifyCommand": "npm run build", "acceptanceCriteria": ["4 tools resolve sites and fan out sequentially", "per-site failures caught and named, other sites still return", "capped coverage reported explicitly", "bni_search shows source site per member", "live smoke test against bni.de returns real results"], "modelTier": "standard"}
```

---

## Task 12: Single-site composed tools (`bni_member_detail`, `bni_chapter_gaps`, `bni_event_detail`)

**Goal:** Wire the remaining three tools, which operate on one already-identified site (`bni_member_detail`, `bni_event_detail`) or compose multiple client calls (`bni_chapter_gaps`: search + one chapter-info lookup + taxonomy-based whitespace analysis, mirroring the analysis already proven in the old project this session).

**Files:**
- Modify: `src/index.ts` (add imports; add 3 tool-handler blocks; remove the now-empty stub check)

**Acceptance Criteria:**
- [ ] `bni_member_detail` resolves the given site, fetches the profile, and — if a `chapterId` was found — enriches with chapter meeting info
- [ ] An unknown `site` id or a discovery failure returns a clear error, not a crash
- [ ] `bni_chapter_gaps` fans out over the country's sites to find chapter members, then runs the same category-whitespace analysis proven in the old project (empty categories, thinly-covered categories with concrete suggestions, unmatched professions), degrading gracefully (not crashing) if the taxonomy is unreachable
- [ ] `bni_chapter_gaps` resolves one representative member's chapter info for a meeting-logistics header
- [ ] `bni_event_detail` accepts either a raw event id or a full `eventdetails` URL
- [ ] No `"Not yet implemented"` stub remains — the fallback for a truly unknown tool name still exists

**Verify:** `npm run build`, then a manual stdio smoke test calling `bni_chapter_gaps` with a real German chapter name and `country: "DE"` → meeting header + profession list + whitespace sections all render

**Steps:**

- [ ] **Step 1: Add imports to `src/index.ts`**

Task 10 already added `import { getProfessions, getProfessionCategories } from './taxonomy';` — **extend that existing line** to also bring in `matchProfession` (do not add a second, duplicate import statement for the same module):

```typescript
import { matchProfession, getProfessions, getProfessionCategories } from './taxonomy';
```

Also add these new imports (`extractEncodedParam` was already imported from `./bni-client/member-detail` in Task 11 — do not import it a second time here):

```typescript
import { resolveSiteById } from './registry/resolve';
import { getMemberDetail } from './bni-client/member-detail';
import { getChapterInfo, BniChapterInfo } from './bni-client/chapter-info';
import { getEventDetail } from './bni-client/events';
import { BniSite } from './registry/types';
```

- [ ] **Step 2: Add the 3 tool handlers, replacing the stub check**

```typescript
    if (name === 'bni_member_detail') {
      const { site: siteId, encryptedMemberId, name: memberName } = args as {
        site: string;
        encryptedMemberId: string;
        name: string;
      };
      const site = resolveSiteById(siteId);
      if (!site) {
        return { content: [{ type: 'text', text: `Unknown site "${siteId}". See bni_list_countries.` }], isError: true };
      }

      let config;
      try {
        config = await discoverSiteConfig(site);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Could not resolve site config: ${msg}` }], isError: true };
      }

      const detail = await getMemberDetail(site, config, encryptedMemberId, memberName);
      if (!detail) {
        return { content: [{ type: 'text', text: 'Profile not found.' }] };
      }

      const chapterInfo = detail.chapterId ? await getChapterInfo(site, detail.chapterId).catch(() => null) : null;

      const lines = [
        `**${detail.title ? detail.title + ' ' : ''}${detail.name}**`,
        detail.company ? `Company: ${detail.company}` : null,
        detail.profession ? `Profession: ${detail.profession}` : null,
        detail.chapter ? `Chapter: ${detail.chapter}` : null,
        detail.phone ? `Phone: ${detail.phone}` : null,
        detail.email ? `Email: ${detail.email}` : null,
        detail.website ? `Website: ${detail.website}` : null,
        detail.leaderFunctions?.length ? `Volunteer role: ${detail.leaderFunctions.join(', ')}` : null,
        chapterInfo
          ? [
              `\n**Chapter meeting** (${chapterInfo.name}):`,
              chapterInfo.meetingDay || chapterInfo.meetingTime
                ? `  ${[chapterInfo.meetingDay, chapterInfo.meetingTime].filter(Boolean).join(', ')}${chapterInfo.meetingType ? ` (${chapterInfo.meetingType})` : ''}`
                : null,
              chapterInfo.locationName || chapterInfo.address
                ? `  Location: ${[chapterInfo.locationName, chapterInfo.address, chapterInfo.postalCode, chapterInfo.city].filter(Boolean).join(', ')}`
                : null,
              chapterInfo.totalMemberCount ? `  Chapter members: ${chapterInfo.totalMemberCount}` : null,
              chapterInfo.visitChapterUrl ? `  Visit as a guest: ${chapterInfo.visitChapterUrl}` : null,
            ]
              .filter(Boolean)
              .join('\n')
          : null,
        detail.bio ? `\nBio: ${detail.bio}` : null,
        `\nProfile: ${detail.profileUrl}`,
      ].filter(Boolean);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'bni_chapter_gaps') {
      const { chapterName, country } = args as { chapterName: string; country: string };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const allResults: Array<{ site: BniSite; member: BniMember }> = [];
      const failedSites: string[] = [];
      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const members = await searchMembers(site, config, { keywords: chapterName });
          for (const member of members) allResults.push({ site, member });
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const nameNorm = chapterName.toLowerCase();
      const chapterMembers = allResults.filter(
        ({ member }) => member.chapter.toLowerCase().includes(nameNorm) || member.region.toLowerCase().includes(nameNorm)
      );
      const useResults = chapterMembers.length > 0 ? chapterMembers : allResults;
      const notes = coverageAndFailureNotes(sites.length, totalKnown, country, failedSites);

      if (useResults.length === 0) {
        return { content: [{ type: 'text', text: `No members found for chapter "${chapterName}".${notes}` }] };
      }

      // Chapter meeting logistics, resolved via one representative member.
      let chapterInfo: BniChapterInfo | null = null;
      const representative = useResults[0];
      try {
        const repConfig = await discoverSiteConfig(representative.site);
        const repDetail = await getMemberDetail(
          representative.site,
          repConfig,
          representative.member.encryptedMemberId,
          representative.member.name
        );
        if (repDetail?.chapterId) {
          chapterInfo = await getChapterInfo(representative.site, repDetail.chapterId);
        }
      } catch {
        chapterInfo = null;
      }

      let categories: Awaited<ReturnType<typeof getProfessionCategories>> = [];
      let professions: Awaited<ReturnType<typeof getProfessions>> = [];
      let taxonomyAvailable = true;
      try {
        [categories, professions] = await Promise.all([getProfessionCategories(), getProfessions()]);
      } catch {
        taxonomyAvailable = false;
      }

      const professionCounts = new Map<string, number>();
      const categoryMemberCounts = new Map<number, number>();
      const categoryProfessionsPresent = new Map<number, Set<number>>();
      const unmatched = new Set<string>();

      for (const { member } of useResults) {
        if (!member.profession) continue;
        professionCounts.set(member.profession, (professionCounts.get(member.profession) ?? 0) + 1);

        const matched = taxonomyAvailable ? await matchProfession(member.profession) : undefined;
        if (matched) {
          categoryMemberCounts.set(matched.categoryId, (categoryMemberCounts.get(matched.categoryId) ?? 0) + 1);
          if (!categoryProfessionsPresent.has(matched.categoryId)) categoryProfessionsPresent.set(matched.categoryId, new Set());
          categoryProfessionsPresent.get(matched.categoryId)!.add(matched.id);
        } else if (taxonomyAvailable) {
          unmatched.add(member.profession);
        }
      }

      const sorted = [...professionCounts.entries()].sort((a, b) => b[1] - a[1]);
      const profList = sorted.map(([p, c]) => `  - ${p} (${c}x)`).join('\n');

      const emptyCategories = categories.filter((cat) => !categoryMemberCounts.has(cat.id));
      const thinCategories = [...categoryMemberCounts.entries()].filter(([, count]) => count <= 2).sort((a, b) => a[1] - b[1]);
      const thinCategoryList = thinCategories
        .map(([catId, count]) => {
          const cat = categories.find((c) => c.id === catId);
          const present = categoryProfessionsPresent.get(catId) ?? new Set();
          const suggestions = professions
            .filter((p) => p.categoryId === catId && !present.has(p.id))
            .slice(0, 5)
            .map((p) => p.name);
          return `  - **${cat?.name ?? catId}** (${count}x covered) — e.g. still open: ${suggestions.join(', ') || '(catalog for this category already exhausted)'}`;
        })
        .join('\n');

      const chapterHeader = chapterInfo
        ? [
            `Meeting: ${[chapterInfo.meetingDay, chapterInfo.meetingTime].filter(Boolean).join(', ')}${chapterInfo.meetingType ? ` (${chapterInfo.meetingType})` : ''}`,
            chapterInfo.locationName || chapterInfo.address
              ? `Location: ${[chapterInfo.locationName, chapterInfo.address, chapterInfo.postalCode, chapterInfo.city].filter(Boolean).join(', ')}`
              : null,
            chapterInfo.totalMemberCount ? `Officially reported member count: ${chapterInfo.totalMemberCount}` : null,
            chapterInfo.visitChapterUrl ? `Visit as a guest: ${chapterInfo.visitChapterUrl}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        : null;

      return {
        content: [
          {
            type: 'text',
            text: [
              `**Chapter: ${chapterInfo?.name ?? chapterName}** — ${useResults.length} members found${notes}`,
              chapterHeader,
              `\n**Existing professions:**\n${profList || '  (no data)'}`,
              !taxonomyAvailable
                ? `\n**Whitespace analysis currently unavailable** (official profession taxonomy not reachable live — the raw profession list above is still complete).`
                : [
                    `\n**Fully unoccupied categories (full whitespace potential):**\n${emptyCategories.map((c) => `  - ${c.name}`).join('\n') || '  (none — every category represented)'}`,
                    `\n**Categories with low coverage (1-2 members) — specific open professions:**\n${thinCategoryList || '  (no thinly-covered categories)'}`,
                    unmatched.size > 0
                      ? `\n**Unmatched free-text professions** (not in the official catalog — possibly a typo or niche profession):\n${[...unmatched].map((p) => `  - ${p}`).join('\n')}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    }

    if (name === 'bni_event_detail') {
      const { site: siteId, eventId } = args as { site: string; eventId: string };
      const site = resolveSiteById(siteId);
      if (!site) {
        return { content: [{ type: 'text', text: `Unknown site "${siteId}". See bni_list_countries.` }], isError: true };
      }

      let config;
      try {
        config = await discoverSiteConfig(site);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Could not resolve site config: ${msg}` }], isError: true };
      }

      const encodedEventId = extractEncodedParam(eventId, 'eventId') ?? eventId;
      const detail = await getEventDetail(site, config, encodedEventId);
      if (!detail) {
        return { content: [{ type: 'text', text: 'Event not found.' }] };
      }

      const lines = [
        `**${detail.title}**`,
        detail.contactName ? `Contact: ${detail.contactName}${detail.contactPhone ? `, tel. ${detail.contactPhone}` : ''}` : null,
        detail.costMembers || detail.costNonMembers
          ? `Cost: members ${detail.costMembers ?? '?'} / non-members ${detail.costNonMembers ?? '?'}`
          : null,
        detail.location ? `Location: ${detail.location}` : null,
        detail.registrationCount !== undefined ? `Registrations so far: ${detail.registrationCount}` : null,
        detail.description ? `\n${detail.description}` : null,
      ].filter(Boolean);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
```

- [ ] **Step 3: Remove the now-empty "not yet implemented" stub**, keeping only the final unknown-tool fallback already present at the bottom of the switch (`return { content: [{ type: 'text', text: \`Unknown tool: ${name}\` }], isError: true };`).

- [ ] **Step 4: Build, then manually verify**

Run: `npm run build`

Then a stdio smoke test calling `bni_chapter_gaps` with `{ chapterName: "<a real chapter name>", country: "DE" }` (pick one from a `bni_search` call first if you don't have one handy).
Expected: chapter meeting header, existing-profession list, and whitespace sections all render with real data.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire remaining tools (member detail, chapter gaps, event detail)"
```

```json:metadata
{"files": ["src/index.ts"], "verifyCommand": "npm run build", "acceptanceCriteria": ["bni_member_detail enriches with chapter info when chapterId present", "unknown site or discovery failure returns clear error not crash", "bni_chapter_gaps runs full category whitespace analysis with graceful taxonomy-unavailable degradation", "bni_event_detail accepts raw id or full URL", "no stub remains, live smoke test succeeds"], "modelTier": "standard"}
```

---

## Task 13: README with the mandatory ToS disclaimer

**Goal:** A new, English-only README written from this project's actual scope — not a translated edit of the old one (design §9) — documenting all 10 tools and stating the ToS risk plainly (design §8: no "personal use is exempt" framing).

**Files:**
- Create: `README.md`

**Acceptance Criteria:**
- [ ] Documents all 10 tools with their purpose
- [ ] Explains the country/site registry model (one country can have multiple sites; `bni_list_countries` is the discovery entry point)
- [ ] States plainly that using this tool may conflict with BNI's Terms of Service ("No Automated Querying"), that it's provided for personal/informational use at the user's own risk, and that higher-stakes use should seek BNI's written permission or independent legal advice — no claim that personal use is exempt
- [ ] Mentions the rate limiting behavior and why it exists (courtesy + BNI's own IP-ban threshold)
- [ ] Installation section for `npx mcp-bni`

**Verify:** Manual read-through against the Acceptance Criteria above (this is a documentation task; there is no automated check)

**Steps:**

- [ ] **Step 1: Write `README.md`**

```markdown
# mcp-bni

MCP server for searching BNI (Business Network International) members and chapters worldwide, built against BNI's own public "find a member" pages — no login required, no data stored.

## What it does

| Tool | Purpose |
|---|---|
| `bni_search` | Search members in a country (fans out across every registered site for that country) |
| `bni_member_detail` | Full public profile: phone, email, website, bio, chapter, chapter meeting info |
| `bni_chapter_gaps` | Whitespace analysis for a chapter against the official BNI profession taxonomy |
| `bni_list_countries` | Every registered country code and its known site(s) |
| `bni_upcoming_events` | Public events (trainings, webinars, regional visitor days) |
| `bni_event_detail` | Full event details: contact, cost, location, registration count |
| `bni_list_regions` | Official BNI regions for a country |
| `bni_list_event_types` | Official event-type names — good search terms for `bni_upcoming_events` |
| `bni_list_professions` | The official worldwide BNI profession catalog |
| `bni_enrich_member` | LinkedIn search URL + suggested web searches (no external requests) |

## How countries work

A "country" can have more than one registered **site** — most countries have exactly one national member database, but some (large markets where BNI never built a single national entry point) are split into regional sites instead. `bni_search`, `bni_upcoming_events`, `bni_list_regions`, and `bni_list_event_types` automatically query every registered site for the country you ask about (capped at 5 per call; the response says so explicitly if more exist). `bni_list_countries` shows exactly what's registered.

New sites are added by finding their public "find a member" page URL — no reverse engineering needed; the technical IDs are discovered automatically and cached (see `src/registry/discovery.ts`).

## Installation

```bash
npx -y mcp-bni@latest
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bni": {
      "command": "npx",
      "args": ["-y", "mcp-bni@latest"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add bni -- npx -y mcp-bni@latest
```

## Important: BNI's Terms of Service

BNI Connect's Terms of Service contain a "No Automated Querying" clause: *"You may not send automated queries of any sort to the BNI Sites or its systems without express written permission in advance from BNI."* This term is written broadly enough that it plausibly covers the public country "find a member" sites this tool queries, not only the login-gated BNI Connect app — they run on the same backend platform.

**This is not resolved by personal, low-volume, or rate-limited use** — those reduce practical/enforcement risk, they do not change whether an automated request is textually "automated" under the clause. This tool is provided for personal/informational use, at your own risk. If your use case has higher stakes (commercial use, wide redistribution, high volume), seek BNI's written permission or independent legal advice before relying on it.

## Rate limiting

Every request to a BNI host is spaced by a minimum delay and multi-site queries run sequentially, never in parallel (see `src/rate-limit.ts`). This is partly courtesy and partly self-preservation — BNI's own infrastructure temporarily IP-bans clients that exceed its own request rate, so staying well under that threshold is also just practical.

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with tool reference and ToS disclaimer"
```

```json:metadata
{"files": ["README.md"], "verifyCommand": "grep -q 'No Automated Querying' README.md && grep -q 'not resolved by personal' README.md", "acceptanceCriteria": ["all 10 tools documented", "country/site registry model explained", "ToS risk stated plainly without personal-use-exempt framing", "rate limiting explained", "npx installation documented"], "modelTier": "mechanical"}
```

---

## Task 14: Migrate skill files to English + new tool signatures

**Goal:** Port the two Claude Skills (`bni-prospecting`, `bni-chapter-prep`) fully to English and update their tool-call references for the new `country`-scoped signatures (design §10).

**Files:**
- Create: `skills/bni-prospecting.md`
- Create: `skills/bni-chapter-prep.md`

**Acceptance Criteria:**
- [ ] Both files are fully English (no leftover German words in headers/output format)
- [ ] Every `bni_search`/`bni_chapter_gaps` reference includes the now-required `country` argument
- [ ] Example usage sections use English example prompts

**Verify:** Manual read-through — no German words remain, tool call examples match the current schemas from Task 10/11/12

**Steps:**

- [ ] **Step 1: Create `skills/bni-prospecting.md`**

```markdown
---
name: bni-prospecting
description: Find matching BNI members for a product/service and prepare personalized 1:1 outreach
---

# BNI Prospecting

You help find BNI members who are ideal targets for a specific product, service, or SaaS solution, and prepare personalized outreach.

## Workflow

1. **Understand the product**: Extract target personas (job titles, industries, company sizes, pain points) from the user's description.

2. **Translate to BNI search terms**: Map personas to BNI profession categories (see `bni_list_professions`), e.g. "SaaS for HR" → search "HR manager", "HR", "recruiter".

3. **Search**: Call `bni_search` with a `country` and 2-3 relevant keyword variations. If the user mentions a city/region, add that filter.

4. **Filter**: From results, identify the 5-10 best matches based on profession + company fit.

5. **Enrich top matches**: For the top 5, call `bni_enrich_member` to get LinkedIn/website search links.

6. **Draft outreach**: For each top match, write a short personalized 1:1 meeting request:
   - Reference their specific profession/specialty
   - Connect it to what you offer (concrete value, no pitch)
   - Suggest a 20-minute 1:1 at their next chapter meeting or via video call
   - BNI tone: warm, Givers Gain, relationship-first

## Output Format

Present results as a table:

| Name | Chapter | Profession | Company | 1:1 pitch |
|------|---------|------------|---------|-----------|
| ... | ... | ... | ... | Short personalized opening |

Then provide the top 3 full outreach messages (copy-paste ready).

## Example Usage

> "I sell Verora, a SaaS solution for digital onboarding at trade businesses. Which BNI members are a good fit?"

→ Search (country: "DE"): "trade business", "master craftsman", "business owner"
→ Filter for regions near the user's chapter
→ Output: table + 3 personalized 1:1 messages
```

- [ ] **Step 2: Create `skills/bni-chapter-prep.md`**

```markdown
---
name: bni-chapter-prep
description: Prepare a briefing before visiting a BNI chapter as a guest or member
---

# BNI Chapter Prep

You prepare a concise briefing before visiting a BNI chapter — whether as a guest or when preparing a chapter visit for networking.

## Workflow

1. **Load chapter members**: Call `bni_search` with the chapter name as keyword and the relevant `country`.

2. **Analyze gaps**: Call `bni_chapter_gaps` with the chapter name and `country`.

3. **Identify top contacts**: From the member list, pick 3-5 people most relevant for the user's business/goals. Consider:
   - Potential referral partners (complementary, not competing)
   - People in anchor professions (tax advisor, lawyer, realtor = high referral volume)
   - People whose clients match the user's target customer

4. **Prepare conversation starters**: For each top contact, write one specific ice-breaker based on their profession.

5. **Whitespace briefing**: Present missing professions as opportunities — either to recruit or to note as referral gaps.

## Output Format

### Chapter: [Name]
**Members:** X | **Date:** [if known]

**Top 3 contacts for you:**
1. **Name** — Profession, Company
   → Conversation starter: "..."
2. ...
3. ...

**Profession gaps (whitespace):**
- Missing profession 1 — Opportunity: ...
- Missing profession 2 — Opportunity: ...

**All members:** [compact list]

## Example Usage

> "I'm visiting the Frankfurt Römer chapter as a guest next week. Prepare me."

> "Which chapters in my region still don't have a marketing consultant?"
→ Search multiple chapters (same country), filter by profession gaps
```

- [ ] **Step 3: Commit**

```bash
git add skills/bni-prospecting.md skills/bni-chapter-prep.md
git commit -m "docs: migrate skills to English and new tool signatures"
```

```json:metadata
{"files": ["skills/bni-prospecting.md", "skills/bni-chapter-prep.md"], "verifyCommand": "grep -riE 'beruf|firma|mitglieder|datum|branchenl' skills/*.md || echo clean", "acceptanceCriteria": ["both files fully English", "bni_search/bni_chapter_gaps references include country argument", "example prompts in English"], "modelTier": "mechanical"}
```
