import { describe, it, expect } from 'vitest';
import { readStl } from '@shared/stl';

type V = [number, number, number];
const cubeFaces = (): V[][] => {
  const v: V[] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
    [0, 0, 10],
    [10, 0, 10],
    [10, 10, 10],
    [0, 10, 10],
  ];
  const quads = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  return quads.flatMap(([a, b, c, d]) => [
    [v[a], v[b], v[c]],
    [v[a], v[c], v[d]],
  ]);
};
function binary(tris: V[][]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const o = 84 + i * 50 + 12;
    t.forEach((p, vi) =>
      p.forEach((x, a) => view.setFloat32(o + vi * 12 + a * 4, x, true)),
    );
  });
  return new Uint8Array(buf);
}
function ascii(tris: V[][]): Uint8Array {
  const lines = ['solid cube'];
  for (const t of tris) {
    lines.push(' facet normal 0 0 0', '  outer loop');
    for (const p of t) lines.push(`   vertex ${p.join(' ')}`);
    lines.push('  endloop', ' endfacet');
  }
  lines.push('endsolid cube');
  return new TextEncoder().encode(lines.join('\n'));
}

describe('STL reader', () => {
  it('reads a binary closed cube', () => {
    const s = readStl(binary(cubeFaces()));
    expect(s.triangles).toBe(12);
    expect(s.size).toEqual([10, 10, 10]);
    expect(s.openEdges).toBe(0);
  });
  it('reads an ASCII closed cube', () => {
    const s = readStl(ascii(cubeFaces()));
    expect(s.triangles).toBe(12);
    expect(s.openEdges).toBe(0);
  });
  it('reports open edges for a cube missing one face', () => {
    const s = readStl(binary(cubeFaces().slice(2)));
    expect(s.triangles).toBe(10);
    expect(s.openEdges).toBeGreaterThan(0);
  });
});
