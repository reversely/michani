// Node harness for the vendored OpenSCAD WASM build: renders a .scad file with -D overrides to
// STL without a browser. Used by the S3 render suite and by design authors.
// Usage: node tests/render/openscad-node.mjs <file.scad> [name=value ...] [--out out.stl]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const wasmDir = path.resolve('src/vendor/openscad-wasm');
const { default: init } = await import(pathToFileURL(path.join(wasmDir, 'openscad.js')).href);

export async function renderScad(scadPath, overrides = {}, { format = 'binstl' } = {}) {
  const logs = { out: [], err: [] };
  const inst = await init({
    noInitialRun: true,
    print: (t) => logs.out.push(t),
    printErr: (t) => logs.err.push(t),
    // Node's fetch refuses file URLs, so hand the binary over instead of letting the module fetch it.
    wasmBinary: readFileSync(path.join(wasmDir, 'openscad.wasm')),
  });
  inst.FS.writeFile('/input.scad', readFileSync(scadPath, 'utf8'));
  const args = ['/input.scad', '-o', '/out.stl', '--export-format', format, '--backend=manifold'];
  for (const [k, v] of Object.entries(overrides)) args.push(`-D${k}=${v}`);
  const started = Date.now();
  const exitCode = inst.callMain(args);
  const ms = Date.now() - started;
  const stl = exitCode === 0 ? inst.FS.readFile('/out.stl') : null;
  return { exitCode, stl, ms, stderr: logs.err.join('\n'), stdout: logs.out.join('\n') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...rest] = process.argv.slice(2);
  const outIdx = rest.indexOf('--out');
  const out = outIdx >= 0 ? rest.splice(outIdx, 2)[1] : null;
  const overrides = Object.fromEntries(rest.map((s) => s.split('=')));
  const r = await renderScad(file, overrides);
  console.log(`exit ${r.exitCode} in ${r.ms} ms, ${r.stl ? r.stl.length : 0} bytes`);
  if (r.stderr) console.error(r.stderr.split('\n').slice(-5).join('\n'));
  if (out && r.stl) writeFileSync(out, r.stl);
  process.exit(r.exitCode);
}
