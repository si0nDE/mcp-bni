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
