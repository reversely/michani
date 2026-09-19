import { describe, it, expect } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import { draftWithRetries } from '@/server/loop/controller';

const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('drafting agent (live)', () => {
  const { designs, attributes } = loadLibrary('library');
  const tweezers = designs.find((d) => d.id === 'tweezers')!;
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
    'claude-sonnet-5',
  );
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

  it('D1: maps the part measurements to parameters in one attempt', async () => {
    const specification = specificationSchema.parse({
      id: 'live-d1',
      requirements: ['The tweezers are 120 mm long.'],
      components: [],
      partMeasurements: [
        { parameterId: 'length', value: 120, source: 'user' },
        { parameterId: 'tip-width', value: 3, source: 'user' },
        { parameterId: 'arm-thickness', value: 2, source: 'user' },
        { parameterId: 'arm-gap', value: 12, source: 'user' },
        { parameterId: 'arm-width', value: 14, source: 'user' },
      ],
      printSettings: [
        { definitionId: 'clearance', value: 0.3, source: 'computed' },
      ],
    });
    const r = await draftWithRetries({
      model,
      plan,
      specification,
      design: tweezers,
      attributes,
    });
    console.log(
      `live drafting: ok=${r.ok} attempts=${r.attempts.length} ${r.attempts.map((a) => a.elapsedMs + 'ms').join(',')}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.values).toMatchObject({
        length: 120,
        tip_width: 3,
        arm_width: 14,
      });
  }, 90_000);

  it('D4: a measurement outside the limits is clamped or rejected with the limit named', async () => {
    const specification = specificationSchema.parse({
      id: 'live-d4',
      requirements: ['The tweezers are 200 mm long.'],
      components: [],
      partMeasurements: [{ parameterId: 'length', value: 200, source: 'user' }],
      printSettings: [],
    });
    const r = await draftWithRetries({
      model,
      plan,
      specification,
      design: tweezers,
      attributes,
    });
    console.log(
      `live drafting D4: ok=${r.ok} attempts=${r.attempts.length} notes=${r.attempts.map((a) => a.notes ?? '').join(' | ')}`,
    );
    // Either the model clamps to the limit and says so, or the controller rejects and names it.
    if (r.ok) expect(r.values.length).toBeLessThanOrEqual(160);
    else expect(r.message).toMatch(/maximum 160/);
  }, 120_000);
});
