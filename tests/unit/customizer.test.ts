import { describe, it, expect } from 'vitest';
import parseParameters from '@shared/parseParameters';
import { loadLibrary } from '@shared/library/loader';

// Customizer parity: the sliders and the drafting agent both read parameters through
// parseParameters, so each design's metadata must agree with what that parser sees.
describe('customizer parity', () => {
  const { designs } = loadLibrary('library');
  for (const design of designs) {
    it(`${design.id}: every declared parameter matches the file`, () => {
      const parsed = new Map(
        parseParameters(design.scad).map((p) => [p.name, p]),
      );
      for (const param of design.parameters) {
        const inFile = parsed.get(param.variable);
        expect(inFile, param.variable).toBeDefined();
        expect(inFile?.defaultValue).toBe(param.default);
        expect(inFile?.range?.min).toBe(param.min);
        expect(inFile?.range?.max).toBe(param.max);
        expect(inFile?.type).toBe('number');
      }
    });
  }
});
