# mcp-bni v2: BNI Global rewrite — design

Status: approved by user, pending written-spec review
Date: 2026-09-25
Supersedes: the current `si0nDE/mcp-bni` codebase (fork now deleted; this is an
independent rewrite, not a continuation of it)

## 1. Why this exists

The current tool (single-file `index.ts`, ~1246 lines) supports exactly two
BNI regions (Germany/Austria via `bni.de`, Switzerland via `bni.swiss`) through
a hardcoded `BNI_COUNTRIES` map with manually reverse-engineered `website_id`/
`countryIds` values per country. Extending this to "BNI Global" the same way
would mean manually reverse-engineering dozens of country sites by hand —
not scalable, and contrary to the project's established preference for
reading data live rather than freezing it in code.

During this session we validated a much better mechanism (§3) and decided to
do a clean-room rewrite rather than keep extending the old file, for two
independent reasons:
- **Legal**: the old code is a derivative of a third party's (Alexander
  Buchmann / Altovate GmbH) MIT-licensed original. A full independent rewrite
  (new architecture, new language, no copied expression) is not bound by
  that project's attribution requirement, since MIT's obligation attaches to
  *retained expression*, not to "solving the same problem." A half-measure
  (same structure, translated strings) would *not* achieve this — see §9.
- **Practical**: "BNI Global" needs a fundamentally different country model
  (§3) than the current 2-entry hardcoded map; this is a rebuild, not an
  incremental patch.

## 2. Scope decisions made this session

| Question | Decision |
|---|---|
| Country onboarding | Hybrid: curated list of known site URLs + live auto-discovery of technical params (§3) |
| Output language | English only, in code and in all tool output text. No i18n system — the calling LLM translates for the end user if needed. Keep output dense/token-lean. |
| Failure handling | Fail clearly with a specific error when discovery/data is unavailable. Never silently guess or return partial data unlabeled. |
| Package/repo name | `mcp-bni` |
| Publishing | Private GitHub repo. Still published as a public npm package (`mcp-bni`) so it stays installable via `npx`. |
| License | MIT |
| Testing | Unit tests against recorded real HTML/JSON fixtures (captured once per endpoint type), run in CI without a live dependency. Live verification against the real BNI sites stays a manual/ad-hoc supplement, not a CI dependency. |
| Rate limiting | Built in (§6) — partly courtesy, partly because BNI's own infrastructure temporarily IP-bans clients that send too many requests, so this is also self-preservation. |

## 3. Country registry

### 3.1 Core insight (validated live this session)

Every BNI "find a member" page we checked — across completely different
domains, TLDs, and continents (`bni.de`, `bnifrance.fr`, `bni.co.uk`,
`bni.co.za`, `bni.jp`, and three unrelated US regional sites) — embeds its
`website_id` and `countryIds` as **plain hidden `<input>` fields in the
static HTML**, e.g.:

```html
<input type="hidden" name="countryIds" id="countryIds2" value="3655">
<input type="hidden" id="website_id" value="6705">
```

