import { describe, it, expect } from 'vitest';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type DesignEntry } from '@shared/schemas/library';
import { parameterLimits } from '@/server/verification/checks/parameterLimits';
import { meshValidity } from '@/server/verification/checks/meshValidity';
import { fitClearance } from '@/server/verification/checks/fitClearance';

const { designs } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const spec = (extra: object = {}) =>
  specificationSchema.parse({
    id: 's',
    requirements: ['r'],
    components: [],
    partMeasurements: [],
    printSettings: [],
    ...extra,
  });
const closed = {
  triangles: 12,
  min: [0, 0, 0] as [number, number, number],
  max: [10, 10, 10] as [number, number, number],
  size: [10, 10, 10] as [number, number, number],
  openEdges: 0,
};

describe('parameterLimits', () => {
  it('passes inside limits and fails naming the limit', async () => {
    expect(
      (
        await parameterLimits({
          design: tweezers,
          specification: spec(),
          values: { length: 100 },
        })
      ).result,
    ).toBe('pass');
    const r = await parameterLimits({
      design: tweezers,
      specification: spec(),
      values: { length: 999 },
    });
    expect(r.result).toBe('fail');
    expect(r.finding).toMatch(/maximum 160/);
    expect(r.suggestedRevision).toMatch(/length/);
  });
});

describe('meshValidity', () => {
  it('passes on a closed mesh', async () => {
    expect(
      (
        await meshValidity({
          design: tweezers,
          specification: spec(),
          values: {},
          mesh: closed,
          renderExitCode: 0,
        })
      ).result,
    ).toBe('pass');
  });
  it('fails on an open mesh, a failed render, and an empty mesh', async () => {
    expect(
      (
        await meshValidity({
          design: tweezers,
          specification: spec(),
          values: {},
          mesh: { ...closed, openEdges: 4 },
          renderExitCode: 0,
        })
      ).finding,
    ).toMatch(/4 open edges/);
    expect(
      (
        await meshValidity({
          design: tweezers,
          specification: spec(),
          values: {},
          renderExitCode: 1,
          renderLog: 'ERROR: x',
        })
      ).result,
    ).toBe('fail');
    expect(
      (
        await meshValidity({
          design: tweezers,
          specification: spec(),
          values: {},
          mesh: { ...closed, triangles: 0 },
          renderExitCode: 0,
        })
      ).result,
    ).toBe('fail');
  });
  it('fails when the bounding box exceeds a supplied build volume', async () => {
    const r = await meshValidity({
      design: tweezers,
      specification: spec(),
      values: {},
      mesh: { ...closed, size: [300, 10, 10] },
      renderExitCode: 0,
      buildVolume: [220, 220, 250],
    });
    expect(r.result).toBe('fail');
    expect(r.finding).toMatch(/build volume/);
    expect(
      (
        await meshValidity({
          design: tweezers,
          specification: spec(),
          values: {},
          mesh: closed,
          renderExitCode: 0,
          buildVolume: [220, 220, 250],
        })
      ).result,
    ).toBe('pass');
  });
});

describe('fitClearance', () => {
  // A synthetic class B design: a socket whose inner diameter is set by parameter
  // socket-diameter, mating with a measured pipe's outer wall.
  const adapter: DesignEntry = {
    id: 'adapter',
    name: 'Adapter',
    description: 'd',
    file: 'design.scad',
    source: 'curated',
    licence: 'CC0-1.0',
    attribution: 'a',
    partClass: 'B',
    riskLabel: 'general',
    evidenceLevel: 'untested',
    keywords: [],
    attributes: [],
    parameters: [
      {
        id: 'socket-diameter',
        variable: 'socket_diameter',
        attributeId: 'outer-diameter',
        default: 25.3,
        min: 5,
        max: 100,
        constraints: [],
      },
    ],
    interfaceFeatures: [
      {
        id: 'socket-a',
        featureType: 'socket',
        attributes: [
          {
            definitionId: 'outer-diameter',
            value: 'socket-diameter',
            source: 'library',
          },
        ],
        clearanceRule: 'plus',
        matesWith: 'outer-wall',
      },
    ],
  };
  const withPipe = (outer: number, clearance = 0.3) =>
    spec({
      components: [
        {
          id: 'pipe-round',
          label: 'Pipe',
          attributes: [
            { definitionId: 'outer-diameter', value: outer, source: 'user' },
          ],
          interfaceFeatures: [
            {
              id: 'outer-wall',
              featureType: 'face',
              attributes: [
                {
                  definitionId: 'outer-diameter',
                  value: outer,
                  source: 'user',
                },
              ],
              clearanceRule: 'plus',
            },
          ],
          keywords: [],
        },
      ],
      printSettings: [
        { definitionId: 'clearance', value: clearance, source: 'user' },
      ],
    });

  it('passes at exactly measured plus clearance', async () => {
    const r = await fitClearance({
      design: adapter,
      specification: withPipe(25),
      values: { socket_diameter: 25.3 },
    });
    expect(r.result).toBe('pass');
  });
  it('fails at clearance minus 0.01 mm, naming the feature pair', async () => {
    const r = await fitClearance({
      design: adapter,
      specification: withPipe(25),
      values: { socket_diameter: 25.29 },
    });
    expect(r.result).toBe('fail');
    expect(r.finding).toMatch(/socket-a/);
    expect(r.finding).toMatch(/outer-wall/);
    expect(r.suggestedRevision).toMatch(/socket-diameter to 25.30/);
  });
  it('warns when no mating pair exists', async () => {
    const r = await fitClearance({
      design: adapter,
      specification: spec(),
      values: {},
    });
    expect(r.result).toBe('warn');
  });
});
