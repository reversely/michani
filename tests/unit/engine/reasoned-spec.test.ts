import { describe, it, expect, beforeAll } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { registerDefaultTools } from '@/engine/tools';
import { createEngine } from '@/engine/run';
import { gatherTurn, missingFields, newSession } from '@/engine/session';
import {
  finaliseExtraction,
  requirementsExtractor,
} from '@/engine/agents/requirements';
import { generationBriefFrom } from '@/engine/loop';

// Issue #20: the agent reasons over the request; only size and material gate the session.
beforeAll(() => registerDefaultTools());
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const text = (body: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(body) }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage,
  warnings: [],
});

const armchair = {
  summary:
    'A miniature armchair in the style of the IKEA STOCKHOLM 2025, 127 by 127 mm, in several colours of PLA.',
  details:
    'a miniature 5" x 5" armchair that looks like the IKEA STOCKHOLM 2025 with different colours of PLA for the different components',
  sizeMm: {
    width: 127,
    depth: 127,
    height: 120,
    note: 'height assumed from the reference proportions',
  },
  material: 'pla',
  scope: 'printable',
  sections: [
    {
      heading: 'Purpose and use',
      content: 'A decorative tabletop miniature; no load.',
      status: 'assumed',
    },
    {
      heading: 'Style reference',
      content:
        'STOCKHOLM 2025 armchair: low, wide seat, rounded arms, tapered legs.',
      status: 'researched',
      source: 'https://www.ikea.com',
    },
    {
      heading: 'Components and colours',
      content:
        'Seat, backrest, two arms, four legs, each printed in a different PLA colour.',
      status: 'stated',
    },
  ],
  requirements: ['The miniature is 127 mm wide and 127 mm deep.'],
  reply:
    'A 127 by 127 mm STOCKHOLM-style miniature in multi-colour PLA. I am assuming a display piece with no load and a height of about 120 mm from the reference proportions. A plan comes next.',
};

describe('reasoned specification (#20)', () => {
  it('the armchair request reaches a plan in one turn with size and material stated and use assumed', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const system = JSON.stringify(
          options.prompt.find((m) => m.role === 'system') ?? '',
        );
        if (system.includes('library step'))
          return text({
            matched: false,
            noMatchReason: 'no armchair in the library',
            componentMatches: [],
          });
        return text(armchair);
      },
    });
    const engine = createEngine(model);
    const r = await engine.turn(engine.start(), armchair.details);
    expect(r.session.state).toBe('planned');
    const spec = r.session.specification;
    expect(spec.details).toBe(armchair.details);
    expect(spec.sizeMm?.width).toBe(127);
    expect(spec.material).toBe('pla');
    expect(spec.sections.map((s) => s.status)).toEqual([
      'assumed',
      'researched',
      'stated',
    ]);
    expect(r.reply).toMatch(/assuming a display piece/);
    expect(generationBriefFrom(spec)).toMatch(
      /Details from the person: a miniature/,
    );
    expect(generationBriefFrom(spec)).toMatch(
      /Style reference \(researched, source https/,
    );
  });

  it('ladder stays in gathering with a scoping reply', async () => {
    const extract = requirementsExtractor(
      new MockLanguageModelV3({
        doGenerate: async () =>
          text({
            summary: 'A ladder.',
            scope: 'not-printable',
            reply:
              'A whole ladder is too large and too heavily loaded to print. I can do its rung caps, feet, or a hanging hook; which one?',
          }),
      }),
    );
    const r = await gatherTurn(
      newSession('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      'ladder',
      extract,
    );
    expect(r.session.state).toBe('gathering');
    expect(r.reply).toMatch(/rung caps/);
  });

  it('only size and material gate the session', () => {
    const s = newSession('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(missingFields(s.specification).map((f) => f.id)).toEqual([
      'size',
      'material',
    ]);
    const withSize = finaliseExtraction(
      { sizeMm: { width: 50 } },
      s,
    ).specification;
    expect(missingFields(withSize).map((f) => f.id)).toEqual(['material']);
    const both = finaliseExtraction(
      { sizeMm: { width: 50 }, material: 'PLA' },
      s,
    ).specification;
    expect(missingFields(both)).toEqual([]);
    expect(both.dimensions).toEqual([{ name: 'width', value: 50, unit: 'mm' }]);
  });

  it('an oddly shaped section or size is dropped without failing the turn', () => {
    const s = newSession('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    const r = finaliseExtraction(
      {
        summary: ['Two', 'summaries'],
        sizeMm: { widthMm: '80', height: 'tall' },
        material: ['PETG', 'PLA'],
        sections: [
          { title: 'Use', text: 'Display only.', status: 'ASSUMED' },
          'not a section',
          { heading: 'No content' },
        ],
        dimensions: 'not a list',
        reply: '',
      },
      s,
    );
    expect(r.specification.summary).toBe('Two, summaries');
    expect(r.specification.sizeMm).toEqual({ width: 80 });
    expect(r.specification.material).toBe('petg');
    expect(r.specification.sections).toEqual([
      { heading: 'Use', content: 'Display only.', status: 'assumed' },
    ]);
    expect(r.reply).toBeUndefined();
  });
});
