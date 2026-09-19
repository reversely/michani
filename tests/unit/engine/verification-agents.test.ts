import { describe, it, expect, beforeAll } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createAnthropic } from '@ai-sdk/anthropic';
import { registerDefaultTools } from '@/engine/tools';
import { specificationSchema } from '@shared/schemas/library';
import {
  agentsFor,
  registerDefaultVerificationAgents,
  registerVerificationAgent,
  runVerification,
  runVerificationAgent,
  type VerificationContext,
} from '@/engine/agents/verification';

beforeAll(() => {
  registerDefaultTools();
  registerDefaultVerificationAgents();
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const ctx: VerificationContext = {
  designId: 'tweezers',
  partClass: 'A',
  values: { length: 120, tip_width: 3 },
  specification: specificationSchema.parse({
    id: 's',
    requirements: ['The tweezers are 120 mm long.'],
    purpose: 'p',
    material: 'pla',
  }),
  mesh: {
    triangles: 52,
    min: [0, 0, 0],
    max: [130, 16, 14],
    size: [130, 16, 14],
    openEdges: 0,
  },
  renderExitCode: 0,
};

// A scripted model that first calls one tool, then concludes. The SDK runs the tool and feeds
// the result back, so the evidence list is populated exactly as it would be live.
const toolThenVerdict = (
  toolName: string,
  input: unknown,
  verdict: unknown,
) => {
  let step = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      step++;
      if (step === 1) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName,
              input: JSON.stringify(input),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(verdict) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
};

describe('verification agents (#14)', () => {
  it('records the tools an agent ran and their outputs as evidence', async () => {
    const agent = agentsFor('A').find((a) => a.id === 'geometry')!;
    const model = toolThenVerdict(
      'check_parameter_limits',
      {
        designId: 'tweezers',
        values: ctx.values,
        specification: ctx.specification,
      },
      { result: 'pass', finding: 'All values inside limits.' },
    );
    const v = await runVerificationAgent(agent, ctx, model);
    expect(v.result).toBe('pass');
    expect(v.evidence).toHaveLength(1);
    expect(v.evidence[0].tool).toBe('check_parameter_limits');
    expect(JSON.stringify(v.evidence[0].output)).toMatch(
      /inside their declared limits/,
    );
    expect(v.steps).toBe(2);
  });

  it('downgrades a pass with no evidence to a warning', async () => {
    const agent = agentsFor('A').find((a) => a.id === 'coverage')!;
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ result: 'pass', finding: 'Looks fine.' }),
          },
        ],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
        warnings: [],
      }),
    });
    const v = await runVerificationAgent(agent, ctx, model);
    expect(v.result).toBe('warn');
    expect(v.finding).toMatch(/No tool evidence/);
  });

  it('an agent that spends its budget on tool calls returns a warning, not a throw (#28)', async () => {
    const agent = agentsFor('A').find((a) => a.id === 'printability')!;
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: `call-${Math.random()}`,
            toolName: 'materials',
            input: JSON.stringify({ materialId: 'pla' }),
          },
        ],
        finishReason: { unified: 'tool-calls' as const, raw: 'tool_use' },
        usage,
        warnings: [],
      }),
    });
    const v = await runVerificationAgent(agent, ctx, model);
    expect(v.result).toBe('warn');
    expect(v.finding).toMatch(/no usable verdict/);
    expect(v.evidence.length).toBeGreaterThan(0);
  });

  it('a verdict written as JSON text is used when the structured answer is absent (#28)', async () => {
    const agent = agentsFor('A').find((a) => a.id === 'printability')!;
    const model = toolThenVerdict(
      'materials',
      { materialId: 'pla' },
      { result: 'fail', finding: 'Wall 0.8 mm is under the 1.2 mm minimum.' },
    );
    const v = await runVerificationAgent(agent, ctx, model);
    expect(v.result).toBe('fail');
  });

  it('runs every agent for the class and lists the rest as did not run', async () => {
    const model = toolThenVerdict(
      'check_printable_size',
      {
        designId: 'tweezers',
        values: ctx.values,
        specification: ctx.specification,
        mesh: ctx.mesh,
      },
      { result: 'pass', finding: 'Fits a bed.' },
    );
    const run = await runVerification(ctx, model);
    expect(run.verdicts.map((v) => v.agentId)).toEqual(
      expect.arrayContaining(['geometry', 'coverage', 'printability']),
    );
    expect(run.didNotRun.map((d) => d.agentId)).toContain('fit');
  });

  it('a new agent with its own tools joins the next run with no loop change', async () => {
    registerVerificationAgent({
      id: 'sample-agent',
      name: 'Sample',
      partClasses: ['A'],
      tools: ['unit_convert'],
      budget: 2,
      instructions: 'Convert 1 in to mm and pass.',
    });
    expect(agentsFor('A').map((a) => a.id)).toContain('sample-agent');
    const model = toolThenVerdict(
      'unit_convert',
      { value: 1, unit: 'in' },
      { result: 'pass', finding: '25.4 mm.' },
    );
    const v = await runVerificationAgent(
      agentsFor('A').find((a) => a.id === 'sample-agent')!,
      ctx,
      model,
    );
    expect(v.evidence[0]).toMatchObject({
      tool: 'unit_convert',
      output: { mm: 25.4 },
    });
  });

  it('an agent cannot call a tool outside its registered set', async () => {
    const agent = agentsFor('A').find((a) => a.id === 'printability')!;
    const model = toolThenVerdict(
      'cadam_render_code',
      { scad: 'cube(10);' },
      { result: 'pass', finding: 'x' },
    );
    const v = await runVerificationAgent(agent, ctx, model);
    // The SDK reports the unknown tool as an error result; no render happened.
    expect(
      v.evidence.some(
        (e) =>
          e.tool === 'cadam_render_code' &&
          JSON.stringify(e.output ?? '').includes('exitCode'),
      ),
    ).toBe(false);
  });
});

const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;
describe.skipIf(!live)('verification agents (#14, live, one run)', () => {
  it('the geometry agent renders and checks the tweezers within budget', async () => {
    const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      'claude-sonnet-5',
    );
    const agent = agentsFor('A').find((a) => a.id === 'geometry')!;
    const started = Date.now();
    const v = await runVerificationAgent(
      agent,
      { ...ctx, mesh: undefined, renderExitCode: undefined },
      model,
    );
    console.log(
      `live geometry agent: ${v.result} in ${v.steps} steps, ${Date.now() - started} ms, tools=${v.evidence.map((e) => e.tool).join(',')}; ${v.finding}`,
    );
    expect(v.evidence.length).toBeGreaterThan(0);
    expect(v.result).toBe('pass');
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 90_000);
});
