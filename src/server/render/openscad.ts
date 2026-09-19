import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readStl, type StlSummary } from '@shared/stl';
import { librariesUsed, libraryFiles } from './libraries';

// Server-side render through the vendored OpenSCAD WebAssembly build, for the verification
// stage. Same binary the browser uses; Node gets the bytes directly because its fetch refuses
// file URLs. The module loads on first use so server start-up stays fast.

export type RenderOutput = {
  exitCode: number;
  stl: Uint8Array | null;
  summary: StlSummary | null;
  ms: number;
  log: string;
};

type OpenSCADModule = {
  FS: {
    writeFile(p: string, d: string | Uint8Array): void;
    readFile(p: string): Uint8Array;
    mkdir(p: string): void;
    analyzePath(p: string): { exists: boolean };
  };
  callMain(args: string[]): number;
};
type Init = (opts: Record<string, unknown>) => Promise<OpenSCADModule>;

const wasmDir = path.resolve(process.cwd(), 'src/vendor/openscad-wasm');
let initPromise: Promise<Init> | null = null;

async function loadInit(): Promise<Init> {
  initPromise ??= import(
    /* @vite-ignore */ pathToFileURL(path.join(wasmDir, 'openscad.js')).href
  ).then((m: { default: Init }) => m.default);
  return initPromise;
}

export async function renderScadToStl(
  scad: string,
  overrides: Record<string, number>,
): Promise<RenderOutput> {
  const init = await loadInit();
  const logs: string[] = [];
  const inst = await init({
    noInitialRun: true,
    print: (t: string) => logs.push(t),
    printErr: (t: string) => logs.push(t),
    wasmBinary: readFileSync(path.join(wasmDir, 'openscad.wasm')),
  });
  inst.FS.writeFile('/input.scad', scad);
  for (const name of librariesUsed(scad)) {
    for (const file of await libraryFiles(name)) {
      mkdirRecursive(inst, path.posix.dirname(file.path));
      inst.FS.writeFile(file.path, file.data);
    }
  }
  const args = [
    '/input.scad',
    '-o',
    '/out.stl',
    '--export-format',
    'binstl',
    '--backend=manifold',
  ];
  for (const [name, value] of Object.entries(overrides)) {
    if (!/^[A-Za-z_$][A-Za-z0-9_]*$/.test(name) || !Number.isFinite(value)) {
      throw new Error(`refusing to render with override "${name}"`);
    }
    args.push(`-D${name}=${value}`);
  }
  const started = Date.now();
  const exitCode = inst.callMain(args);
  const ms = Date.now() - started;
  let stl: Uint8Array | null = null;
  try {
    stl = exitCode === 0 ? inst.FS.readFile('/out.stl') : null;
  } catch {
    stl = null;
  }
  return {
    exitCode,
    stl,
    summary: stl ? readStl(stl) : null,
    ms,
    log: logs.join('\n'),
  };
}

function mkdirRecursive(inst: OpenSCADModule, dir: string): void {
  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    if (!inst.FS.analyzePath(current).exists) inst.FS.mkdir(current);
  }
}
