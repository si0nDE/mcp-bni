#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BNI_SITES } from './registry/sites';
import { matchProfession, getProfessions, getProfessionCategories } from './taxonomy';
import { resolveSitesForCountry, resolveSiteById } from './registry/resolve';
import { discoverSiteConfig } from './registry/discovery';
import {
  searchMembers,
  BniMember,
  SearchMatchMode,
  matchesKeywords,
  defaultMatchMode,
  splitChapterAndRegion,
} from './bni-client/search';
import { getUpcomingEvents, getEventDetail, BniEvent } from './bni-client/events';
import { getRegions, getEventTypeNames } from './bni-client/regions';
import { listChapterOptions, matchChapterOption, BniChapterOption } from './bni-client/chapters';
import { getMemberDetail, extractEncodedParam } from './bni-client/member-detail';
import { getChapterInfo, BniChapterInfo } from './bni-client/chapter-info';
import { BniSite } from './registry/types';

const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

const FAN_OUT_CAP = 5;

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

// BNI's own member-search "keywords" field does broad, seemingly OR-based full-text matching
// (confirmed live during Task 12 — see the bni_chapter_gaps handler below for the case where this
// broke a result entirely). bni_search relays the caller's keywords verbatim, so a common or
// multi-word term can silently return a large, effectively unfiltered result set that looks like a
// normal successful search. Per the "fail clearly, never silently partial" design constraint, flag
// this explicitly instead of staying silent about it — this does not change what's searched or
// returned, only whether the caller is told a site's count is suspiciously high.
const SWAMPED_RESULT_THRESHOLD = 200; // observed live per-site cap is ~250; this leaves margin.

function swampNote(perSiteCounts: Map<string, number>): string {
  const swamped = [...perSiteCounts.entries()].filter(([, count]) => count >= SWAMPED_RESULT_THRESHOLD).map(([id]) => id);
  if (swamped.length === 0) return '';
  return `\n(Note: site(s) ${swamped.join(', ')} returned ${SWAMPED_RESULT_THRESHOLD}+ results for this keyword — BNI's search matches broadly across name/profession/company rather than requiring an exact/AND match, so a common or multi-word term can return a large, possibly unfocused result set. Try a more specific keyword or add "city" to narrow it down.)`;
}

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_CEILING = 250;

function clampMaxResults(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_RESULTS_CEILING);
}

