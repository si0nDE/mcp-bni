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
