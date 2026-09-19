import { describe, it, expect } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { loadLibrary } from '@shared/library/loader';
import {
  specificationSchema,
  type DesignEntry,
  type Plan,
} from '@shared/schemas/library';
import {
  designFromGeneratedCode,
  GenerationNotSelectedError,
  requireGeneration,
  runGeneration,
} from '@/server/agents/generation';
import { PlanNotConfirmedError } from '@/server/loop/controller';

// Scenario D5 second half and the generation gate, with a scripted model.
const { attributes } = loadLibrary('library');
const specification = specificationSchema.parse({
  id: 's',
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
const plan = (fn: Plan['function'], confirmed: boolean): Plan => ({
  id: 'p',
  function: fn,
  candidateDesignId: fn === 'adaptation' ? 'tweezers' : undefined,
  generationBrief:
    fn === 'generation'
      ? 'A crank handle with a 200 mm arm and a 25 mm square socket.'
      : undefined,
  measurementsNeeded: [],
  checkIds: [],
  riskLabel: 'needs expert review',
  reason: 'r',
  confirmed,
});
const CRANK = `// Crank arm length
arm_length = 200; // [100:300]
// Square socket side
socket_side = 25; // [10:40]
// Arm thickness
arm_thickness = 8; // [4:16]
$fn = 32;
difference() {
  hull() {
    cylinder(h = arm_thickness, d = socket_side + 16);
    translate([arm_length, 0, 0]) cylinder(h = arm_thickness, d = 20);
  }
  translate([-socket_side / 2, -socket_side / 2, -1]) cube([socket_side, socket_side, arm_thickness + 2]);
}
translate([arm_length, 0, arm_thickness]) cylinder(h = 30, d = 12);
`;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const model = new MockLanguageModelV3({
  doGenerate: async (options) => {
    const system = JSON.stringify(
      options.prompt.find((m) => m.role === 'system') ?? '',
    );
    const body = system.includes('requirement coverage check')
      ? {
          results: [
            { requirement: 'r', result: 'pass', finding: 'ok' },
            { requirement: 'r', result: 'pass', finding: 'ok' },
          ],
        }
      : { title: 'Crank handle', version: 'v1', code: CRANK };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(body) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    };
  },
});

describe('generation function', () => {
  it('refuses without a confirmed plan and when the plan selects adaptation, producing no geometry', async () => {
    expect(() => requireGeneration(plan('generation', false))).toThrow(
      PlanNotConfirmedError,
    );
    expect(() => requireGeneration(plan('adaptation', true))).toThrow(
      GenerationNotSelectedError,
    );
    await expect(
      runGeneration({
        model,
        plan: plan('adaptation', true),
        specification,
        attributes,
        conversationId: 'c',
      }),
    ).rejects.toThrow(GenerationNotSelectedError);
    expect(model.doGenerateCalls.length).toBe(0);
  });

  it('derives parameter limits from the Customizer comments the model wrote', () => {
    const d = designFromGeneratedCode({
      id: 'g',
      title: 'Crank',
      code: CRANK,
      conversationId: 'c',
      attributes,
    });
    expect(d.source).toBe('generated');
    expect(d.evidenceLevel).toBe('untested');
    expect(d.parameters.find((p) => p.variable === 'arm_length')).toMatchObject(
      { min: 100, max: 300, default: 200 },
    );
  });

  it('D5: renders, runs every registered check, and saves only after they pass', async () => {
    const saved: DesignEntry[] = [];
    const r = await runGeneration({
      model,
      plan: plan('generation', true),
      specification,
      attributes,
      conversationId: 'conv-1234',
      save: async (design) => {
        saved.push(design);
      },
    });
    expect(r.ok, r.message).toBe(true);
    expect(r.report?.results.map((x) => x.checkId)).toEqual(
      expect.arrayContaining([
        'parameter-limits',
        'mesh-validity',
        'requirement-coverage',
        'printable-size',
      ]),
    );
    expect(r.saved).toBe(true);
    expect(saved[0].source).toBe('generated');
    expect(saved[0].evidenceLevel).toBe('untested');
    expect(saved[0].attribution).toMatch(/conv-1234/);
  }, 60_000);

  it('does not save when a check fails', async () => {
    const saved: DesignEntry[] = [];
    const r = await runGeneration({
      model,
      plan: plan('generation', true),
      specification,
      attributes,
      conversationId: 'conv-2',
      save: async (design) => {
        saved.push(design);
      },
      buildVolume: [100, 100, 100],
    });
    expect(r.ok).toBe(false);
    expect(r.saved).toBe(false);
    expect(saved).toHaveLength(0);
  }, 60_000);
});
