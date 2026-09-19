import { describe, it, expect } from 'vitest';
import parseParameters from '@shared/parseParameters';
import { loadLibrary } from '@shared/library/loader';
import { calculateParameterRange } from '@/utils/parameterUtils';

// The slider takes its limits from the parsed Customizer range, and the loader's parity check
// forces that range to equal the ParameterDefinition, so every slider is bounded by the
// metadata. This test pins the last link: the slider's own range function returns those limits.
describe('slider limits', () => {
  const { designs } = loadLibrary('library');
  for (const design of designs) {
    it(`${design.id}: slider min, max, and default equal the metadata`, () => {
      const parsed = new Map(
        parseParameters(design.scad).map((p) => [p.name, p]),
      );
      for (const def of design.parameters) {
        const param = parsed.get(def.variable)!;
        expect(calculateParameterRange(param)).toEqual({
          min: def.min,
          max: def.max,
        });
        expect(param.defaultValue).toBe(def.default);
      }
    });
  }
});
