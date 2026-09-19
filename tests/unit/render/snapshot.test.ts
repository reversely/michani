import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { snapshotStl, encodePng } from '@/server/render/snapshot';

// Issue #25: two 3D views of a mesh, no browser, no model. An ASCII STL of an L-shaped
// bracket (two boxes) so the silhouette differs between the front and back views.
function box([x0, y0, z0]: number[], [x1, y1, z1]: number[]): number[][][] {
  const p = (x: number, y: number, z: number) => [x, y, z];
  const c = [
    p(x0, y0, z0),
    p(x1, y0, z0),
    p(x1, y1, z0),
    p(x0, y1, z0),
    p(x0, y0, z1),
    p(x1, y0, z1),
    p(x1, y1, z1),
    p(x0, y1, z1),
  ];
  const q = (a: number, b: number, cc: number, d: number) => [
    [c[a], c[b], c[cc]],
    [c[a], c[cc], c[d]],
  ];
  return [
    ...q(0, 1, 2, 3),
    ...q(4, 5, 6, 7),
    ...q(0, 1, 5, 4),
    ...q(1, 2, 6, 5),
    ...q(2, 3, 7, 6),
    ...q(3, 0, 4, 7),
  ];
}
const tris = [...box([0, 0, 0], [40, 10, 10]), ...box([0, 0, 0], [10, 10, 40])];
const ascii = `solid l\n${tris
  .map(
    (t) =>
      `facet normal 0 0 0\nouter loop\n${t.map((v) => `vertex ${v.join(' ')}`).join('\n')}\nendloop\nendfacet`,
  )
  .join('\n')}\nendsolid l\n`;

describe('snapshotStl', () => {
  it('returns two PNG views that differ from each other and from a blank image', () => {
    const views = snapshotStl(new TextEncoder().encode(ascii), 128);
    expect(views).toHaveLength(2);
    const blank = encodePng(new Uint8Array(128 * 128 * 3).fill(238), 128, 128);
    for (const v of views) {
      expect(Array.from(v.png.subarray(0, 4))).toEqual([137, 80, 78, 71]);
      expect(Buffer.compare(Buffer.from(v.png), Buffer.from(blank))).not.toBe(
        0,
      );
    }
    expect(
      Buffer.compare(Buffer.from(views[0].png), Buffer.from(views[1].png)),
    ).not.toBe(0);
    mkdirSync('docs/progress', { recursive: true });
    views.forEach((v, i) =>
      writeFileSync(
        `docs/progress/20260919-snapshot-l-bracket-${i + 1}.png`,
        v.png,
      ),
    );
  });

  it('renders an empty mesh as a blank image without throwing', () => {
    const views = snapshotStl(
      new TextEncoder().encode('solid e\nendsolid e\n'),
      32,
    );
    expect(views).toHaveLength(2);
  });
});
