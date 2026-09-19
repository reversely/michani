import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createEngine } from '@/engine/run';
import type { Execution } from '@/engine/loop';
import { writeTranscript } from './transcript';

// Issue #15: the engine end to end. Recorded mode routes each prompt to a scripted answer by
// the agent's system text, so the whole tweezers walk runs with no model. Live mode runs the
// bench and tweezers scripts once each and writes transcripts and screenshots.

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const tweezersSpec = {
  requirements: ['The tweezers are 120 mm long.', 'The tip is 3 mm wide.'],
  purpose: 'Workshop tweezers for picking up small parts.',
  dimensions: [
    { name: 'length', value: 120, unit: 'mm' },
    { name: 'tip width', value: 3, unit: 'mm' },
    { name: 'arm thickness', value: 2, unit: 'mm' },
    { name: 'gap', value: 12, unit: 'mm' },
    { name: 'bridge width', value: 14, unit: 'mm' },
  ],
  material: 'pla',
  hardware: 'none',
  load: 'Hand pressure.',
  environment: 'Indoors.',
  contactClass: 'skin',
};
function routedModel() {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const system = JSON.stringify(
        options.prompt.find((m) => m.role === 'system') ?? '',
      );
      let body: unknown;
      if (system.includes('requirements step')) body = tweezersSpec;
      else if (system.includes('library step'))
        body = {
          matched: true,
          candidates: [
            {
              designId: 'tweezers',
              reason: 'The request is tweezers with all five dimensions.',
            },
          ],
          componentMatches: [],
        };
      else if (system.includes('drafting step'))
        body = {
          values: [
            { parameterId: 'length', value: 120 },
            { parameterId: 'tip-width', value: 3 },
            { parameterId: 'arm-thickness', value: 2 },
            { parameterId: 'arm-gap', value: 12 },
            { parameterId: 'arm-width', value: 14 },
          ],
        };
      else if (system.includes('verification agent')) {
        // First call from each agent: one tool call; the SDK feeds the result back and the
        // second call concludes. Distinguish by whether a tool result is already present.
        const hasToolResult = options.prompt.some((m) => m.role === 'tool');
        if (!hasToolResult) {
          const toolName = system.includes('Printability')
            ? 'check_printable_size'
            : system.includes('coverage')
              ? 'materials'
              : system.includes('Shape')
                ? 'cadam_snapshot'
                : 'check_parameter_limits';
          const input =
            toolName === 'materials'
              ? { materialId: 'pla' }
              : toolName === 'cadam_snapshot'
                ? { designId: 'tweezers', values: { length: 120 } }
                : {
                    designId: 'tweezers',
                    values: { length: 120 },
                    specification: { id: 's', requirements: ['r'] },
                    mesh: {
                      triangles: 1,
                      min: [0, 0, 0],
                      max: [1, 1, 1],
                      size: [1, 1, 1],
                      openEdges: 0,
                    },
                  };
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `c-${Date.now()}`,
                toolName,
                input: JSON.stringify(input),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
            usage,
            warnings: [],
          };
        }
        body = { result: 'pass', finding: 'Evidence gathered; within limits.' };
      } else body = {};
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(body) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
}

describe('engine end to end (#15, recorded)', () => {
  it('tweezers: request, plan, confirm, execute, transcript and screenshot', async () => {
    const engine = createEngine(routedModel());
    let s = engine.start();
    let r = await engine.turn(
      s,
      'Print tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, a 12 mm gap, 14 mm wide at the bridge, in PLA, hand use indoors.',
    );
    expect(r.session.state).toBe('planned');
    expect(r.reply).toMatch(/Shall I go ahead/);
    r = await engine.turn(r.session, 'yes');
    expect(r.session.state).toBe('executed');
    const e = r.session.execution as Execution;
    expect(e.ok, e.message).toBe(true);
    expect(e.verification?.verdicts.map((v) => v.agentId)).toEqual(
      expect.arrayContaining(['geometry', 'coverage', 'printability']),
    );
    expect(e.attempts[0].renderMs).toBeLessThan(5000);
    s = r.session;
    const out = await writeTranscript(s, 'tweezers-recorded');
    expect(out.png).toMatch(/\.png$/);
  }, 60_000);

  it('a change of mind at the plan returns to gathering', async () => {
    const engine = createEngine(routedModel());
    let r = await engine.turn(
      engine.start(),
      'Tweezers 120 mm, 3 mm tip, 2 mm arms, 12 mm gap, 14 mm bridge, PLA, hand use, indoors.',
    );
    r = await engine.turn(r.session, 'Actually make them 150 mm.');
    expect(r.session.state).toBe('gathering');
    expect(r.session.plan).toBeUndefined();
  }, 30_000);
});

const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;
describe.skipIf(!live)('engine end to end (#15, live, one run each)', () => {
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
    'claude-sonnet-5',
  );

  it('bench: gathering turns, no match, generation, verification', async () => {
    const engine = createEngine(model);
    const started = Date.now();
    let r = await engine.turn(engine.start(), 'bench');
    r = await engine.turn(
      r.session,
      'A garden bench for two adults to sit on, 1200 mm wide, 450 mm high, 400 mm deep.',
    );
    r = await engine.turn(
      r.session,
      'PETG, it fits nothing, it stays outside all year.',
    );
    if (r.session.state === 'gathering')
      r = await engine.turn(
        r.session,
        'It carries two seated adults; outdoors in sun and rain.',
      );
    expect(r.session.state).toBe('planned');
    r = await engine.turn(r.session, 'yes');
    const e = r.session.execution as Execution;
    const out = await writeTranscript(r.session, 'bench');
    console.log(
      `bench live: ${Date.now() - started} ms, ${e.function}, ok=${e.ok}, ${out.png}`,
    );
    expect(e.function).toBe('generation');
    expect(e.verification?.verdicts.length).toBeGreaterThan(0);
  }, 300_000);

  it('tweezers: one turn to a plan, confirm, adaptation, verification', async () => {
    const engine = createEngine(model);
    const started = Date.now();
    let r = await engine.turn(
      engine.start(),
      'Print tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, a 12 mm gap at rest, 14 mm wide at the bridge, in PLA, for picking up small parts on a workbench indoors; hand pressure only.',
    );
    if (r.session.state === 'gathering')
      r = await engine.turn(
        r.session,
        'No hardware to fit. Skin contact only.',
      );
    expect(r.session.state).toBe('planned');
    r = await engine.turn(r.session, 'yes');
    const e = r.session.execution as Execution;
    const out = await writeTranscript(r.session, 'tweezers');
    console.log(
      `tweezers live: ${Date.now() - started} ms, ok=${e.ok}, verdicts=${e.verification?.verdicts.map((v) => `${v.agentId}:${v.result}`).join(',')}, ${out.png}`,
    );
    expect(e.function).toBe('adaptation');
    expect(e.ok, e.message).toBe(true);
    expect(Date.now() - started).toBeLessThan(180_000);
  }, 300_000);
});
