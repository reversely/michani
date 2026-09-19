import type { CheckDefinition } from '@shared/schemas/library';
import type { CheckImplementation } from '../registry';

// Sixth sample check (D6): warns when any dimension exceeds a common desktop printer bed. It
// joined by one file plus one registry entry, with no change under src/server/loop/.
export const printableSizeDefinition: CheckDefinition = {
  id: 'printable-size',
  name: 'Printable size',
  partClasses: ['A', 'B', 'C'],
  inputs: ['mesh'],
};

export const COMMON_BED_MM = 200;

export const printableSize: CheckImplementation = ({ mesh }) => {
  if (!mesh)
    return {
      result: 'warn',
      finding: 'No mesh was available, so the size was not checked.',
      inputsUsed: {},
    };
  const largest = Math.max(...mesh.size);
  const inputsUsed = { size: mesh.size, commonBedMm: COMMON_BED_MM };
  if (largest > COMMON_BED_MM) {
    return {
      result: 'warn',
      finding: `The largest dimension is ${largest.toFixed(1)} mm, above the ${COMMON_BED_MM} mm bed of a common desktop printer.`,
      suggestedRevision: 'Reduce the largest dimension or split the part.',
      inputsUsed,
    };
  }
  return {
    result: 'pass',
    finding: `The largest dimension is ${largest.toFixed(1)} mm, within a ${COMMON_BED_MM} mm bed.`,
    inputsUsed,
  };
};