const FIELD_KEYS = ['name', 'company', 'profession', 'chapter', 'region', 'city', 'district', 'site', 'encryptedMemberId'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function fieldValue(entry: { site: string; member: BniMember }, field: FieldKey): string {
  switch (field) {
    case 'site':
      return entry.site;
    case 'name':
      return entry.member.name;
    case 'company':
      return entry.member.company;
    case 'profession':
      return entry.member.profession;
    case 'chapter':
      return entry.member.chapter;
    case 'region':
      return entry.member.region;
    case 'city':
      return entry.member.city;
    case 'district':
      return entry.member.district;
    case 'encryptedMemberId':
      return entry.member.encryptedMemberId;
  }
}

function formatCompactLine(entry: { site: string; member: BniMember }, index: number, fields: FieldKey[]): string {
  return `${index + 1}. ${fields.map((f) => fieldValue(entry, f)).join(' | ')}`;
}

interface ChapterResolution {
  useResults: Array<{ site: BniSite; member: BniMember }>;
  chapterInfo: BniChapterInfo | null;
  notes: string;
}

/**
 * Shared chapter-roster resolution for bni_chapter_gaps and bni_chapter_members. Always resolves
 * members via a keywords search (never chapterId — see below), but prefers the confirmed exact
 * chapter name from a live listing as the keyword when one is available, over the crude
 * first-word searchToken fallback.
 *
 * Live-verified (bni.de, 2026-09-25): searchMembers's chapterId param (which sets the search
 * form's own "chapterName" field to that id) does NOT actually scope results to that chapter —
 * confirmed by direct request: passing a chapter's own id (from both listChapterOptions's dropdown
 * and its region-fan-out, matching bni_member_detail's independently-derived chapterId exactly)
 * returned either zero results, or every member of that chapter's whole region unfiltered (two
 * different unrelated chapters mixed together), depending on which other form fields were present
 * in the request. Root cause unconfirmed — possibly a different id namespace than this parameter
 * expects — so this function does not use chapterId at all, regardless of source, until that's
 * understood; a chapter matched via the dropdown/fan-out still only feeds its NAME into the
 * keyword search below, same mechanism as the fallback case, just with a lower-collision-risk
 * keyword.
 */
async function resolveChapterMembers(
  country: string,
  rawChapterName: string
): Promise<{ resolution: ChapterResolution } | { errorResponse: ReturnType<typeof noSiteError> }> {
  // Live-verified critical bug fix: bni_search's own default display renders a member's chapter
  // as "<Name> - <Region>" (the same format BNI's own site uses) — a natural, reasonable string
  // for a caller to copy straight back in as chapterName. But every match below (the dropdown
  // lookup and the chapter/region substring filter) expects the bare name. Passing the compound
  // string through unstripped made the substring filter match ZERO members (nameNorm — the whole
  // compound string — isn't contained in any single member's plain chapter or region field),
  // which forced a fallback to the fully unfiltered keyword-search results. Verified live: for
  // chapterName "Juwel Würzburg - Würzburg-Erlangen", this silently returned a mix from several
  // unrelated chapters (incl. "Galaxis BNI (Ulm)"), and index.ts's "representative member" picked
  // that wrong chapter's own meeting/location/count to present as this response's header — with
  // only the same generic "used keyword search, may be approximate" note as the correctly-narrowed
  // case (see isolationFailed below for why that wasn't a strong enough signal). Stripping the
  // suffix here (bni_search's own separator convention — see search.ts) makes every caller of this
  // function behave like the bare-name case regardless of which string form was passed in.
  const chapterName = splitChapterAndRegion(rawChapterName).chapter;

  const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
  if (sites.length === 0) return { errorResponse: noSiteError(country) };

  // Live-verified bug fix: BNI's own member-search "keywords" field does a broad, seemingly
  // OR-based full-text match rather than an exact/AND filter, and is easily swamped. Chapter
  // names (as rendered in bni_search's own "Chapter:" field, which is what a caller naturally
  // passes here) almost always contain the near-universal word "BNI" plus a "(City)" suffix.
  // Passing that full string verbatim as `keywords` was verified live against bni.de to return a
  // near-max-cap, effectively unfiltered listing that can silently omit the target chapter's own
  // members entirely (e.g. "Jet BNI (München)" as keywords returned 249 members, none of them
  // actually in that chapter), which the exact-match filter below then has nothing to recover —
  // producing a wrong-chapter report with no error. Stripping the noise words down to the
  // chapter's own distinctive name (e.g. "Jet") keeps the candidate pool small enough that the
  // exact filter below can actually find the right chapter (verified live: "Jet" alone returns 67
  // members that DO include "Jet BNI (München)").
  const searchToken =
    chapterName
      .replace(/\bBNI\b/gi, '')
      .replace(/\([^)]*\)/g, '')
      .trim()
      .split(/\s+/)[0] || chapterName;

  const allResults: Array<{ site: BniSite; member: BniMember }> = [];
  const failedSites: string[] = [];
  const ambiguousOn: Array<{ site: string; candidates: BniChapterOption[] }> = [];
  let exactChapterMatch = false;
  for (const site of sites) {
    try {
      const config = await discoverSiteConfig(site);
      // Prefer the site's own chapter listing, when it has one: an exact match there gives the
      // chapter's complete roster directly, skipping the keyword heuristic (and its cap) below.
      // Tried against the caller's full chapterName first, then the same distinctive token used
      // for the keyword fallback (the two rarely render identically — e.g. one may carry a
      // "(City)" suffix the other doesn't). A tier that finds 2+ candidates (e.g. a city shared by
      // several chapters) is ambiguous, not resolved — recorded for the caller instead of silently
      // picking one, and the next tier (or the keyword fallback) is tried instead.
      const chapterOptions = await listChapterOptions(site, config).catch(() => []);
      let chapterOption: BniChapterOption | undefined;
      const byName = matchChapterOption(chapterOptions, chapterName);
      if (byName.match) {
        chapterOption = byName.match;
      } else if (byName.candidates.length > 0) {
        ambiguousOn.push({ site: site.id, candidates: byName.candidates });
      } else {
        const byToken = matchChapterOption(chapterOptions, searchToken);
        if (byToken.match) chapterOption = byToken.match;
        else if (byToken.candidates.length > 0) ambiguousOn.push({ site: site.id, candidates: byToken.candidates });
      }
      const members = await searchMembers(site, config, { keywords: chapterOption?.name ?? searchToken });
      if (chapterOption) exactChapterMatch = true;
      for (const member of members) allResults.push({ site, member });
    } catch (err) {
      failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  const nameNorm = chapterName.toLowerCase();
  const chapterMembers = allResults.filter(
    ({ member }) => member.chapter.toLowerCase().includes(nameNorm) || member.region.toLowerCase().includes(nameNorm)
  );
  // Live-verified: when narrowing finds nothing, the fallback below is allResults — every one of
  // this chapter-name's raw, unfiltered keyword-search hits, potentially spanning several
  // unrelated chapters, with no result actually confirmed to be the requested chapter at all. This
  // is a materially higher-risk situation than "narrowing worked, but via a heuristic rather than
  // an exact listing" (the case below), so it gets its own, much more explicit warning rather than
  // being folded into the same generic note.
  const isolationFailed = chapterMembers.length === 0 && allResults.length > 0;
  const useResults = chapterMembers.length > 0 ? chapterMembers : allResults;
  const ambiguityNote =
    ambiguousOn.length > 0
      ? `\n(Ambiguous chapter name — matched multiple chapters on ${ambiguousOn
          .map(({ site, candidates }) => `${site}: ${candidates.map((c) => `"${c.name}"`).join(', ')}`)
          .join('; ')}. Used a keyword search instead of guessing one; the results below are still narrowed by chapter/region name, but pass the exact name from bni_list_chapters to resolve precisely.)`
      : '';
  const notes =
    coverageAndFailureNotes(sites.length, totalKnown, country, failedSites) +
    (isolationFailed
      ? `\n(Could not isolate "${chapterName}" from the keyword search at all — no result's own chapter/region field matched it, so every member, and the chapter identity/meeting/count below, comes from an unverified, unfiltered keyword search that may belong to a different chapter entirely. Do not present this response's chapter details as confirmed; retry with the exact name from bni_list_chapters, or a more specific chapterName.)`
      : exactChapterMatch
        ? ''
        : `\n(No exact chapter listing found for this name — searched using a derived keyword ("${searchToken}") rather than a confirmed exact name; results are narrowed by matching chapter/region name, which is a heuristic, not a guarantee. Try bni_list_chapters for the exact name.)`) +
    ambiguityNote;

  // Chapter meeting logistics, resolved via one representative member.
  let chapterInfo: BniChapterInfo | null = null;
  if (useResults.length > 0) {
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
  }

  return { resolution: { useResults, chapterInfo, notes } };
}

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
        'Searches the public BNI member directory for a country. Fans out across every registered site for that country (capped; see bni_list_countries). BNI\'s own search matches each word in "keywords" independently (OR-style) up to 250 raw results per site; for a multi-word keywords this tool then narrows the raw matches down by matchMode before returning (default 20 results — raise maxResults for more).',
      inputSchema: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: 'Search term: name, profession, company, or specialty (e.g. "Marketing", "Tax advisor")' },
          city: { type: 'string', description: 'Filters by exact stored city — use keywords for anything less precise' },
          matchMode: {
            type: 'string',
            enum: ['phrase', 'all', 'any'],
            description:
              'How a multi-word "keywords" is narrowed against BNI\'s raw (broad, OR-style) match: "phrase" (default) requires the exact phrase; "all" requires every word present in any order; "any" disables narrowing and returns BNI\'s raw unfiltered match. No effect on a single word.',
          },
          maxResults: {
            type: 'number',
            description: 'Caps how many matched members are returned (default 20, max 250). The full raw result set is still fetched and matched first; this only truncates the response.',
          },
          fields: {
            type: 'array',
            items: { type: 'string', enum: [...FIELD_KEYS] },
            description:
              'Restrict each result to just these fields, e.g. ["name","company","profession","city"], for a compact one-line-per-member response. Omit for the full default format.',
          },
          ...COUNTRY_PROP,
        },
        required: ['country'],
      },
    },
    {
      name: 'bni_member_detail',
      description:
        'Fetches a member\'s full public profile: phone, email, website, title, chapter, chapter meeting info if resolvable, and their bio broken into BNI\'s standard sections where available (My Business, Top Product, Ideal Referral, Ideal Referral Partner, Top Problem Solved, Favorite BNI Story) — the Ideal Referral Partner section is the most direct signal for who to introduce this member to.',
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
        'Analyzes a chapter: lists existing professions with counts, and identifies whitespace using the official BNI profession taxonomy (empty categories + specific open professions in thinly-covered categories). Resolves the chapter\'s exact name via bni_list_chapters where possible and uses that as the search keyword (still subject to the ~250-result-per-site cap, but with a low-collision-risk exact name rather than a guessed word). The taxonomy itself is German-only; a member\'s own free-text profession can be in a different language, which is the usual cause when it shows up as "unmatched" rather than being a data error — translate as needed for the person you\'re presenting results to.',
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
      name: 'bni_chapter_members',
      description:
        'Lists every member of a chapter by name, with company/profession/city — a compact roster. Complements bni_chapter_gaps (which analyzes professions/whitespace but omits names) without needing a bni_search keyword workaround. Resolves the chapter\'s exact name via bni_list_chapters where possible and uses that as the search keyword (still subject to the ~250-result-per-site cap, but with a low-collision-risk exact name rather than a guessed word).',
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
      name: 'bni_list_chapters',
      description:
        'Lists the exact, complete chapter names for a country, where available. Chapters found this way are used by bni_chapter_gaps/bni_chapter_members as a precise search keyword instead of a guessed word (still subject to the ~250-result-per-site cap); sites that don\'t expose this list are noted as such. First call for a country whose site builds this list region-by-region (rather than serving it directly) can take significantly longer (dozens of seconds) as a result; cached in-process afterward.',
      inputSchema: { type: 'object', properties: { ...COUNTRY_PROP }, required: ['country'] },
    },
    {
      name: 'bni_list_event_types',
      description: 'Lists the official BNI event-type names for a country — useful search terms for bni_upcoming_events.',
      inputSchema: { type: 'object', properties: { ...COUNTRY_PROP }, required: ['country'] },
    },
    {
      name: 'bni_list_professions',
      description:
        'Lists the official BNI worldwide profession catalog (professions + categories), searchable and filterable. Names are German-only (the taxonomy source has no other-language variant) — translate for the person you\'re presenting results to if needed.',
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

    if (name === 'bni_search') {
      const {
        keywords,
        city,
        country,
        matchMode: matchModeArg,
        maxResults: maxResultsArg,
        fields: fieldsArg,
      } = args as {
        keywords?: string;
        city?: string;
        country: string;
        matchMode?: SearchMatchMode;
        maxResults?: number;
        fields?: string[];
      };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const results: Array<{ site: string; member: BniMember }> = [];
      const perSiteCounts = new Map<string, number>();
      const failedSites: string[] = [];

      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const members = await searchMembers(site, config, { keywords, city });
          perSiteCounts.set(site.id, members.length);
          for (const member of members) results.push({ site: site.id, member });
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const notes = coverageAndFailureNotes(sites.length, totalKnown, country, failedSites) + swampNote(perSiteCounts);

      // BNI's own "keywords" match is broad/OR-style server-side (see swampNote above) — narrow
      // the already-fetched results client-side by default for a multi-word query, without ever
      // asking the server for anything it didn't already return (so this can't hide a real match).
      const effectiveMode: SearchMatchMode = matchModeArg ?? defaultMatchMode(keywords);
      const narrowed = keywords ? results.filter((r) => matchesKeywords(r.member, keywords, effectiveMode)) : results;
      const narrowedNote =
        keywords && effectiveMode !== 'any' && narrowed.length !== results.length
          ? `\n(${results.length} raw match(es) for this keyword narrowed to ${narrowed.length} using matchMode="${effectiveMode}"; pass matchMode:"any" for BNI's unfiltered broad match.)`
          : '';

      if (narrowed.length === 0) {
        const hint =
          results.length > 0
            ? ` (${results.length} raw match(es) existed before matchMode="${effectiveMode}" narrowing — try matchMode:"any" to see them.)`
            : '';
        return { content: [{ type: 'text', text: `No members found.${hint}${notes}` }] };
      }

      const limit = clampMaxResults(maxResultsArg);
      const shown = narrowed.slice(0, limit);
      const truncatedNote =
        narrowed.length > limit ? `\n(Showing ${limit} of ${narrowed.length} — raise maxResults to see more.)` : '';

      const validFields: FieldKey[] = Array.isArray(fieldsArg)
        ? fieldsArg.filter((f): f is FieldKey => (FIELD_KEYS as readonly string[]).includes(f))
        : [];

      const text =
        validFields.length > 0
          ? shown.map((r, i) => formatCompactLine(r, i, validFields)).join('\n')
          : shown
              .map(
                ({ site, member }, i) =>
                  // Chapter and region are kept on separate lines deliberately (not joined as
                  // "Chapter - Region" on one line): a caller passing this display text straight
                  // back into bni_chapter_gaps/bni_chapter_members's chapterName would otherwise
                  // pass a compound string those tools don't expect — see resolveChapterMembers.
                  `${i + 1}. **${member.name}** | ${member.company}\n   Profession: ${member.profession}\n   Chapter: ${member.chapter}${member.region ? `\n   Region: ${member.region}` : ''}\n   City: ${member.city}${member.district ? ` (${member.district})` : ''}\n   Site: ${site} | ID: ${member.encryptedMemberId}`
              )
              .join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `**${narrowed.length} member(s) matched** (max 250 raw per site)${narrowedNote}${notes}${truncatedNote}\n\n${text}`,
          },
        ],
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

    if (name === 'bni_list_chapters') {
      const { country } = args as { country: string };
      const { sites, totalKnown } = resolveSitesForCountry(country, FAN_OUT_CAP);
      if (sites.length === 0) return noSiteError(country);

      const chaptersBySite: Array<{ site: string; chapters: BniChapterOption[] }> = [];
      const unsupportedSites: string[] = [];
      const failedSites: string[] = [];
      for (const site of sites) {
        try {
          const config = await discoverSiteConfig(site);
          const chapters = await listChapterOptions(site, config);
          if (chapters.length === 0) unsupportedSites.push(site.id);
          else chaptersBySite.push({ site: site.id, chapters });
        } catch (err) {
          failedSites.push(`${site.id} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const notes =
        coverageAndFailureNotes(sites.length, totalKnown, country, failedSites) +
        (unsupportedSites.length > 0
          ? `\n(No chapter listing exposed for: ${unsupportedSites.join(', ')} — bni_chapter_gaps falls back to keyword search there.)`
          : '');

      const totalChapters = chaptersBySite.reduce((sum, s) => sum + s.chapters.length, 0);
      if (totalChapters === 0) {
        return { content: [{ type: 'text', text: `No chapter listing available for "${country}".${notes}` }] };
      }

      const text = chaptersBySite
        .map(
          ({ site, chapters }) =>
            `**${site}** (${chapters.length})\n${chapters.map((c) => `  - ${c.name}`).join('\n')}`
        )
        .join('\n\n');

      return { content: [{ type: 'text', text: `**${totalChapters} chapters**${notes}\n\n${text}` }] };
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
        `Phone: ${detail.phone ?? '(not shown on the public profile)'}`,
        `Email: ${detail.email ?? '(not shown on the public profile)'}`,
        `Website: ${detail.website ?? '(not shown on the public profile)'}`,
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
        detail.bioFormat === 'freetext'
          ? `\n(Profile uses one freetext bio, not BNI's structured sections — no separate My Business/Top Product/Ideal Referral/Ideal Referral Partner/Top Problem Solved/Favorite BNI Story fields exist for this member, rather than those specifically being left blank.)`
          : null,
        detail.bio ? `\nBio: ${detail.bio}` : null,
        detail.businessDescription ? `\nMy Business: ${detail.businessDescription}` : null,
        detail.topProduct ? `\nTop Product: ${detail.topProduct}` : null,
        detail.idealReferral ? `\nIdeal Referral: ${detail.idealReferral}` : null,
        detail.idealReferralPartner ? `\nIdeal Referral Partner (who to introduce them to): ${detail.idealReferralPartner}` : null,
        detail.topProblemSolved ? `\nTop Problem Solved: ${detail.topProblemSolved}` : null,
        detail.favoriteStory ? `\nFavorite BNI Story: ${detail.favoriteStory}` : null,
        `\nProfile: ${detail.profileUrl}`,
      ].filter(Boolean);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'bni_chapter_gaps') {
      const { chapterName, country } = args as { chapterName: string; country: string };
      const resolved = await resolveChapterMembers(country, chapterName);
      if ('errorResponse' in resolved) return resolved.errorResponse;
      const { useResults, chapterInfo, notes } = resolved.resolution;

      if (useResults.length === 0) {
        return { content: [{ type: 'text', text: `No members found for chapter "${chapterName}".${notes}` }] };
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
                      ? `\n**Unmatched free-text professions** (no match in the official catalog, which is German-only — likely because the member's stored profession text is in a different language, rather than a typo or a genuinely uncategorized profession; translate if useful before presenting to the user):\n${[...unmatched].map((p) => `  - ${p}`).join('\n')}`
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

    if (name === 'bni_chapter_members') {
      const { chapterName, country } = args as { chapterName: string; country: string };
      const resolved = await resolveChapterMembers(country, chapterName);
      if ('errorResponse' in resolved) return resolved.errorResponse;
      const { useResults, chapterInfo, notes } = resolved.resolution;

      if (useResults.length === 0) {
        return { content: [{ type: 'text', text: `No members found for chapter "${chapterName}".${notes}` }] };
      }

      const sorted = [...useResults].sort((a, b) => a.member.name.localeCompare(b.member.name));
      const text = sorted
        .map(
          ({ site, member }, i) =>
            `${i + 1}. **${member.name}** | ${member.company} | ${member.profession} | ${member.city}${member.district ? ` (${member.district})` : ''} | Site: ${site.id} | ID: ${member.encryptedMemberId}`
        )
        .join('\n');

      const countNote = chapterInfo?.totalMemberCount ? ` (officially reported: ${chapterInfo.totalMemberCount})` : '';

      return {
        content: [
          {
            type: 'text',
            text: `**Chapter: ${chapterInfo?.name ?? chapterName}** — ${useResults.length} member(s)${countNote}${notes}\n\n${text}`,
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
