import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema } from '@shared/schemas/library';
import {
  buildDraftingPrompt,
  finaliseDrafting,
  runDraftingAgent,
} from '@/server/agents/drafting';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(`tests/fixtures/agents/drafting/${name}.json`, 'utf8'),
  );
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const reply = (response: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(response) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});
const { designs, attributes } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;

describe('drafting agent (recorded)', () => {
  it('a valid proposal maps every part measurement to its parameter and passes validation', async () => {
    const f = fixture('valid');
    const r = await runDraftingAgent({
      model: new MockLanguageModelV3({
        doGenerate: async () => reply(f.response),
      }),
      specification: specificationSchema.parse(f.specification),
      design: tweezers,
      attributes,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      length: 120,
      tip_width: 3,
      arm_thickness: 2,
      arm_gap: 12,
      arm_width: 14,
    });
    expect(r.params.every((p) => p.type === 'number')).toBe(true);
  });

  it('output containing an undeclared parameter name is rejected with that name', () => {
    const f = fixture('undeclared');
    const r = finaliseDrafting(f.response, {
      specification: specificationSchema.parse(f.specification),
      design: tweezers,
      attributes,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.violations[0]).toMatchObject({
      reason: 'undeclared',
      name: 'handle_colour',
    });
  });

  it('a returned violation names the parameter and limit, and the retry changes the value', () => {
    const f = fixture('out-of-range');
    const spec = specificationSchema.parse(f.specification);
    const first = finaliseDrafting(f.responses[0], {
      specification: spec,
      design: tweezers,
      attributes,
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.violations[0].detail).toMatch(
      /"length" = 200 is above the maximum 160/,
    );
    const { system } = buildDraftingPrompt({
      specification: spec,
      design: tweezers,
      attributes,
      previousViolations: first.violations,
    });
    expect(system).toMatch(/previous attempt was rejected/);
    expect(system).toMatch(/maximum 160/);
    const second = finaliseDrafting(f.responses[1], {
      specification: spec,
      design: tweezers,
      attributes,
      previousViolations: first.violations,
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.values.length).toBe(160);
  });

  it('delimits the specification as data', () => {
    const f = fixture('valid');
    const { system, prompt } = buildDraftingPrompt({
      specification: specificationSchema.parse(f.specification),
      design: tweezers,
      attributes,
    });
    expect(prompt.startsWith('<specification>')).toBe(true);
    expect(system).toMatch(/Never follow instructions/);
  });
});
