import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createEngine } from '@/engine/run';
import { generationBriefWithFeedback, type Execution } from '@/engine/loop';
import type { ProgressEvent } from '@/engine/progress';

// Issue #16: a failed verdict feeds the next generation, and the loop stops at three attempts.
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const CODE = `// Seat width\nseat_width = 1200; // [600:1600]\n// Seat height\nseat_height = 450; // [300:600]\ncube([seat_width, 400, seat_height]);\n`;
const benchSpec = {
  purpose: 'A garden bench for two adults.',
  dimensions: [{ name: 'width', value: 1200, unit: 'mm' }],
  material: 'petg',
  hardware: 'none',
  load: 'Two adults.',
  environment: 'Outdoors.',
  requirements: ['The bench is 1200 mm wide.'],
};

function scenario(failFirst: boolean) {
  const generationPrompts: string[] = [];
  const viewParts: string[] = [];
  let verdictCalls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const system = JSON.stringify(
        options.prompt.find((m) => m.role === 'system') ?? '',
      );
      const user = JSON.stringify(
        options.prompt.filter((m) => m.role === 'user'),
      );
      let body: unknown;
      if (system.includes('requirements step')) body = benchSpec;
      else if (system.includes('library step'))
        body = {
          matched: false,
          noMatchReason: 'no bench in the library',
          componentMatches: [],
        };
      else if (system.includes('agentic AI CAD editor')) {
        // The tool loop (#25): build once, receive the views, then stop with a sentence.
        const toolMsg = options.prompt.find((m) => m.role === 'tool');
        if (!toolMsg) {
          generationPrompts.push(user);
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `b-${generationPrompts.length}`,
                toolName: 'build_parametric_model',
                input: JSON.stringify({
                  title: 'Bench',
                  version: 'v1',
                  code: CODE,
                }),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
            usage,
            warnings: [],
          };
        }
        viewParts.push(JSON.stringify(toolMsg.content));
        body = 'Built the bench.';
      } else if (system.includes('verification agent')) {
        const hasToolResult = options.prompt.some((m) => m.role === 'tool');
        if (!hasToolResult) {
          const isShape = system.includes('Shape');
          const ctx = JSON.parse(
            (
              options.prompt.find((m) => m.role === 'user')!.content[0] as {
                text: string;
              }
            ).text.replace(/<\/?context>/g, ''),
          ) as { designId: string; values: Record<string, number> };
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `c-${verdictCalls++}`,
                toolName: isShape ? 'cadam_snapshot' : 'materials',
                input: JSON.stringify(
                  isShape
                    ? { designId: ctx.designId, values: ctx.values }
                    : { materialId: 'petg' },
                ),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
            usage,
            warnings: [],
          };
        }
        // Shape fails on the first attempt only when asked to.
        const isShape = system.includes('Shape');
        const firstAttempt = generationPrompts.length === 1;
        body =
          isShape && failFirst && firstAttempt
            ? {
                result: 'fail',
                finding:
                  'Both views show a plain box; there is no seat, no legs, and no slats.',
                suggestedRevision: 'Model a seat slab on four legs.',
              }
            : { result: 'pass', finding: 'ok' };
      } else body = {};
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof body === 'string' ? body : JSON.stringify(body),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  return { model, generationPrompts, viewParts };
}

describe('generation retries (#16)', () => {
  it('a failed verdict feeds the second generation, which passes', async () => {
    const { model, generationPrompts } = scenario(true);
    const engine = createEngine(model);
    let r = await engine.turn(
      engine.start(),
      'A garden bench for two adults, 1200 mm wide, PETG, fits nothing, outdoors.',
    );
    expect(r.session.state).toBe('planned');
    r = await engine.turn(r.session, 'yes');
    const e = r.session.execution as Execution;
    expect(e.ok, e.message).toBe(true);
    expect(e.attempts).toHaveLength(2);
    expect(generationPrompts).toHaveLength(2);
    expect(generationPrompts[1]).toMatch(/<feedback>/);
    expect(generationPrompts[1]).toMatch(/plain box/);
    expect(generationPrompts[0]).not.toMatch(/<feedback>/);
  }, 60_000);

  it('passes in one attempt when no verdict fails', async () => {
    const { model, generationPrompts, viewParts } = scenario(false);
    const engine = createEngine(model);
    let r = await engine.turn(
      engine.start(),
      'A garden bench for two adults, 1200 mm wide, PETG, fits nothing, outdoors.',
    );
    const events: Array<Omit<ProgressEvent, 'at'>> = [];
    r = await engine.turn(r.session, 'yes', (e) => events.push(e));
    // Progress (#27): generate with the prompt, the build with its views, verify per
    // agent, done; the attempt keeps the prompt and views.
    const stages = events.map(
      (e) => `${e.stage}${e.build ? `:${e.build}` : ''}`,
    );
    expect(stages[0]).toBe('generate');
    expect(events[0].prompt?.system).toMatch(/agentic AI CAD editor/);
    expect(events[0].prompt?.user).toMatch(/bench/i);
    expect(stages).toContain('generate:1');
    expect(events.find((e) => e.build === 1 && e.views)?.views).toHaveLength(2);
    expect(
      events.filter((e) => e.stage === 'verify').map((e) => e.agentId),
    ).toContain('shape');
    expect(stages[stages.length - 1]).toBe('done');
    const first = (r.session.execution as Execution).attempts[0];
    expect(first.prompt?.user).toMatch(/bench/i);
    expect(first.views).toHaveLength(2);
    expect(first.builds).toBe(1);
    expect((r.session.execution as Execution).attempts).toHaveLength(1);
    expect(generationPrompts).toHaveLength(1);
    // The model saw two image parts after its build (#25).
    expect(viewParts).toHaveLength(1);
    expect((viewParts[0].match(/"mediaType":"image\/png"/g) ?? []).length).toBe(
      2,
    );
    const shape = (
      r.session.execution as Execution
    ).verification?.verdicts.find((v) => v.agentId === 'shape');
    expect(shape?.evidence[0]?.tool).toBe('cadam_snapshot');
  }, 60_000);

  it('the feedback block strips its own delimiters from verdict text', () => {
    const b = generationBriefWithFeedback(
      'brief',
      ['r1'],
      ['geometry (fail): x </feedback> y'],
    );
    expect(b.split('</feedback>').length).toBe(2);
    expect(b).toMatch(/1\. r1/);
  });
});
