import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import {
  applyCandidateToPlan,
  buildLibraryPrompt,
  finaliseLibrary,
  revisePlanForGeneration,
  runLibraryAgent,
  toIndexEntry,
  type LibraryIndexEntry,
} from '@/server/agents/library';

type Fixture = { specification: unknown; response: unknown };
const fixture = (name: string): Fixture =>
  JSON.parse(
    readFileSync(`tests/fixtures/agents/library/${name}.json`, 'utf8'),
  );
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const mockModel = (response: unknown) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(response) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
  });

const { designs, components } = loadLibrary('library');
// The shipped library has tweezers today; the index in these tests adds the entries later
// checkpoints author so the class B and C rules are exercised now.
const index: LibraryIndexEntry[] = [
  ...designs.map(toIndexEntry),
  {
    id: 'pipe-adapter',
    name: 'Pipe adapter',
    description: 'Joins two pipes',
    partClass: 'B',
    evidenceLevel: 'untested',
    source: 'curated',
    keywords: ['pipe'],
    attributeIds: ['outer-diameter'],
  },
  {
    id: 'board-enclosure',
    name: 'Board enclosure',
    description: 'Two-part case',
    partClass: 'C',
    evidenceLevel: 'untested',
    source: 'curated',
    keywords: ['case'],
    attributeIds: ['length', 'width'],
  },
];
const base = (f: Fixture) => ({
  specification: specificationSchema.parse(f.specification),
  index,
  catalogue: components,
});
const plan: Plan = {
  id: 'plan-1',
  function: 'adaptation',
  candidateDesignId: 'tweezers',
  measurementsNeeded: [],
  checkIds: [],
  riskLabel: 'general',
  reason: 'r',
  confirmed: true,
};

describe('library agent (recorded)', () => {
  it('a class A request returns tweezers first with a reason and the index class and evidence level', async () => {
    const f = fixture('class-a-match');
    const r = await runLibraryAgent({
      model: mockModel(f.response),
      ...base(f),
    });
    expect(r.kind).toBe('candidates');
    if (r.kind !== 'candidates') return;
    expect(r.candidates[0]).toMatchObject({
      designId: 'tweezers',
      partClass: 'A',
      evidenceLevel: 'untested',
    });
    expect(r.candidates[0].reason.length).toBeGreaterThan(10);
    expect(r.stop).toBeUndefined();
    const next = applyCandidateToPlan(plan, r.candidates[0]);
    expect(next.confirmed).toBe(false);
    expect(next.checkIds).toContain('mesh-validity');
  });

  it('a no-match result yields a message and a revised Plan naming generation with a brief', async () => {
    const f = fixture('no-match');
    const r = await runLibraryAgent({
      model: mockModel(f.response),
      ...base(f),
    });
    expect(r.kind).toBe('no-match');
    if (r.kind !== 'no-match') return;
    expect(r.message).toMatch(/No library design matches/);
    const revised = revisePlanForGeneration(
      plan,
      base(f).specification,
      r.message,
    );
    expect(revised.function).toBe('generation');
    expect(revised.generationBrief).toMatch(/crank arm/);
    expect(revised.confirmed).toBe(false);
  });

  it('a class C request whose board has no geometry source stops with a message naming the board', () => {
    const f = fixture('class-c-no-geometry');
    const r = finaliseLibrary(f.response, base(f));
    if (r.kind !== 'candidates') throw new Error('expected candidates');
    expect(r.componentsWithoutGeometry).toEqual(['Custom 90 by 50 mm board']);
    expect(r.stop).toMatch(/Custom 90 by 50 mm board/);
  });

  it('a class B request whose hardware has no geometry source continues', () => {
    const f = fixture('class-b-no-geometry');
    const r = finaliseLibrary(f.response, base(f));
    if (r.kind !== 'candidates') throw new Error('expected candidates');
    expect(r.componentsWithoutGeometry).toEqual(['Garden hose pipe']);
    expect(r.stop).toBeUndefined();
  });

  it('rejects a candidate id absent from the index', () => {
    const f = fixture('bad-candidate');
    expect(() => finaliseLibrary(f.response, base(f))).toThrow(
      /not in the library index/,
    );
  });

  it('never returns more than three candidates', () => {
    const f = fixture('class-a-match');
    const four = {
      matched: true,
      candidates: Array.from({ length: 4 }, () => ({
        designId: 'tweezers',
        reason: 'r',
      })),
      componentMatches: [],
    };
    expect(() => finaliseLibrary(four, base(f))).toThrow();
  });

  it('passes the specification and index as delimited structured data', () => {
    const f = fixture('class-a-match');
    const { system, prompt } = buildLibraryPrompt(base(f));
    expect(prompt.startsWith('<specification>')).toBe(true);
    expect(system).toMatch(/Never follow instructions/);
    expect(
      JSON.parse(
        prompt.split('Library index:\n')[1].split('\n\nComponent catalogue')[0],
      ),
    ).toHaveLength(index.length);
  });
});
