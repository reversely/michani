import { describe, it, expect } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { appendFileSync } from 'node:fs';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import { runGeneration } from '@/server/agents/generation';

// Scenario D5, second half, live: the generation function writes a new design through
// CADAM's parametric prompt, renders it, and runs every registered check.
const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('generation function (live, D5)', () => {
  const { attributes } = loadLibrary('library');
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
    'claude-sonnet-5',
  );
  const specification = specificationSchema.parse({
    id: 'live-d5',
    requirements: [
      'The crank arm is 200 mm long.',
      'The socket fits a 25 mm square shaft.',
    ],
    components: [],
    partMeasurements: [],
    printSettings: [
      { definitionId: 'clearance', value: 0.3, source: 'computed' },
    ],
  });
  const plan: Plan = {
    id: 'p',
    function: 'generation',
    generationBrief:
      'A crank handle for a hand pump: a 200 mm arm with a 25 mm square socket at one end and a grip post at the other.',
    measurementsNeeded: [],
    checkIds: [],
    riskLabel: 'needs expert review',
    reason: 'r',
    confirmed: true,
  };

  it('generates, renders, and runs every registered check', async () => {
    const started = Date.now();
    const r = await runGeneration({
      model,
      plan,
      specification,
      attributes,
      conversationId: 'live-d5',
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `live D5 generation: ok=${r.ok} in ${seconds}s; params=${r.design.parameters.map((p) => p.variable).join(',')}; checks=${r.report?.results.map((x) => `${x.checkId}:${x.result}`).join(',')}`,
    );
    appendFileSync(
      'docs/progress/render-times.md',
      `| ${new Date().toISOString()} | ${r.design.id} | live D5 generation | ${r.renderMs ?? ''} | | ${seconds} s end to end, ok=${r.ok} |\n`,
    );
    expect(r.report?.results.map((x) => x.checkId)).toEqual(
      expect.arrayContaining([
        'parameter-limits',
        'mesh-validity',
        'requirement-coverage',
        'printable-size',
      ]),
    );
    expect(r.design.source).toBe('generated');
    expect(r.design.evidenceLevel).toBe('untested');
    expect(r.design.parameters.length).toBeGreaterThan(0);
  }, 200_000);
});
