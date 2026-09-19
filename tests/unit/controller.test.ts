import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import {
  availableTools,
  draftWithRetries,
  PlanNotConfirmedError,
  requireConfirmed,
  validateForRender,
} from '@/server/loop/controller';

const { designs, attributes } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const specification = specificationSchema.parse({
  id: 'spec-c',
  requirements: ['Tweezers 120 mm.'],
  components: [],
  partMeasurements: [{ parameterId: 'length', value: 120, source: 'user' }],
  printSettings: [],
});
const plan = (confirmed: boolean): Plan => ({
  id: 'plan-c',
  function: 'adaptation',
  candidateDesignId: 'tweezers',
  measurementsNeeded: [],
  checkIds: [],
  riskLabel: 'general',
  reason: 'r',
  confirmed,
});
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const scripted = (responses: unknown[]) => {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responses[Math.min(i++, responses.length - 1)]),
        },
      ],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
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

describe('controller gate (R17, D7)', () => {
  it('exposes no drafting or generation tool until the plan is confirmed', () => {
    expect(availableTools(undefined)).toEqual(['requirements', 'library']);
    expect(availableTools(plan(false))).toEqual(['requirements', 'library']);
    expect(availableTools(plan(true))).toEqual([
      'requirements',
      'library',
      'draft',
    ]);
    expect(
      availableTools({
        ...plan(true),
        function: 'generation',
        candidateDesignId: undefined,
        generationBrief: 'b',
      }),
    ).toContain('generate');
  });
  it('refuses a drafting call without a confirmed plan and calls no model', async () => {
    expect(() => requireConfirmed(plan(false))).toThrow(PlanNotConfirmedError);
    const model = scripted([full(120)]);
    await expect(
      draftWithRetries({
        model,
        plan: plan(false),
        specification,
        design: tweezers,
        attributes,
      }),
    ).rejects.toThrow(PlanNotConfirmedError);
    expect(model.doGenerateCalls.length).toBe(0);
  });
});

describe('controller validation (R7)', () => {
  it('rejects an undeclared parameter name', () => {
    const r = validateForRender(tweezers, { depth: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.violations[0]).toMatchObject({
        reason: 'undeclared',
        name: 'depth',
      });
  });
  it('rejects values below the minimum and above the maximum', () => {
    const low = validateForRender(tweezers, { length: 10 });
    const high = validateForRender(tweezers, { length: 500 });
    expect(low.ok || high.ok).toBe(false);
  });
  it('rejects a constraint violation', () => {
    // The tweezers limits make the constraint unbreakable within range, so use a design
    // whose limits overlap: an arm narrower than the tip is inside both ranges yet invalid.
    const design = {
      parameters: [
        {
          id: 'tip-width',
          variable: 'tip_width',
          attributeId: 'width',
          default: 4,
          min: 2,
          max: 12,
          constraints: [],
        },
        {
          id: 'arm-width',
          variable: 'arm_width',
          attributeId: 'width',
          default: 12,
          min: 8,
          max: 20,
          constraints: ['arm-width >= tip-width'],
        },
      ],
    };
    expect(validateForRender(design, { arm_width: 10, tip_width: 8 }).ok).toBe(
      true,
    );
    const bad = validateForRender(design, { arm_width: 8, tip_width: 10 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.violations[0].reason).toBe('constraint');
  });
  it('rejects non-numeric, NaN, Infinity, and names with spaces or punctuation (S7)', () => {
    for (const bad of [NaN, Infinity, 'x', null])
      expect(validateForRender(tweezers, { length: bad }).ok).toBe(false);
    for (const name of ['len gth', 'length;', 'length)', '$(rm)'])
      expect(validateForRender(tweezers, { [name]: 100 }).ok).toBe(false);
  });
  it('accepts a valid set within 100 ms', () => {
    const started = performance.now();
    const r = validateForRender(tweezers, { length: 120, tip_width: 3 });
    expect(performance.now() - started).toBeLessThan(100);
    expect(r.ok).toBe(true);
  });
});

describe('controller retry (R10, D4)', () => {
  it('returns the violation to the next attempt and accepts the corrected value', async () => {
    const model = scripted([full(200), full(160)]);
    const r = await draftWithRetries({
      model,
      plan: plan(true),
      specification,
      design: tweezers,
      attributes,
    });
    expect(r.ok).toBe(true);
    expect(r.attempts.length).toBe(2);
    expect(r.attempts[0].violations[0].detail).toMatch(/maximum 160/);
    expect(model.doGenerateCalls.length).toBe(2);
    const secondSystem = model.doGenerateCalls[1].prompt.find(
      (m) => m.role === 'system',
    );
    expect(JSON.stringify(secondSystem)).toMatch(/maximum 160/);
  });
  it('stops after three attempts with a message naming the limit', async () => {
    const model = scripted([full(200)]);
    const r = await draftWithRetries({
      model,
      plan: plan(true),
      specification,
      design: tweezers,
      attributes,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.attempts.length).toBe(3);
    expect(r.message).toMatch(/3 attempts/);
    expect(r.message).toMatch(/maximum 160/);
  });
});
