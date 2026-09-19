import { describe, it, expect, beforeAll } from 'vitest';
import { callTool, listTools, toolSet } from '@/engine/tools/registry';
import { registerDefaultTools, library } from '@/engine/tools';

// Issue #12: every tool validates its input before running; CADAM is reached only through
// the adapter behind cadam_render and cadam_parameters.
beforeAll(() => registerDefaultTools());

describe('tool registry', () => {
  it('lists the default tools', () => {
    const names = listTools().map((t) => t.name);
    for (const n of [
      'library_index',
      'library_design',
      'catalogue',
      'materials',
      'attributes',
      'unit_convert',
      'validate_overrides',
      'cadam_render',
      'cadam_render_code',
      'cadam_parameters',
      'check_parameter_limits',
      'check_mesh_validity',
      'check_fit_clearance',
      'check_hole_alignment',
      'check_printable_size',
      'nopscadlib_modules',
    ]) {
      expect(names, n).toContain(n);
    }
  });

  it('each tool accepts a valid input and rejects an invalid one before running', async () => {
    const spec = { id: 's', requirements: ['r'] };
    const cases: Array<[string, unknown, unknown]> = [
      ['library_index', {}, { extra: 1 }],
      ['library_design', { designId: 'tweezers' }, { designId: '../etc' }],
      ['catalogue', { query: 'pipe' }, { query: 3 }],
      ['materials', { materialId: 'petg' }, { materialId: 5 }],
      ['unit_convert', { value: 2, unit: 'in' }, { value: 2, unit: 'furlong' }],
      [
        'validate_overrides',
        { designId: 'tweezers', values: { length: 90 } },
        { designId: 'tweezers', values: { length: 'x' } },
      ],
      [
        'check_parameter_limits',
        { designId: 'tweezers', values: { length: 90 }, specification: spec },
        { designId: 'tweezers', values: {}, specification: 'nope' },
      ],
    ];
    for (const [name, good, bad] of cases) {
      await expect(callTool(name, good), name).resolves.toBeDefined();
      await expect(callTool(name, bad), `${name} invalid`).rejects.toThrow();
    }
    expect(await callTool('unit_convert', { value: 2, unit: 'in' })).toEqual({
      mm: 50.8,
    });
  });

  it('the CADAM adapter renders the tweezers design and returns a mesh summary within budget', async () => {
    const r = (await callTool('cadam_render', {
      designId: 'tweezers',
      values: { length: 90 },
    })) as {
      exitCode: number;
      ms: number;
      summary: { openEdges: number; size: number[] };
    };
    expect(r.exitCode).toBe(0);
    expect(r.summary.openEdges).toBe(0);
    expect(r.summary.size[0]).toBeCloseTo(100, 0);
    expect(r.ms).toBeLessThan(5000);
  }, 30_000);

  it('the render tool refuses undeclared override names without rendering', async () => {
    const r = (await callTool('cadam_render', {
      designId: 'tweezers',
      values: { evil: 1 },
    })) as { rejected?: unknown[] };
    expect(r.rejected?.length).toBe(1);
  });

  it('the library_design tool never returns OpenSCAD source', async () => {
    const d = (await callTool('library_design', {
      designId: 'tweezers',
    })) as Record<string, unknown>;
    expect(d.scad).toBeUndefined();
    expect(d.parameters).toBeDefined();
  });

  it('a tool set for an agent contains only the named tools and rejects unknown names', () => {
    expect(Object.keys(toolSet(['materials', 'unit_convert']))).toEqual([
      'materials',
      'unit_convert',
    ]);
    expect(() => toolSet(['shell'])).toThrow(/no tool named/);
  });

  it('every library design renders through the tool within 5 seconds', async () => {
    for (const d of library().designs) {
      const r = (await callTool('cadam_render', {
        designId: d.id,
        values: {},
      })) as { exitCode: number; ms: number };
      expect(r.exitCode, d.id).toBe(0);
      expect(r.ms, d.id).toBeLessThan(5000);
    }
  }, 60_000);
});
