import { describe, it, expect } from 'vitest';
import { loadLibrary } from '@shared/library/loader';
import { specificationSchema, type Plan } from '@shared/schemas/library';
import {
  buildReport,
  renderMarkdown,
  escapeMarkdown,
} from '@/server/report/build';
import {
  buildPackageFiles,
  PACKAGE_FILE_NAMES,
  scadWithOverrides,
} from '@/utils/packageUtils';
import type { VerificationReport } from '@/server/verification/run';

const { designs, components } = loadLibrary('library');
const tweezers = designs.find((d) => d.id === 'tweezers')!;
const enclosure = designs.find((d) => d.id === 'board-enclosure')!;
const plan: Plan = {
  id: 'p',
  function: 'adaptation',
  candidateDesignId: 'tweezers',
  measurementsNeeded: [],
  checkIds: [],
  riskLabel: 'general',
  reason: 'r',
  confirmed: true,
};
const values = { length: 120, tip_width: 3 };
const report: VerificationReport = {
  results: [
    {
      checkId: 'parameter-limits',
      result: 'pass',
      finding: 'ok',
      inputsUsed: {},
    },
    {
      checkId: 'requirement-coverage',
      result: 'pass',
      finding: '1. pass: length = 120 mm. | [x](y) *bold* <b>',
      inputsUsed: {},
    },
  ],
  didNotRun: [
    {
      checkId: 'fit-clearance',
      name: 'Fit and clearance',
      reason: 'class B, C only',
    },
  ],
  failed: [],
  warned: [],
  durationMs: {},
};
const specification = specificationSchema.parse({
  id: 's',
  requirements: ['The tweezers are 120 mm long.'],
  components: [],
  partMeasurements: [],
  printSettings: [
    { definitionId: 'clearance', value: 0.3, source: 'computed' },
  ],
});

describe('report', () => {
  const record = buildReport({
    design: tweezers,
    specification,
    plan,
    values,
    report,
    attempts: 1,
    generatedAt: new Date('2026-09-19T00:00:00Z'),
  });
  it('lists checks, did-not-run entries, evidence level, default clearance, and the no-load-check statement', () => {
    expect(record.checks.map((c) => c.checkId)).toEqual([
      'parameter-limits',
      'requirement-coverage',
    ]);
    expect(record.didNotRun[0].checkId).toBe('fit-clearance');
    expect(record.design.evidenceLevel).toBe('untested');
    expect(record.design.riskLabel).toBe('general');
    expect(record.clearance).toEqual({ value: 0.3, source: 'computed' });
    expect(record.loadCheckStatement).toMatch(/No load/);
  });
  it('names every component geometry source or states none was modelled, and adds the NopSCADlib attribution', () => {
    const board = components.find((c) => c.id === 'perf-board-60x40')!;
    const pipe = components.find((c) => c.id === 'pipe-round')!;
    const spec = specificationSchema.parse({
      ...specification,
      components: [board, pipe],
    });
    const r = buildReport({
      design: enclosure,
      specification: spec,
      plan,
      values,
      report,
      attempts: 1,
    });
    expect(
      r.components.find((c) => c.id === 'perf-board-60x40')?.geometrySource,
    ).toMatch(/nopscadlib PERF60x40/);
    expect(
      r.components.find((c) => c.id === 'pipe-round')?.geometrySource,
    ).toBe('measurements only, no geometry modelled');
    expect(r.attributions.some((a) => a.includes('NopSCADlib'))).toBe(true);
  });
  it('a generated design reports the evidence level untested', () => {
    const r = buildReport({
      design: { ...tweezers, source: 'generated', evidenceLevel: 'field used' },
      specification,
      plan,
      values,
      report,
      attempts: 1,
    });
    expect(r.design.evidenceLevel).toBe('untested');
  });
  it('renders Markdown that matches the JSON record and escapes model text', () => {
    const md = renderMarkdown(record);
    for (const c of record.checks) expect(md).toContain(c.checkId);
    expect(md).toContain('did not run');
    expect(md).toContain(escapeMarkdown(record.checks[1].finding));
    expect(md).not.toContain('[x](y)');
    expect(md).not.toContain('<b>');
    expect(md).toContain('default applied by the requirements step');
  });
});

describe('package', () => {
  it('lists exactly the files R11 names and the SCAD carries the chosen values with no other body edit', () => {
    const record = buildReport({
      design: tweezers,
      specification,
      plan,
      values,
      report,
      attempts: 1,
    });
    const files = buildPackageFiles({
      stl: new Uint8Array([1, 2, 3]),
      scad: tweezers.scad,
      values,
      report: record,
      reportMarkdown: renderMarkdown(record),
    });
    expect(files.map((f) => f.name)).toEqual([...PACKAGE_FILE_NAMES]);
    const scad = files.find((f) => f.name === 'design.scad')!.content as string;
    expect(scad).toMatch(/^\/\/ Parameter values chosen/);
    expect(scad).toContain('length = 120;');
    expect(scad).toContain('tip_width = 3;');
    expect(scad).toContain('// (default replaced above) length = 100;');
    // Every original line survives, either verbatim or as the commented default.
    const bodyLines = tweezers.scad.split('\n');
    for (const line of bodyLines) expect(scad).toContain(line);
    expect(
      JSON.parse(files.find((f) => f.name === 'report.json')!.content as string)
        .design.id,
    ).toBe('tweezers');
    expect(files.find((f) => f.name === 'LICENCE.txt')!.content).toContain(
      'CC0-1.0',
    );
  });
  it('builds the file list within 5 seconds', () => {
    const record = buildReport({
      design: tweezers,
      specification,
      plan,
      values,
      report,
      attempts: 1,
    });
    const started = performance.now();
    buildPackageFiles({
      stl: new Uint8Array(1_000_000),
      scad: tweezers.scad,
      values,
      report: record,
      reportMarkdown: renderMarkdown(record),
    });
    expect(performance.now() - started).toBeLessThan(5000);
  });
  it('scadWithOverrides comments out only the overridden defaults', () => {
    const out = scadWithOverrides('a = 1; // [0:2]\nb = 2;\nmodule m() {}\n', {
      a: 1.5,
    });
    expect(out).toContain('a = 1.5;');
    expect(out).toContain('// (default replaced above) a = 1; // [0:2]');
    expect(out).toContain('\nb = 2;\n');
  });
});
