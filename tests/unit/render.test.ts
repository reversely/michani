import { describe, it, expect } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLibrary } from '@shared/library/loader';
import { validateOverrides } from '@shared/library/overrides';
import { readStl } from '@shared/stl';
// The harness is plain ESM; vitest resolves it relative to the repo root.
import { renderScad } from '../render/openscad-node.mjs';

// Suite S3: every library design renders closed at defaults and at each parameter's limits,
// an override changes the geometry without touching the source, and an undeclared override
// never reaches the renderer. Render times are appended to docs/progress/render-times.md.
const BUDGET_MS = 5000;
const reportDir = 'docs/progress';
const reportPath = join(reportDir, 'render-times.md');
mkdirSync(reportDir, { recursive: true });
if (!existsSync(reportPath)) {
  writeFileSync(
    reportPath,
    '# Render times\n\nAppended by tests/unit/render.test.ts (suite S3).\n\n| When | Design | Parameter set | ms | Triangles | Size (mm) |\n| --- | --- | --- | --- | --- | --- |\n',
  );
}
function record(
  design: string,
  label: string,
  ms: number,
  summary: ReturnType<typeof readStl>,
) {
  appendFileSync(
    reportPath,
    `| ${new Date().toISOString()} | ${design} | ${label} | ${ms} | ${summary.triangles} | ${summary.size.map((v) => v.toFixed(1)).join(' x ')} |\n`,
  );
}

const { designs } = loadLibrary('library');

describe('S3 render', () => {
  for (const design of designs) {
    const file = join('library', design.id, design.file);

    it(`${design.id} renders closed at defaults within budget`, async () => {
      const r = await renderScad(file, {});
      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.ms).toBeLessThan(BUDGET_MS);
      const s = readStl(r.stl!);
      expect(s.triangles).toBeGreaterThan(0);
      expect(s.openEdges).toBe(0);
      record(design.id, 'defaults', r.ms, s);
    }, 30_000);

    it(`${design.id} renders closed at every parameter minimum and maximum`, async () => {
      for (const p of design.parameters) {
        for (const [label, value] of [
          ['min', p.min],
          ['max', p.max],
        ] as const) {
          const check = validateOverrides(design, { [p.variable]: value });
          if (!check.ok) continue; // a constraint may exclude a lone extreme; that is the check's job
          const r = await renderScad(file, check.values);
          expect(r.exitCode, `${p.variable}=${value}: ${r.stderr}`).toBe(0);
          const s = readStl(r.stl!);
          expect(s.openEdges, `${p.variable}=${value}`).toBe(0);
          record(design.id, `${p.variable}=${value} (${label})`, r.ms, s);
        }
      }
    }, 120_000);
  }

  it('an override changes the bounding box and leaves the source untouched', async () => {
    const tweezers = designs.find((d) => d.id === 'tweezers')!;
    const file = join('library', 'tweezers', tweezers.file);
    const before = tweezers.scad;
    const base = readStl((await renderScad(file, {})).stl!);
    const check = validateOverrides(tweezers, { length: 90 });
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const after = readStl((await renderScad(file, check.values)).stl!);
    expect(after.size[0]).not.toBeCloseTo(base.size[0], 1);
    expect(
      loadLibrary('library').designs.find((d) => d.id === 'tweezers')!.scad,
    ).toBe(before);
    appendFileSync(
      reportPath,
      `| ${new Date().toISOString()} | tweezers | override length=90 | | | before ${base.size.map((v) => v.toFixed(1)).join(' x ')}, after ${after.size.map((v) => v.toFixed(1)).join(' x ')} |\n`,
    );
  }, 30_000);

  it('an undeclared override is rejected before any render', () => {
    const tweezers = designs.find((d) => d.id === 'tweezers')!;
    const check = validateOverrides(tweezers, {
      length: 90,
      evil: '1; system("rm")',
    });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.violations.map((v) => v.reason)).toContain('undeclared');
  });
});
