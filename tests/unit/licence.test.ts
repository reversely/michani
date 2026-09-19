import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// S0: the fork is GPLv3 and the WASM build ships a source offer; both must stay at the root.
describe('licence files', () => {
  it('keeps the GPLv3 licence at the repository root', () => {
    const text = readFileSync('LICENSE', 'utf8');
    expect(text).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(text).toContain('Version 3');
  });

  it('keeps the OpenSCAD WASM source offer', () => {
    expect(existsSync('src/vendor/openscad-wasm/SOURCE-OFFER.txt')).toBe(true);
  });

  it('gives every library design a licence field', () => {
    const root = 'library';
    if (!existsSync(root)) return; // checkpoint 2 creates the folder
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(root, entry.name, 'design.json');
      if (!existsSync(metaPath)) continue;
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      expect(meta.licence, `${metaPath} licence`).toBeTruthy();
    }
  });
});
