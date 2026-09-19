import { describe, it, expect } from 'vitest';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema } from '@shared/schemas/library';
import { holeAlignment } from '@/server/verification/checks/holeAlignment';

const { designs } = loadLibrary('library');
const enclosure = designs.find((d) => d.id === 'board-enclosure')!;
const hole = (
  id: string,
  x: number,
  y: number,
  source: 'user' | 'library' = 'user',
) => ({
  id,
  featureType: 'hole',
  attributes: [{ definitionId: 'hole-diameter', value: 3, source }],
  position: [x, y, 0],
  clearanceRule: 'plus',
});
const board = (features: unknown[], geometrySource?: object) =>
  specificationSchema.parse({
    id: 's',
    requirements: ['r'],
    partMeasurements: [],
    printSettings: [],
    components: [
      {
        id: 'perf-board-60x40',
        label: 'Board',
        attributes: [{ definitionId: 'length', value: 60, source: 'user' }],
        interfaceFeatures: features,
        keywords: [],
        ...(geometrySource ? { geometrySource } : {}),
      },
    ],
  });
const values = {
  board_length: 60,
  board_width: 40,
  hole_inset: 3.5,
  opening_offset: 30,
};

describe('holeAlignment', () => {
  it('passes on matching positions', async () => {
    const r = await holeAlignment({
      design: enclosure,
      specification: board([
        hole('hole-1', 3.5, 3.5),
        hole('hole-2', 56.5, 3.5),
        hole('hole-3', 56.5, 36.5),
        hole('hole-4', 3.5, 36.5),
      ]),
      values,
    });
    expect(r.result).toBe('pass');
    expect(r.finding).toMatch(/4 holes/);
  });
  it('fails naming the hole index and offset', async () => {
    const r = await holeAlignment({
      design: enclosure,
      specification: board([hole('hole-1', 3.5, 3.5), hole('hole-2', 50, 3.5)]),
      values,
    });
    expect(r.result).toBe('fail');
    expect(r.finding).toMatch(/hole 2 \(hole-2\)/);
    expect(r.finding).toMatch(/6\.50 mm from the nearest design hole/);
    expect(r.suggestedRevision).toMatch(/hole-inset/);
  });
  it('fails when the side opening misses the measured connector position', async () => {
    const features = [
      hole('hole-1', 3.5, 3.5),
      {
        id: 'connector',
        featureType: 'opening',
        attributes: [{ definitionId: 'offset', value: 20, source: 'user' }],
        clearanceRule: 'none',
      },
    ];
    const r = await holeAlignment({
      design: enclosure,
      specification: board(features),
      values,
    });
    expect(r.result).toBe('fail');
    expect(r.finding).toMatch(
      /opening is at 30 mm but the connector is at 20 mm/,
    );
  });
  it('warns naming both values when the vitamin disagrees with the measured positions', async () => {
    const features = [
      hole('hole-1', 3.5, 3.5),
      hole('hole-1', 4, 4, 'library'),
    ];
    const r = await holeAlignment({
      design: enclosure,
      specification: board(features, {
        tier: 'nopscadlib',
        module: 'PERF60x40',
        licence: 'GPL-3.0',
        evidenceLevel: 'prototyped',
      }),
      values,
    });
    expect(r.result).toBe('warn');
    expect(r.finding).toMatch(
      /measured \(3.5, 3.5\) mm, vitamin PERF60x40 has \(4, 4\) mm/,
    );
  });
  it('warns when no measured positions exist', async () => {
    const r = await holeAlignment({
      design: enclosure,
      specification: board([]),
      values,
    });
    expect(r.result).toBe('warn');
  });
  it('completes within 1 second', async () => {
    const started = performance.now();
    await holeAlignment({
      design: enclosure,
      specification: board([hole('hole-1', 3.5, 3.5)]),
      values,
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
