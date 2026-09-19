import { listChecks, registerCheck } from '../registry';
import { parameterLimits, parameterLimitsDefinition } from './parameterLimits';
import { meshValidity, meshValidityDefinition } from './meshValidity';
import { fitClearance, fitClearanceDefinition } from './fitClearance';
import { holeAlignment, holeAlignmentDefinition } from './holeAlignment';

// Registers the demo's code checks once per process. A new check joins by adding one
// registerCheck call here (or anywhere that runs before the loop); the controller never changes.
export function registerDefaultChecks(): void {
  const present = new Set(listChecks().map((c) => c.id));
  if (!present.has(parameterLimitsDefinition.id))
    registerCheck(parameterLimitsDefinition, parameterLimits);
  if (!present.has(meshValidityDefinition.id))
    registerCheck(meshValidityDefinition, meshValidity);
  if (!present.has(fitClearanceDefinition.id))
    registerCheck(fitClearanceDefinition, fitClearance);
  if (!present.has(holeAlignmentDefinition.id))
    registerCheck(holeAlignmentDefinition, holeAlignment);
}
