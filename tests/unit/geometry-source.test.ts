import { describe, it, expect } from 'vitest';
import { mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLibrary, LibraryLoadError } from '@shared/library/loader';

describe('geometry sources', () => {
  it('every shipped component names a known NopSCADlib module or is measurements only', () => {
    const { components, nopscadlibModules } = loadLibrary('library');
    const modules = new Set(nopscadlibModules);
    for (const c of components) {
      if (c.geometrySource)
        expect(modules.has(c.geometrySource.module), c.id).toBe(true);
    }
    expect(
      components.find((c) => c.id === 'perf-board-60x40')?.geometrySource
        ?.module,
    ).toBe('PERF60x40');
    expect(
      components.find((c) => c.id === 'timber-rail')?.geometrySource,
    ).toBeUndefined();
  });
  it('rejects a component naming a module absent from the list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'michani-geo-'));
    cpSync('library', dir, { recursive: true });
    const path = join(dir, 'components/perf-board-60x40.json');
    const o = JSON.parse(readFileSync(path, 'utf8'));
    o.geometrySource.module = 'NotAVitamin';
    writeFileSync(path, JSON.stringify(o));
    let problems: string[] = [];
    try {
      loadLibrary(dir);
    } catch (e) {
      if (e instanceof LibraryLoadError) problems = e.problems;
    }
    expect(problems.join('\n')).toMatch(/NotAVitamin/);
  });
});
