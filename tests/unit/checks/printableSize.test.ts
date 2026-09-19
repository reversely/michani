import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema } from '@shared/schemas/library';
import { registerDefaultChecks } from '@/server/verification/checks';
import { runChecks } from '@/server/verification/run';

// D6: the sixth check appears in the next report with no change to the controller.
const { designs } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const specification = specificationSchema.parse({
  id: 's',
  requirements: ['r'],
  components: [],
  partMeasurements: [],
  printSettings: [],
});
const mesh = (x: number) => ({
  triangles: 1,
  min: [0, 0, 0] as [number, number, number],
  max: [x, 10, 10] as [number, number, number],
  size: [x, 10, 10] as [number, number, number],
  openEdges: 0,
});

describe('sixth sample check (D6)', () => {
  it('appears in the next check report', async () => {
    registerDefaultChecks();
    const report = await runChecks({
      design: tweezers,
      specification,
      values: {},
      mesh: mesh(100),
      renderExitCode: 0,
    });
    const row = report.results.find((r) => r.checkId === 'printable-size');
    expect(row?.result).toBe('pass');
    expect(report.results.length).toBeGreaterThanOrEqual(4);
  });
  it('warns above a common bed size', async () => {
    registerDefaultChecks();
    const report = await runChecks({
      design: tweezers,
      specification,
      values: {},
      mesh: mesh(250),
      renderExitCode: 0,
    });
    expect(
      report.results.find((r) => r.checkId === 'printable-size')?.result,
    ).toBe('warn');
  });
  it('the loop code did not change when the check was added', () => {
    // The check file and the registry entry are the only additions; the loop directory has no
    // reference to the check id.
    const grep = execSync("grep -rl 'printable-size' src/server/loop || true")
      .toString()
      .trim();
    expect(grep).toBe('');
  });
});
