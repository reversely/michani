import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLibrary, LibraryLoadError } from '@shared/library/loader';

function copyLibrary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'michani-lib-'));
  cpSync('library', dir, { recursive: true });
  return dir;
}
function editJson(path: string, edit: (o: Record<string, unknown>) => void) {
  const o = JSON.parse(readFileSync(path, 'utf8'));
  edit(o);
  writeFileSync(path, JSON.stringify(o));
}
function problemsOf(dir: string): string[] {
  try {
    loadLibrary(dir);
    return [];
  } catch (e) {
    if (e instanceof LibraryLoadError) return e.problems;
    throw e;
  }
}

describe('library loader', () => {
  it('loads the shipped library with zero problems', () => {
    const index = loadLibrary('library');
    expect(index.designs.map((d) => d.id)).toContain('tweezers');
    expect(index.designs.every((d) => d.scad.length > 0)).toBe(true);
    expect(index.components.length).toBeGreaterThanOrEqual(4);
    expect(index.evidenceLevels[0]).toBe('untested');
  });
  it('rejects a design with no licence', () => {
    const dir = copyLibrary();
    editJson(join(dir, 'tweezers/design.json'), (o) => delete o.licence);
    expect(problemsOf(dir).join('\n')).toMatch(/licence/);
  });
  it('rejects a parameter whose variable is absent from the SCAD file', () => {
    const dir = copyLibrary();
    editJson(join(dir, 'tweezers/design.json'), (o) => {
      (o.parameters as Array<{ variable: string }>)[0].variable = 'not_in_file';
    });
    expect(problemsOf(dir).join('\n')).toMatch(
      /not_in_file.*not a top-level parameter/,
    );
  });
  it('rejects limits that disagree with the range comment in the file', () => {
    const dir = copyLibrary();
    editJson(join(dir, 'tweezers/design.json'), (o) => {
      (o.parameters as Array<{ max: number }>)[0].max = 999;
    });
    expect(problemsOf(dir).join('\n')).toMatch(/max 999 disagrees/);
  });
  it('rejects a default that disagrees with the file default', () => {
    const dir = copyLibrary();
    editJson(join(dir, 'tweezers/design.json'), (o) => {
      (o.parameters as Array<{ default: number }>)[0].default = 120;
    });
    expect(problemsOf(dir).join('\n')).toMatch(/default 120 disagrees/);
  });
  it('rejects a parameter naming an unknown attribute', () => {
    const dir = copyLibrary();
    editJson(join(dir, 'tweezers/design.json'), (o) => {
      (o.parameters as Array<{ attributeId: string }>)[0].attributeId = 'mass';
    });
    expect(problemsOf(dir).join('\n')).toMatch(/unknown attribute "mass"/);
  });
  it('reports every problem in one pass', () => {
    const dir = copyLibrary();
    editJson(join(dir, 'tweezers/design.json'), (o) => {
      delete o.licence;
      (o.parameters as Array<{ variable: string }>)[1].variable = 'ghost';
    });
    editJson(join(dir, 'components/pipe-round.json'), (o) => {
      (o.attributes as Array<{ definitionId: string }>)[0].definitionId =
        'nope';
    });
    // The design fails schema validation as a whole, so its parameter problem is not reached,
    // but the component problem still surfaces in the same run.
    const problems = problemsOf(dir);
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.join('\n')).toMatch(/nope/);
  });
});
