import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import { runAdaptationLoop } from '@/server/loop/run';

const { designs, attributes } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const specification = specificationSchema.parse({
  id: 's',
  requirements: ['The tweezers are 120 mm long.'],
  components: [],
  partMeasurements: [{ parameterId: 'length', value: 120, source: 'user' }],
  printSettings: [
    { definitionId: 'clearance', value: 0.3, source: 'computed' },
  ],
});
const plan: Plan = {
  id: 'p',
  function: 'adaptation',
  candidateDesignId: 'tweezers',
  measurementsNeeded: [],
  checkIds: [],
  riskLabel: 'general',
  reason: 'r',
  confirmed: true,
};
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
const full = (length: number) => ({
  values: [
    { parameterId: 'length', value: length },
    { parameterId: 'tip-width', value: 4 },
    { parameterId: 'arm-thickness', value: 2 },
    { parameterId: 'arm-gap', value: 10 },
    { parameterId: 'arm-width', value: 12 },
  ],
});

describe('adaptation loop (D1, D4, R10)', () => {
  it('D1: drafts, renders, and passes every check in one attempt', async () => {
    const started = Date.now();
    const r = await runAdaptationLoop({
      model: scripted([full(120)]),
      plan,
      specification,
      design: tweezers,
      attributes,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts.length).toBe(1);
    expect(r.report?.failed).toEqual([]);
    expect(r.report?.results.map((x) => x.checkId)).toEqual([
      'parameter-limits',
      'mesh-validity',
      'requirement-coverage',
    ]);
    expect(r.report?.didNotRun.map((x) => x.checkId)).toContain(
      'fit-clearance',
    );
    expect(r.attempts[0].renderMs).toBeLessThan(5000);
    expect(Date.now() - started).toBeLessThan(180_000);
  }, 60_000);

  it('D4: three rejected attempts end with a failure report naming the limit, then reselects once when a fallback exists', async () => {
    const model = scripted([full(200)]);
    const r = await runAdaptationLoop({
      model,
      plan,
      specification,
      design: tweezers,
      fallbackDesign: { ...tweezers, id: 'tweezers-b' },
      attributes,
    });
    expect(r.ok).toBe(false);
    expect(r.attempts.length).toBe(6);
    expect(r.reselected).toBe(true);
    expect(r.message).toMatch(/maximum 160/);
    expect(model.doGenerateCalls.length).toBe(6);
  }, 60_000);

  it('a failed check feeds its suggested revision to the next drafting attempt', async () => {
    // Attempt 1 passes validation but produces an unprintable mesh via a zero-gap tip overlap
    // is hard to force with tweezers, so use the mesh check path through a fake tiny build
    // volume instead: the first attempt fails mesh-validity, the second shrinks length.
    const model = scripted([full(160), full(60)]);
    const r = await runAdaptationLoop({
      model,
      plan,
      specification,
      design: tweezers,
      attributes,
      buildVolume: [100, 100, 100],
    });
    expect(r.ok).toBe(true);
    expect(r.attempts.length).toBe(2);
    expect(r.attempts[0].report?.failed[0].checkId).toBe('mesh-validity');
    const draftingCalls = model.doGenerateCalls.filter((c) =>
      JSON.stringify(c.prompt.find((m) => m.role === 'system')).includes(
        'drafting step',
      ),
    );
    const secondSystem = JSON.stringify(
      draftingCalls[1].prompt.find((m) => m.role === 'system'),
    );
    expect(secondSystem).toMatch(/build volume/);
  }, 60_000);

  it('refuses to run without a confirmed plan', async () => {
    await expect(
      runAdaptationLoop({
        model: scripted([full(120)]),
        plan: { ...plan, confirmed: false },
        specification,
        design: tweezers,
        attributes,
      }),
    ).rejects.toThrow(/not confirmed/);
  });
});
