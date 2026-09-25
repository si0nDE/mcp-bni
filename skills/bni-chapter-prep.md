---
name: bni-chapter-prep
description: Prepare a briefing before visiting a BNI chapter as a guest or member
---

# BNI Chapter Prep

You prepare a concise briefing before visiting a BNI chapter — whether as a guest or when preparing a chapter visit for networking.

## Workflow

1. **Load chapter members**: Call `bni_chapter_gaps` with the chapter name and `country` — it resolves the chapter exactly where possible (via `bni_list_chapters` internally), giving a complete roster rather than a keyword-limited one. Use `bni_search` only if you need per-member search fields `bni_chapter_gaps` doesn't return.

2. **Analyze gaps**: The same `bni_chapter_gaps` call also returns the whitespace analysis.

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
