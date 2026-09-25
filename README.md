# mcp-bni

MCP server for searching BNI (Business Network International) members and chapters worldwide, built against BNI's own public "find a member" pages — no login required, no data stored.

## What it does

| Tool | Purpose |
|---|---|
| `bni_search` | Search members in a country (fans out across every registered site for that country) |
| `bni_member_detail` | Full public profile: phone, email, website, chapter, chapter meeting info, and bio split into BNI's standard sections (My Business, Ideal Referral, Ideal Referral Partner, Top Problem Solved, Top Product, Favorite BNI Story) where the profile has them |
| `bni_chapter_gaps` | Whitespace analysis for a chapter against the official BNI profession taxonomy — resolves the chapter exactly via `bni_list_chapters` where possible, instead of an approximate keyword search |
| `bni_list_countries` | Every registered country code and its known site(s) |
| `bni_list_chapters` | Exact chapter names (and internal ids) for a country, where the site exposes them |
| `bni_upcoming_events` | Public events (trainings, webinars, regional visitor days) |
| `bni_event_detail` | Full event details: contact, cost, location, registration count |
| `bni_list_regions` | Official BNI regions for a country |
| `bni_list_event_types` | Official event-type names — good search terms for `bni_upcoming_events` |
| `bni_list_professions` | The official worldwide BNI profession catalog |
| `bni_enrich_member` | LinkedIn search URL + suggested web searches (no external requests) |

## How countries work

A "country" can have more than one registered **site** — most countries have exactly one national member database, but some (large markets where BNI never built a single national entry point) are split into regional sites instead. `bni_search`, `bni_upcoming_events`, `bni_list_regions`, and `bni_list_event_types` automatically query every registered site for the country you ask about (capped at 5 per call; the response says so explicitly if more exist). `bni_list_countries` shows exactly what's registered.

New sites are added by finding their public "find a member" page URL — no reverse engineering needed; the technical IDs are discovered automatically and cached (see `src/registry/discovery.ts`).

## Known limitation: broad keyword matching

BNI's own member-search "keywords" field does broad, OR-style full-text matching across name, profession, and company rather than an exact/AND filter. A common word or a multi-word phrase (e.g. a full chapter name, which usually contains "BNI" plus a city) can match far more members than intended, up to the ~250-per-site result cap, effectively returning an unfiltered listing rather than the narrow result you'd expect. `bni_search` detects when a site's result count looks suspiciously high and flags it explicitly in the response so this isn't silent — but the underlying matching behavior itself is BNI's, not something this tool can filter away. Prefer distinctive, specific keywords, and add `city` to narrow further.

For chapters specifically, this is avoidable: many sites expose their own chapter filter as a dropdown of exact names, which `bni_list_chapters` reads directly and `bni_chapter_gaps` uses automatically when a match is found — that returns the chapter's complete roster with no keyword involved and no cap. Sites that don't expose this dropdown fall back to the keyword heuristic above, and are noted as such in the response.

## Claude Skills

This package ships two [Claude Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) under `skills/`, installable alongside the MCP tools:

| Skill | Purpose |
|---|---|
| `bni-prospecting` | Find matching BNI members for a product/service and prepare personalized 1:1 outreach |
| `bni-chapter-prep` | Prepare a briefing before visiting a BNI chapter as a guest or member |

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
