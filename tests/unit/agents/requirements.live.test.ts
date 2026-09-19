import { describe, it, expect } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { loadLibrary } from '@shared/library/loader';
import { runRequirementsAgent } from '@/server/agents/requirements';

// Suite S4, live mode: calls Anthropic once per case. Runs only with LIVE_AGENT_TESTS=1 and a
// key in the environment, before an agent checkpoint closes.
const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('requirements agent (live)', () => {
  const { designs, attributes, components } = loadLibrary('library');
  const tweezers = designs.find((d) => d.id === 'tweezers')!;
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
    'claude-sonnet-5',
  );
  const base = {
    model,
    design: tweezers,
    attributes,
    catalogue: components,
    conversationId: 'live',
  };

  it('D1: a complete tweezers request yields a Specification and an adaptation Plan', async () => {
    const started = Date.now();
    const r = await runRequirementsAgent({
      ...base,
      request:
        'Print tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, a 12 mm gap at rest, and 14 mm wide at the bridge, for general workshop use.',
    });
    const ms = Date.now() - started;
    console.log(`live requirements call: ${ms} ms, kind=${r.kind}`);
    expect(ms).toBeLessThan(30_000);
    expect(r.kind).toBe('specification');
    if (r.kind !== 'specification') return;
    expect(r.plan.function).toBe('adaptation');
    expect(r.plan.candidateDesignId).toBe('tweezers');
    expect(r.plan.measurementsNeeded).toEqual([]);
  }, 60_000);

  it('D2 first step: a request missing a measurement yields a question naming it', async () => {
    const r = await runRequirementsAgent({
      ...base,
      request: 'I need tweezers about 100 mm long with thin arms.',
    });
    console.log(
      `live: kind=${r.kind} ${r.kind === 'question' ? r.question : ''}`,
    );
    expect(r.kind).toBe('question');
    if (r.kind !== 'question') return;
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.missing.every((m) => m.unit === 'mm')).toBe(true);
  }, 60_000);
});
