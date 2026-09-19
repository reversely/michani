import { describe, it, expect } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { appendFileSync } from 'node:fs';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import { runAdaptationLoop } from '@/server/loop/run';

// Scenario D1 end to end against Claude Sonnet 5: draft, render, verify, package-ready values.
const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('adaptation loop (live, D1)', () => {
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
  const specification = specificationSchema.parse({
    id: 'live-d1',
    requirements: ['The tweezers are 120 mm long.', 'The tip is 3 mm wide.'],
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

  it('drafts, renders, and passes every check within 3 minutes', async () => {
    const started = Date.now();
    const r = await runAdaptationLoop({
      model,
      plan,
      specification,
      design: tweezers,
      attributes,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `live D1 loop: ok=${r.ok} attempts=${r.attempts.length} in ${seconds}s; checks=${r.report?.results.map((x) => `${x.checkId}:${x.result}`).join(',')}`,
    );
    appendFileSync(
      'docs/progress/render-times.md',
      `| ${new Date().toISOString()} | tweezers | live D1 loop (${r.attempts.length} attempt${r.attempts.length === 1 ? '' : 's'}) | ${r.attempts[0]?.renderMs ?? ''} | | ${seconds} s end to end |\n`,
    );
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(180_000);
    expect(r.values).toMatchObject({ length: 120, tip_width: 3 });
    expect(r.report?.failed).toEqual([]);
  }, 200_000);
});
