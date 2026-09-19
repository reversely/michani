import type { CheckDefinition, CheckResult } from '@shared/schemas/library';
import {
  checksFor,
  checksNotRunFor,
  makeResult,
  type CheckInputs,
} from './registry';

export type VerificationReport = {
  results: CheckResult[];
  didNotRun: Array<{ checkId: string; name: string; reason: string }>;
  failed: CheckResult[];
  warned: CheckResult[];
  durationMs: Record<string, number>;
};

// Runs every registered check whose part classes include the design's class (R9) and lists
// the rest as "did not run" so the report never implies a check that never happened (R12).
export async function runChecks(
  inputs: CheckInputs,
): Promise<VerificationReport> {
  const partClass = inputs.design.partClass;
  const results: CheckResult[] = [];
  const durationMs: Record<string, number> = {};
  for (const { definition, run } of checksFor(partClass)) {
    const started = Date.now();
    let result: CheckResult;
    try {
      result = makeResult(definition.id, await run(inputs));
    } catch (err) {
      result = makeResult(definition.id, {
        result: 'fail',
        finding: `The check itself failed: ${err instanceof Error ? err.message : String(err)}`,
        inputsUsed: {},
      });
    }
    durationMs[definition.id] = Date.now() - started;
    results.push(result);
  }
  const didNotRun = checksNotRunFor(partClass).map((d: CheckDefinition) => ({
    checkId: d.id,
    name: d.name,
    reason: `applies to class ${d.partClasses.join(', ')} only; this design is class ${partClass}`,
  }));
  return {
    results,
    didNotRun,
    failed: results.filter((r) => r.result === 'fail'),
    warned: results.filter((r) => r.result === 'warn'),
    durationMs,
  };
}
