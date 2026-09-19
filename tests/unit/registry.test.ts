import { describe, it, expect, beforeEach } from 'vitest';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema } from '@shared/schemas/library';
import {
  checksFor,
  listChecks,
  registerCheck,
  unregisterCheck,
} from '@/server/verification/registry';
import { registerDefaultChecks } from '@/server/verification/checks';
import { runChecks } from '@/server/verification/run';

const { designs } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const specification = specificationSchema.parse({
  id: 's',
  requirements: ['r'],
  components: [],
  partMeasurements: [],
  printSettings: [],
});

describe('verification registry', () => {
  beforeEach(() => {
    registerDefaultChecks();
    unregisterCheck('sample-sixth');
  });

  it('registers the three demo checks with their part classes', () => {
    const ids = listChecks().map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'parameter-limits',
        'mesh-validity',
        'fit-clearance',
      ]),
    );
    expect(checksFor('A').map((c) => c.definition.id)).not.toContain(
      'fit-clearance',
    );
    expect(checksFor('B').map((c) => c.definition.id)).toContain(
      'fit-clearance',
    );
  });

  it('a check whose classes exclude the design appears as did not run, with its inputs stored', async () => {
    const report = await runChecks({
      design: tweezers,
      specification,
      values: { length: 100 },
      mesh: {
        triangles: 12,
        min: [0, 0, 0],
        max: [1, 1, 1],
        size: [1, 1, 1],
        openEdges: 0,
      },
      renderExitCode: 0,
    });
    expect(report.didNotRun.map((d) => d.checkId)).toContain('fit-clearance');
    expect(report.results.every((r) => typeof r.inputsUsed === 'object')).toBe(
      true,
    );
    expect(report.failed).toEqual([]);
  });

  it('a newly registered check runs on the next report with no controller change (D6)', async () => {
    registerCheck(
      {
        id: 'sample-sixth',
        name: 'Sample sixth check',
        partClasses: ['A'],
        inputs: ['mesh'],
      },
      ({ mesh }) => ({
        result: mesh && mesh.size[0] < 500 ? 'pass' : 'warn',
        finding: 'Sample check ran.',
        inputsUsed: { size: mesh?.size },
      }),
    );
    const report = await runChecks({
      design: tweezers,
      specification,
      values: {},
      mesh: {
        triangles: 1,
        min: [0, 0, 0],
        max: [1, 1, 1],
        size: [1, 1, 1],
        openEdges: 0,
      },
      renderExitCode: 0,
    });
    expect(report.results.map((r) => r.checkId)).toContain('sample-sixth');
  });

  it('refuses a duplicate registration', () => {
    expect(() =>
      registerCheck(
        { id: 'mesh-validity', name: 'x', partClasses: ['A'], inputs: [] },
        () => ({ result: 'pass', finding: 'x', inputsUsed: {} }),
      ),
    ).toThrow(/already registered/);
  });

  it('each code check completes within 1 second', async () => {
    const started = performance.now();
    await runChecks({
      design: tweezers,
      specification,
      values: { length: 100 },
      mesh: {
        triangles: 12,
        min: [0, 0, 0],
        max: [1, 1, 1],
        size: [1, 1, 1],
        openEdges: 0,
      },
      renderExitCode: 0,
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
