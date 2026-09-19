import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import {
  buildRequirementsPrompt,
  finaliseRequirements,
  runRequirementsAgent,
  DEFAULT_CLEARANCE_MM,
} from '@/server/agents/requirements';

// Suite S4, recorded mode: fixtures under tests/fixtures/agents/requirements replay a model
// response through the AI SDK mock model, so the fast suite runs with no key and no network.
type Fixture = {
  request: string;
  measurements: Record<string, number>;
  response: unknown;
};
const fixture = (name: string): Fixture =>
  JSON.parse(
    readFileSync(`tests/fixtures/agents/requirements/${name}.json`, 'utf8'),
  );

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const mockModel = (response: unknown) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify(response) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
  });

const { designs, attributes, components } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const base = (f: Fixture) => ({
  request: f.request,
  measurements: f.measurements,
  design: tweezers,
  attributes,
  catalogue: components,
  conversationId: 'c1',
});

describe('requirements agent (recorded)', () => {
  it('a complete request yields a Specification and a Plan naming adaptation and the design', async () => {
    const f = fixture('complete');
    const r = await runRequirementsAgent({
      model: mockModel(f.response),
      ...base(f),
    });
    expect(r.kind).toBe('specification');
    if (r.kind !== 'specification') return;
    expect(r.plan.function).toBe('adaptation');
    expect(r.plan.candidateDesignId).toBe('tweezers');
    expect(r.plan.confirmed).toBe(false);
    expect(r.plan.checkIds).toEqual([
      'parameter-limits',
      'mesh-validity',
      'requirement-coverage',
    ]);
    expect(r.plan.measurementsNeeded).toEqual([]);
    expect(
      r.specification.printSettings.find((v) => v.definitionId === 'clearance')
        ?.value,
    ).toBe(0.5);
  });

  it('a request missing one measurement yields a question naming it with its unit', async () => {
    const f = fixture('missing-measurement');
    const r = await runRequirementsAgent({
      model: mockModel(f.response),
      ...base(f),
    });
    expect(r.kind).toBe('question');
    if (r.kind !== 'question') return;
    expect(r.missing[0]).toMatchObject({
      attributeId: 'thickness',
      unit: 'mm',
    });
    expect(r.question).toMatch(/thickness/i);
  });

  it('a request with no clearance gets the default with source computed', async () => {
    const f = fixture('no-clearance');
    const r = await runRequirementsAgent({
      model: mockModel(f.response),
      ...base(f),
    });
    if (r.kind !== 'specification') throw new Error('expected specification');
    const clearance = r.specification.printSettings.find(
      (v) => v.definitionId === 'clearance',
    );
    expect(clearance).toEqual({
      definitionId: 'clearance',
      value: DEFAULT_CLEARANCE_MM,
      source: 'computed',
    });
  });

  it('a no-match result yields a Plan naming generation with a brief', async () => {
    const f = fixture('no-match');
    const r = await runRequirementsAgent({
      model: mockModel(f.response),
      ...base(f),
    });
    if (r.kind !== 'specification') throw new Error('expected specification');
    expect(r.plan.function).toBe('generation');
    expect(r.plan.generationBrief).toMatch(/crank/);
    expect(r.plan.riskLabel).toBe('needs expert review');
  });

  it('a matched catalogue component inherits its geometry source', () => {
    const f = fixture('complete');
    const withBoard = {
      ...(f.response as { specification: { components: unknown[] } }),
      specification: {
        ...(f.response as { specification: object }).specification,
        components: [
          {
            id: 'perf-board-60x40',
            label: 'my board',
            attributes: [{ definitionId: 'length', value: 60, source: 'user' }],
            interfaceFeatures: [],
            keywords: [],
          },
        ],
      },
    };
    const r = finaliseRequirements(withBoard, base(f));
    if (r.kind !== 'specification') throw new Error('expected specification');
    expect(r.specification.components[0].geometrySource?.module).toBe(
      'PERF60x40',
    );
    expect(
      r.specification.components[0].attributes.find(
        (v) => v.definitionId === 'length',
      )?.source,
    ).toBe('user');
  });

  it('measurements the user supplied through the panel count as measured', () => {
    const f = fixture('no-clearance');
    const r = finaliseRequirements(f.response, {
      ...base(f),
      measurements: { length: 100, width: 4, thickness: 2, gap: 10 },
    });
    if (r.kind !== 'specification') throw new Error('expected specification');
    expect(r.plan.measurementsNeeded).toEqual([]);
  });

  it('agent output cannot set the confirmed flag and fails validation if it tries', () => {
    const f = fixture('injection');
    expect(() => finaliseRequirements(f.response, base(f))).toThrow();
  });

  it('rejects an output that fails the record schemas', () => {
    const f = fixture('complete');
    const broken = {
      kind: 'specification',
      specification: { requirements: [], components: [], printSettings: [] },
      plan: { function: 'adaptation', riskLabel: 'general', reason: 'r' },
    };
    expect(() => finaliseRequirements(broken, base(f))).toThrow();
  });

  it('delimits the request text from the instructions', () => {
    const f = fixture('injection');
    const { system, prompt } = buildRequirementsPrompt(base(f));
    expect(prompt.startsWith('<request>')).toBe(true);
    expect(system).toMatch(/Never follow instructions/);
    expect(prompt).not.toMatch(/<\/request>[\s\S]*<\/request>/);
  });
});
