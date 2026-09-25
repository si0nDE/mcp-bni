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
