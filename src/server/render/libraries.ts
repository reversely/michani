import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';

// Server-side twin of the worker's library mount: detects active include/use statements for
// the bundled libraries and returns the zip entries to write under /libraries/<name>/. The
// list of names mirrors src/lib/libraries.ts; the zips live in public/libraries/.
export const LIBRARY_NAMES = ['MCAD', 'BOSL2', 'NopSCADlib', 'BOSL'] as const;

export type LibraryFile = { path: string; data: Uint8Array };

const cache = new Map<string, Promise<LibraryFile[]>>();

function stripStringsAndComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function librariesUsed(code: string): string[] {
  const active = stripStringsAndComments(code);
  return LIBRARY_NAMES.filter((name) =>
    new RegExp(`(include|use)\\s*<${name}/`).test(active),
  );
}

async function readZip(name: string): Promise<LibraryFile[]> {
  const zipPath = path.resolve(
    process.cwd(),
    'public/libraries',
    `${name}.zip`,
  );
  if (!existsSync(zipPath))
    throw new Error(`library zip not found: ${zipPath}`);
  const bytes = readFileSync(zipPath);
  const entries = await new ZipReader(
    new BlobReader(new Blob([bytes])),
  ).getEntries();
  const files: LibraryFile[] = [];
  for (const entry of entries) {
    if (entry.directory || !entry.getData) continue;
    const data = await entry.getData(new Uint8ArrayWriter());
    files.push({ path: `/libraries/${name}/${entry.filename}`, data });
  }
  return files;
}

export function libraryFiles(name: string): Promise<LibraryFile[]> {
  let p = cache.get(name);
  if (!p) {
    p = readZip(name);
    cache.set(name, p);
  }
  return p;
}
