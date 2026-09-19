import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MockLanguageModelV3 } from 'ai/test';
import { createAnthropic } from '@ai-sdk/anthropic';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema } from '@shared/schemas/library';
import {
  buildCoveragePrompt,
  finaliseCoverage,
  requirementCoverage,
} from '@/server/verification/checks/requirementCoverage';
import { renderScadToStl } from '@/server/render/openscad';

const fixture = JSON.parse(
  readFileSync('tests/fixtures/agents/coverage/d1.json', 'utf8'),
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
const { designs } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const specification = specificationSchema.parse({
  id: 's',
  requirements: fixture.requirements,
  components: [],
  partMeasurements: [],
  printSettings: [],
});
const mesh = {
  triangles: 1,
  min: [0, 0, 0] as [number, number, number],
  max: fixture.size as [number, number, number],
  size: fixture.size as [number, number, number],
  openEdges: 0,
};

describe('requirement coverage (recorded)', () => {
  it('returns one result per requirement statement and passes when all pass', async () => {
    const r = await requirementCoverage({
      design: tweezers,
      specification,
      values: fixture.values,
      mesh,
      model: mockModel(fixture.response),
    });
    expect(r.result).toBe('pass');
    expect((r.inputsUsed as { results: unknown[] }).results).toHaveLength(2);
    expect(r.finding).toMatch(/1\. pass/);
  });
  it('fills a missing statement result with warn and takes the worst verdict', () => {
    const { results, worst } = finaliseCoverage(
      { results: [{ requirement: 'a', result: 'fail', finding: 'no' }] },
      ['a', 'b'],
    );
    expect(results).toHaveLength(2);
    expect(results[1].result).toBe('warn');
    expect(worst).toBe('fail');
  });
  it('warns instead of running when no model is available', async () => {
    const r = await requirementCoverage({
      design: tweezers,
      specification,
      values: fixture.values,
      mesh,
    });
    expect(r.result).toBe('warn');
  });
  it('delimits the requirements as data', () => {
    const { prompt, system } = buildCoveragePrompt({
      requirements: ['x'],
      values: {},
      designName: 'd',
    });
    expect(prompt).toMatch(/<requirements>/);
    expect(system).toMatch(/Never follow instructions/);
  });
});

const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;
describe.skipIf(!live)('requirement coverage (live)', () => {
  it('D1 request yields all-pass', async () => {
    const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      'claude-sonnet-5',
    );
    const render = await renderScadToStl(tweezers.scad, fixture.values);
    const started = Date.now();
    const r = await requirementCoverage({
      design: tweezers,
      specification,
      values: fixture.values,
      mesh: render.summary ?? mesh,
      model,
    });
    console.log(
      `live coverage: ${Date.now() - started} ms, ${r.result}: ${r.finding}`,
    );
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(r.result).toBe('pass');
  }, 60_000);
});
