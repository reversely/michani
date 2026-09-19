// Minimal STL reader for the verification checks and the render tests: triangle count,
// bounding box, and an open-edge count that is zero for a closed mesh. Handles binary and
// ASCII STL, which is what the OpenSCAD worker emits for preview and export.

export type Vec3 = [number, number, number];

export type StlSummary = {
  triangles: number;
  min: Vec3;
  max: Vec3;
  size: Vec3;
  openEdges: number;
};

export function readStl(bytes: Uint8Array): StlSummary {
  const tris = looksAscii(bytes) ? parseAscii(bytes) : parseBinary(bytes);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const edgeCount = new Map<string, number>();
  for (const tri of tris) {
    for (let v = 0; v < 3; v++) {
      const p = tri[v];
      for (let a = 0; a < 3; a++) {
        if (p[a] < min[a]) min[a] = p[a];
        if (p[a] > max[a]) max[a] = p[a];
      }
      const q = tri[(v + 1) % 3];
      const key = edgeKey(p, q);
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  for (const n of edgeCount.values()) if (n !== 2) openEdges++;
  if (tris.length === 0)
    return {
      triangles: 0,
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      openEdges: 0,
    };
  return {
    triangles: tris.length,
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    openEdges,
  };
}

function looksAscii(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  if (head !== 'solid') return false;
  // A binary file can also start with "solid"; trust the triangle count when it matches.
  if (bytes.length >= 84) {
    const n = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(80, true);
    if (84 + n * 50 === bytes.length) return false;
  }
  return true;
}

function parseBinary(bytes: Uint8Array): Vec3[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(80, true);
  const tris: Vec3[][] = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    const tri: Vec3[] = [];
    for (let v = 0; v < 3; v++) {
      tri.push([
        view.getFloat32(o + v * 12, true),
        view.getFloat32(o + v * 12 + 4, true),
        view.getFloat32(o + v * 12 + 8, true),
      ]);
    }
    tris.push(tri);
  }
  return tris;
}

function parseAscii(bytes: Uint8Array): Vec3[][] {
  const text = new TextDecoder().decode(bytes);
  const tris: Vec3[][] = [];
  let current: Vec3[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
    if (!m) continue;
    current.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (current.length === 3) {
      tris.push(current);
      current = [];
    }
  }
  return tris;
}

// Vertices are quantised to a micrometre so that floating point noise between neighbouring
// triangles does not split a shared edge into two.
function edgeKey(a: Vec3, b: Vec3): string {
  const ka = a.map((x) => Math.round(x * 1000)).join(',');
  const kb = b.map((x) => Math.round(x * 1000)).join(',');
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}
