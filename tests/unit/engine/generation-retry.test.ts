import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createEngine } from '@/engine/run';
import { generationBriefWithFeedback, type Execution } from '@/engine/loop';

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
        generationPrompts.push(user);
        body = { title: 'Bench', version: 'v1', code: CODE };
      } else if (system.includes('verification agent')) {
        const hasToolResult = options.prompt.some((m) => m.role === 'tool');
        if (!hasToolResult) {
          return {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `c-${verdictCalls++}`,
                toolName: 'materials',
                input: JSON.stringify({ materialId: 'petg' }),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
            usage,
            warnings: [],
          };
        }
        // Geometry fails on the first attempt only when asked to.
        const isGeometry = system.includes('Geometry');
        const firstAttempt = generationPrompts.length === 1;
        body =
          isGeometry && failFirst && firstAttempt
            ? {
                result: 'fail',
                finding: 'Mesh height 774 mm disagrees with the stated 450 mm.',
                suggestedRevision:
                  'Set seat_height so the overall height is 450 mm.',
              }
            : { result: 'pass', finding: 'ok' };
      } else body = {};
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(body) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  return { model, generationPrompts };
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
    expect(generationPrompts[1]).toMatch(/disagrees with the stated 450 mm/);
    expect(generationPrompts[0]).not.toMatch(/<feedback>/);
  }, 60_000);

  it('passes in one attempt when no verdict fails', async () => {
    const { model, generationPrompts } = scenario(false);
    const engine = createEngine(model);
    let r = await engine.turn(
      engine.start(),
      'A garden bench for two adults, 1200 mm wide, PETG, fits nothing, outdoors.',
    );
    r = await engine.turn(r.session, 'yes');
    expect((r.session.execution as Execution).attempts).toHaveLength(1);
    expect(generationPrompts).toHaveLength(1);
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
