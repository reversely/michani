import { describe, it, expect, beforeAll } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createAnthropic } from '@ai-sdk/anthropic';
import { registerDefaultTools } from '@/engine/tools';
import { researchTools } from '@/engine/tools/research';
import { gatherTurn, newSession } from '@/engine/session';
import { requirementsExtractor } from '@/engine/agents/requirements';

beforeAll(() => registerDefaultTools());
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const scripted = (responses: unknown[]) => {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(responses[Math.min(i++, responses.length - 1)]),
        },
      ],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
};

describe('agent-authored replies and scope (#19)', () => {
  it('a not-printable request stays in gathering with a reply proposing printable components', async () => {
    const extract = requirementsExtractor(
      scripted([
        {
          purpose: 'ladder',
          scope: 'not-printable',
          reply:
            'A whole ladder is too large and too heavily loaded for a printed part. I can design its rung end caps, its rubber-foot replacements, or a wall hook for hanging it. Which do you need?',
        },
      ]),
    );
    const r = await gatherTurn(
      newSession('99999999-9999-4999-8999-999999999999'),
      'ladder',
      extract,
    );
    expect(r.session.state).toBe('gathering');
    expect(r.reply).toMatch(/rung end caps/);
    expect(r.session.specification.scope).toBe('not-printable');
  });

  it("uses the agent's reply instead of the template, and never repeats a template verbatim", async () => {
    const extract = requirementsExtractor(
      scripted([
        {
          purpose: 'ladder rung cap',
          scope: 'printable',
          reply:
            'A rung cap it is. Typical aluminium ladder rungs are 32 mm wide by 25 mm deep; shall I use those, or do you have the measurements?',
        },
        {
          purpose: 'ladder rung cap',
          scope: 'printable',
          dimensions: [
            { name: 'rung width', value: 32, unit: 'mm' },
            { name: 'rung depth', value: 25, unit: 'mm' },
          ],
        },
      ]),
    );
    let r = await gatherTurn(
      newSession('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      'a cap for a ladder rung',
      extract,
    );
    expect(r.reply).toMatch(/32 mm wide/);
    r = await gatherTurn(r.session, 'use those', extract);
    expect(r.reply).not.toBe(r.session.transcript[1].text);
    expect(r.session.specification.dimensions).toHaveLength(2);
  });

  it('a placeholder reply or scope is dropped', async () => {
    const extract = requirementsExtractor(
      scripted([{ purpose: 'p', scope: '<UNKNOWN>', reply: 'n/a' }]),
    );
    const r = await gatherTurn(
      newSession('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      'p',
      extract,
    );
    expect(r.session.specification.scope).toBeUndefined();
    expect(r.reply).toMatch(/dimensions|millimetres/);
  });

  it('the research tool exists for an Anthropic model and not for a mock', () => {
    expect(Object.keys(researchTools(scripted([{}])))).toEqual([]);
    const model = createAnthropic({ apiKey: 'test-key' })('claude-sonnet-5');
    expect(Object.keys(researchTools(model))).toEqual(['research']);
  });
});
