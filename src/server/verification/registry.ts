import {
  checkDefinitionSchema,
  checkResultSchema,
  type CheckDefinition,
  type CheckResult,
  type DesignEntry,
  type PartClass,
  type Specification,
} from '@shared/schemas/library';
import type { StlSummary } from '@shared/stl';

// Verification registry (PRD, Verification interface; goal 6; D6). A check registers once with
// its definition and an implementation. The runner asks the registry which checks apply to a
// part class; adding a check never touches the controller.

export type CheckInputs = {
  design: DesignEntry;
  specification: Specification;
  // Validated parameter values by OpenSCAD variable name, after the override validator.
  values: Record<string, number>;
  mesh?: StlSummary;
  renderExitCode?: number;
  renderLog?: string;
  buildVolume?: [number, number, number];
};

export type CheckOutcome = Omit<CheckResult, 'checkId'>;

export type CheckImplementation = (
  inputs: CheckInputs,
) => Promise<CheckOutcome> | CheckOutcome;

type Registered = { definition: CheckDefinition; run: CheckImplementation };

const registry = new Map<string, Registered>();

export function registerCheck(
  definition: CheckDefinition,
  run: CheckImplementation,
): void {
  const parsed = checkDefinitionSchema.parse(definition);
  if (registry.has(parsed.id))
    throw new Error(`check "${parsed.id}" is already registered`);
  registry.set(parsed.id, { definition: parsed, run });
}

export function unregisterCheck(id: string): void {
  registry.delete(id);
}

export function listChecks(): CheckDefinition[] {
  return [...registry.values()].map((r) => r.definition);
}

export function checksFor(partClass: PartClass): Registered[] {
  return [...registry.values()].filter((r) =>
    r.definition.partClasses.includes(partClass),
  );
}

export function checksNotRunFor(partClass: PartClass): CheckDefinition[] {
  return [...registry.values()]
    .filter((r) => !r.definition.partClasses.includes(partClass))
    .map((r) => r.definition);
}

export function makeResult(
  checkId: string,
  outcome: CheckOutcome,
): CheckResult {
  return checkResultSchema.parse({ checkId, ...outcome });
}
