import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import { runAdaptationLoop } from '@/server/loop/run';

// Scenarios D2 (class B, fit check) and D3 (class C, alignment check) through the loop with
// scripted drafting responses, plus the deliberate clearance violation that triggers one retry.
const { designs, attributes, components } = loadLibrary('library');
const adapter = designs.find((d) => d.id === 'pipe-adapter')!;
const enclosure = designs.find((d) => d.id === 'board-enclosure')!;
const perfBoard = components.find((c) => c.id === 'perf-board-60x40')!;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
// Drafting responses are scripted in order; the requirement coverage check, which also calls
// the model, is answered with an all-pass result whenever its prompt arrives.
const scripted = (responses: unknown[]) => {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const system = JSON.stringify(
        options.prompt.find((m) => m.role === 'system') ?? '',
      );
      const isCoverage = system.includes('requirement coverage check');
      const body = isCoverage
        ? { results: [{ requirement: 'r', result: 'pass', finding: 'ok' }] }
        : responses[Math.min(i++, responses.length - 1)];
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(body) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
};
const plan = (designId: string): Plan => ({
  id: 'p',
  function: 'adaptation',
  candidateDesignId: designId,
  measurementsNeeded: [],
  checkIds: [],
  riskLabel: 'general',
  reason: 'r',
  confirmed: true,
});
const pipe = (id: string, outer: number) => ({
  id,
  label: `Pipe ${outer} mm`,
  attributes: [
    { definitionId: 'outer-diameter', value: outer, source: 'user' },
  ],
  interfaceFeatures: [
    {
      id: 'outer-wall',
      featureType: 'face',
      attributes: [
        { definitionId: 'outer-diameter', value: outer, source: 'user' },
      ],
      clearanceRule: 'plus',
    },
  ],
  keywords: [],
});
const adapterValues = (a: number, b: number) => ({
  values: [
    { parameterId: 'socket-a-diameter', value: a },
    { parameterId: 'socket-b-diameter', value: b },
    { parameterId: 'socket-depth', value: 25 },
    { parameterId: 'wall-thickness', value: 3 },
    { parameterId: 'shoulder-thickness', value: 3 },
  ],
});

describe('class B loop (D2, fit and clearance)', () => {
  const specification = specificationSchema.parse({
    id: 's-b',
    requirements: ['The adapter joins a 25 mm pipe to a 32 mm pipe.'],
    components: [pipe('pipe-a', 25), pipe('pipe-b', 32)],
    partMeasurements: [],
    printSettings: [{ definitionId: 'clearance', value: 0.3, source: 'user' }],
  });

  it('passes fit and clearance when both sockets carry the clearance', async () => {
    const r = await runAdaptationLoop({
      model: scripted([adapterValues(25.3, 32.3)]),
      plan: plan('pipe-adapter'),
      specification,
      design: adapter,
      attributes,
    });
    expect(r.ok).toBe(true);
    const fit = r.report?.results.find((x) => x.checkId === 'fit-clearance');
    expect(fit?.result).toBe('pass');
    expect(fit?.finding).toMatch(/2 mating feature pairs/);
  }, 60_000);

  it('a deliberate clearance violation triggers one retry that receives the suggested revision', async () => {
    const model = scripted([
      adapterValues(25.0, 32.3),
      adapterValues(25.3, 32.3),
    ]);
    const r = await runAdaptationLoop({
      model,
      plan: plan('pipe-adapter'),
      specification,
      design: adapter,
      attributes,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts.length).toBe(2);
    const failed = r.attempts[0].report?.failed[0];
    expect(failed?.checkId).toBe('fit-clearance');
    expect(failed?.suggestedRevision).toMatch(/socket-a-diameter to 25.30/);
    const draftingCalls = model.doGenerateCalls.filter((c) =>
      JSON.stringify(c.prompt.find((m) => m.role === 'system')).includes(
        'drafting step',
      ),
    );
    const secondSystem = JSON.stringify(
      draftingCalls[1].prompt.find((m) => m.role === 'system'),
    );
    expect(secondSystem).toMatch(/socket-a-diameter to 25.30/);
  }, 60_000);
});

describe('class C loop (D3, hole and opening alignment)', () => {
  const board = {
    ...perfBoard,
    interfaceFeatures: perfBoard.interfaceFeatures
      .map((f) => ({
        ...f,
        attributes: f.attributes.map((a) => ({
          ...a,
          source: 'user' as const,
        })),
      }))
      .concat([
        {
          id: 'connector',
          featureType: 'opening',
          attributes: [{ definitionId: 'offset', value: 30, source: 'user' }],
          clearanceRule: 'none',
        },
      ]),
  };
  const specification = specificationSchema.parse({
    id: 's-c',
    requirements: [
      'The case houses a 60 by 40 mm board with four 3 mm holes and a side opening.',
    ],
    components: [board],
    partMeasurements: [],
    printSettings: [{ definitionId: 'clearance', value: 0.3, source: 'user' }],
  });
  const enclosureValues = (inset: number, offset: number) => ({
    values: [
      { parameterId: 'board-length', value: 60 },
      { parameterId: 'board-width', value: 40 },
      { parameterId: 'hole-diameter', value: 3 },
      { parameterId: 'hole-inset', value: inset },
      { parameterId: 'standoff-height', value: 5 },
      { parameterId: 'wall-thickness', value: 2 },
      { parameterId: 'clearance', value: 0.3 },
      { parameterId: 'lid-height', value: 15 },
      { parameterId: 'opening-width', value: 12 },
      { parameterId: 'opening-height', value: 8 },
      { parameterId: 'opening-offset', value: offset },
      { parameterId: 'part', value: 0 },
      { parameterId: 'show-board', value: 0 },
    ],
  });

  it('renders the enclosure with holes and the opening at the stated positions and passes alignment', async () => {
    const r = await runAdaptationLoop({
      model: scripted([enclosureValues(3.5, 30)]),
      plan: plan('board-enclosure'),
      specification,
      design: enclosure,
      attributes,
    });
    expect(
      r.ok,
      `${r.message} ${JSON.stringify(r.attempts.map((a) => ({ v: a.violations.map((x) => x.detail), f: a.report?.failed.map((x) => x.checkId + ': ' + x.finding) })))}`,
    ).toBe(true);
    const ids = r.report?.results.map((x) => `${x.checkId}:${x.result}`);
    expect(ids).toContain('hole-alignment:pass');
    expect(ids).toContain('fit-clearance:pass');
    expect(r.report?.didNotRun).toEqual([]);
    expect(r.attempts[0].renderMs).toBeLessThan(5000);
  }, 60_000);

  it('a misplaced opening fails alignment and the retry fixes it', async () => {
    const model = scripted([
      enclosureValues(3.5, 20),
      enclosureValues(3.5, 30),
    ]);
    const r = await runAdaptationLoop({
      model,
      plan: plan('board-enclosure'),
      specification,
      design: enclosure,
      attributes,
    });
    expect(r.ok).toBe(true);
    // The opening offset is also a mating feature, so the fit check fails alongside alignment.
    expect(r.attempts[0].report?.failed.map((f) => f.checkId)).toContain(
      'hole-alignment',
    );
    expect(r.attempts.length).toBe(2);
  }, 60_000);
});
