import { describe, it, expect } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema } from '@shared/schemas/library';
import { runLibraryAgent, toIndexEntry } from '@/server/agents/library';

const live =
  process.env.LIVE_AGENT_TESTS === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)('library agent (live)', () => {
  const { designs, components } = loadLibrary('library');
  const model = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
    'claude-sonnet-5',
  );
  const base = {
    model,
    index: designs.map(toIndexEntry),
    catalogue: components,
  };

  it('class A tweezers request ranks tweezers first', async () => {
    const started = Date.now();
    const r = await runLibraryAgent({
      ...base,
      specification: specificationSchema.parse({
        id: 'live-a',
        requirements: [
          'The tweezers are 120 mm long.',
          'The tip is 3 mm wide.',
        ],
        components: [],
        partMeasurements: [
          { parameterId: 'length', value: 120, source: 'user' },
        ],
        printSettings: [],
      }),
    });
    console.log(
      `live library call: ${Date.now() - started} ms, kind=${r.kind}`,
    );
    expect(r.kind).toBe('candidates');
    if (r.kind === 'candidates')
      expect(r.candidates[0].designId).toBe('tweezers');
  }, 60_000);

  it('D5 first half: a crank handle request matches nothing', async () => {
    const r = await runLibraryAgent({
      ...base,
      specification: specificationSchema.parse({
        id: 'live-b',
        requirements: [
          'The crank arm is 200 mm long.',
          'The socket fits a 25 mm square pump shaft.',
        ],
        components: [
          {
            id: 'pump-shaft',
            label: 'Pump shaft',
            attributes: [{ definitionId: 'width', value: 25, source: 'user' }],
          },
        ],
        partMeasurements: [],
        printSettings: [],
      }),
    });
    console.log(
      `live: kind=${r.kind} ${r.kind === 'no-match' ? r.message : ''}`,
    );
    expect(r.kind).toBe('no-match');
  }, 60_000);
});