No JS execution or network-trace archaeology is needed to extract these —
one GET request + a `cheerio` selector. We also confirmed the language ID
sent alongside a query does **not** need to be the exact internal numeric
ID for the search to return correct, correctly-localized results — a
plausible placeholder (locale code parsed from the URL, e.g. `fr` from
`/fr/trouverunmembre`) is sufficient. This makes per-country onboarding a
data-entry problem (which URLs exist), not a reverse-engineering problem
(what are this country's internal IDs).

### 3.2 Data model

A **site** is one independently-queryable BNI member database/search
endpoint. It may cover an entire country (most cases) or only a region
within one (e.g. US states/metros, where BNI has no single national entry
point). Sites are grouped by `countryCode` — a country is not a single
config object anymore, it's "however many sites are registered under this
code."

```typescript
interface BniSiteLanguage {
  /** Locale parsed from the URL (e.g. "fr", "de-CH", "en-GB") — no internal numeric ID required. */
  locale: string;
  /** The human "find a member" page for this language variant. */
  findMemberUrl: string;
}

interface BniSite {
  /** Stable key, e.g. "de-at", "ch", "us-wisconsin", "us-socal", "fr". */
  id: string;
  countryCode: string;   // groups sites for country-scoped queries, e.g. "US"
  label: string;         // human label, e.g. "Wisconsin", "Southern California", "Frankreich"
  baseUrl: string;       // derived from findMemberUrl's origin
  languages: BniSiteLanguage[]; // first = default
}

interface BniSiteConfig {
  websiteId: string;
  countryIds: string;   // comma-joined, matches what the discovered site itself uses
}
```

`BniSite` entries are the curated part — seeded from the ~45-country list
already researched (saved in full in
[2026-09-25-bni-country-sites-research.md](2026-09-25-bni-country-sites-research.md)),
one entry per confirmed national site, plus (as they're gathered over time)
additional regional entries for countries with no national site (US, Brazil,
Spain, Indonesia, ...). Adding a new site later is "append one object,"
never an architecture change.

`BniSiteConfig` (the technical params) is **never stored statically** — it's
discovered on first use per site and cached in-process (same TTL-cache
pattern already used for the profession taxonomy; proposed TTL: 24h, since
these IDs are effectively permanent once assigned, longer than the
taxonomy's 6h because there's no expectation of frequent change).

```typescript
async function discoverSiteConfig(site: BniSite): Promise<BniSiteConfig> {
  // GET site.languages[0].findMemberUrl, parse the two hidden inputs.
  // Throws a specific, actionable error if either input is missing —
  // never falls back to a guess.
}
```

### 3.3 Country-scoped queries and the fan-out cap

A tool call scoped to `country: "US"` resolves to *all* `BniSite` entries
with that `countryCode`, queries them **sequentially** (§6), and merges
results. If a country has more registered sites than the fan-out cap
(default: 5), the tool queries the first 5 and says so explicitly in the
output ("results from 3 of 3 known regions" / "results from 5 of 12 known
regions — narrow with a specific region to see the rest") — never silently
partial.

### 3.4 Adding a country/region later

Purely additive: find the "find a member" URL, add one `BniSite` entry
(country code + label + URL). No code change, no re-verification of IDs —
discovery handles that at runtime.

## 4. Existing tools carried forward (English, generalized to N sites)

All ported to the new registry, output text translated, behavior otherwise
unchanged from what already works today:

- `bni_search`, `bni_member_detail`, `bni_chapter_gaps` (taxonomy-based
  whitespace analysis), `bni_enrich_member`
- `bni_list_countries` (now lists every registered site, grouped by country)
- `bni_list_professions`, `bni_chapter_gaps`'s taxonomy source — unchanged:
  still live-fetched from the same public taxonomy source, cached. This
  taxonomy is BNI's own *global* classification (confirmed via BNI's own
  FAQ PDF: unified across BNI Global since 2017), so it's valid for every
  country, not just Germany/Austria — no change needed there.
- `bni_upcoming_events`, `bni_event_detail`, `bni_list_regions`,
  `bni_list_event_types` — same mechanism, now parameterized over any
  registered site instead of just `de-at`/`ch`.

No new tools planned in this rewrite; scope is "generalize what exists,"
not "add features."

## 5. Module structure

The current single 1246-line `index.ts` is past the point of being easy to
reason about. Proposed split (names indicative):

```
src/
  index.ts              — MCP server wiring, tool registration/dispatch only
  registry/
    sites.ts            — curated BniSite[] list (the ~45+ entries)
    discovery.ts         — discoverSiteConfig() + cache
  taxonomy.ts            — unchanged from today (live-fetched profession catalog)
  bni-client/
    search.ts            — member search + detail scraping
    chapter-info.ts       — chapter meeting info
    events.ts             — event calendar + event detail
    regions.ts            — region + event-type lists
  rate-limit.ts           — shared request pacing (§6)
tests/
  fixtures/               — recorded HTML/JSON per endpoint per representative site
  *.test.ts
```

Each module should be understandable and testable without reading the
others' internals — `bni-client/*` modules depend on `rate-limit.ts` and a
resolved `BniSite`+`BniSiteConfig`, nothing else.

## 6. Rate limiting

- Minimum delay (default 300–500ms, configurable) between consecutive
  outbound requests to the *same host*, enforced automatically, not
  optional.
- Fan-out queries (§3.3) run **sequentially**, never in parallel, so the
  delay is meaningful and no burst of simultaneous connections is ever sent
  to one host.
- Fan-out cap of 5 sites per country-scoped call by default (§3.3).
- Rationale is dual: courtesy, and self-preservation — BNI's own
  infrastructure temporarily IP-bans clients that exceed its own rate
  limits, so staying well under that threshold is also just practical.

## 7. Testing

- Fixtures: real recorded HTML/JSON responses for each endpoint type
  (member search, member detail, chapter info, event calendar, event
  detail, region list, event-type list) from a small representative set of
  sites (at minimum: one European national site, one non-Latin-script site
  if fixture capture is feasible, one US regional site) — enough to exercise
  the parsing logic without hitting the network in CI.
- Unit tests assert the parsers extract the right fields from those
  fixtures.
- Discovery logic gets its own fixture-based tests (hidden-input parsing,
  including a fixture where the inputs are *missing*, to verify the clear-
  failure path).
- Live verification against real BNI sites remains a manual/ad-hoc step
  (as done throughout this session), not part of CI.

## 8. Legal / ToS posture — must be stated honestly in the README

BNI Connect's own Terms of Service (linked from `bnitos.com`, current as of
this session: `ToS-BNI-Connect-Revised-Nov-15-2025`) contain:

> "B. No Automated Querying. You may not send automated queries of any sort
> to the BNI Sites or its systems without express written permission in
> advance from BNI."

"BNI Sites" is defined broadly enough ("BNI's related websites, ... APIs, ...
any other related services") that it plausibly covers the per-country
"find a member" sites this tool queries, not just the login-gated BNI
Connect app — they share the same backend platform (`bniconnectglobal.com`
assets, identical `bnicms/v3` endpoints everywhere we checked).

This is **not resolved** by this project being private, personal, low-
volume, or rate-limited — those reduce practical/enforcement risk, they do
not change whether an automated request is textually "automated" under the
clause. The README must say this plainly: using this tool may conflict with
BNI's Terms of Service; it is provided for personal/informational use at
the user's own risk; anyone with higher stakes (commercial use, wide
redistribution) should seek BNI's written permission or independent legal
advice before relying on it. No claim of "personal use is exempt" goes in
the README, because it would be inaccurate.

## 9. What "independent rewrite" concretely means

To actually sever the MIT-attribution question (not just relocate the same
code):
- New file layout and names throughout (§5) — not a renamed copy of the old
  single file.
- HTTP/parsing logic re-derived from the live endpoints we tested this
  session (documented in code comments with the actual discovered shape),
  not transcribed/translated from the old `searchMembers`/`getMemberDetail`.
- New README written from the new scope (BNI Global, English), not a
  translated edit of the old one.
- Old repo's git history is not imported; this starts as a fresh
  initialized repo.

## 10. Open items for the implementation plan (not blocking this design)

- Exact initial fixture set (which 2–3 sites) — pick during implementation.
- Whether `bni_list_countries` output groups by country in a flat list or
  a nested one — a formatting detail, not an architectural one.
- Migrating the two existing skill files (`bni-prospecting.md`,
  `bni-chapter-prep.md`) to English — in scope, low-risk, sequenced late.
