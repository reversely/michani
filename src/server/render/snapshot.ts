import { deflateSync } from 'node:zlib';
import { readStlTriangles, type Vec3 } from '@shared/stl';

// 3D screenshots of a rendered part for the generation loop and the shape agent (issue
// #25). A software rasteriser over the STL triangles: orthographic isometric projection,
// z-buffer, flat Lambert shading from two lights, and a silhouette pass that darkens depth
// discontinuities so edges read. No browser and no GPU, so it runs wherever the server runs.
// Views are 384 px square, which keeps one view near a thousand image tokens.

export type SnapshotView = { label: string; png: Uint8Array };

export const VIEW_ANGLES: Array<{ label: string; yaw: number; pitch: number }> =
  [
    { label: 'isometric front, from above', yaw: 35, pitch: 30 },
    { label: 'isometric back, from below', yaw: 215, pitch: -25 },
  ];

export function snapshotStl(bytes: Uint8Array, size = 384): SnapshotView[] {
  const tris = readStlTriangles(bytes);
  return VIEW_ANGLES.map((v) => ({
    label: v.label,
    png: encodePng(rasterise(tris, v.yaw, v.pitch, size), size, size),
  }));
}

function rasterise(
  tris: Vec3[][],
  yawDeg: number,
  pitchDeg: number,
  size: number,
): Uint8Array {
  const rgb = new Uint8Array(size * size * 3).fill(238);
  if (tris.length === 0) return rgb;
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rotate about z by yaw, then about x by pitch; the camera looks down -y after that, and
  // the model's z stays up so a part reads the way it prints.
  const view = (p: Vec3): Vec3 => {
    const x = p[0] * cy - p[1] * sy;
    const y = p[0] * sy + p[1] * cy;
    const z = p[2];
    return [x, y * cp - z * sp, y * sp + z * cp];
  };
  const projected = tris.map((t) => t.map(view) as Vec3[]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of projected)
    for (const p of t) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-6);
  const margin = size * 0.08;
  const scale = (size - 2 * margin) / span;
  const ox = margin + (size - 2 * margin - (maxX - minX) * scale) / 2;
  const oz = margin + (size - 2 * margin - (maxZ - minZ) * scale) / 2;
  const toScreen = (p: Vec3) => [
    ox + (p[0] - minX) * scale,
    size - (oz + (p[2] - minZ) * scale),
    p[1],
  ];
  const depth = new Float32Array(size * size).fill(Infinity);
  const shade = new Float32Array(size * size);
  const light1 = normalise([-0.4, -1, 0.7]);
  const light2 = normalise([0.8, -0.3, 0.2]);
  for (const t of projected) {
    const n = normalise(cross(sub(t[1], t[0]), sub(t[2], t[0])));
    if (!Number.isFinite(n[0])) continue;
    // Both sides shade the same so an STL with flipped windings still reads.
    const lambert =
      0.25 + 0.55 * Math.abs(dot(n, light1)) + 0.2 * Math.abs(dot(n, light2));
    const [a, b, c] = t.map(toScreen);
    fillTriangle(a, b, c, lambert, size, depth, shade);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (depth[i] === Infinity) continue;
      const d = depth[i];
      const step = span * 0.015;
      const edge =
        (x > 0 && Math.abs(depth[i - 1] - d) > step) ||
        (y > 0 && Math.abs(depth[i - size] - d) > step) ||
        (x + 1 < size && Math.abs(depth[i + 1] - d) > step) ||
        (y + 1 < size && Math.abs(depth[i + size] - d) > step);
      const v = edge ? 40 : Math.round(60 + 170 * Math.min(1, shade[i]));
      rgb[i * 3] = v;
      rgb[i * 3 + 1] = edge ? 40 : Math.round(v * 0.72);
      rgb[i * 3 + 2] = edge ? 40 : Math.round(v * 0.5);
    }
  }
  return rgb;
}

function fillTriangle(
  a: number[],
  b: number[],
  c: number[],
  lambert: number,
  size: number,
  depth: Float32Array,
  shade: Float32Array,
): void {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
      const i = y * size + x;
      if (z < depth[i]) {
        depth[i] = z;
        shade[i] = lambert;
      }
    }
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalise(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Minimal PNG writer: 8-bit RGB, no filter, one IDAT.
export function encodePng(rgb: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunks = [
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const total = sig.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(sig);
  let off = sig.length;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let table: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
