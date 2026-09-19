import { validateOverrides } from '@shared/library/overrides';
import type { CheckDefinition } from '@shared/schemas/library';
import type { CheckImplementation } from '../registry';

// Every value sits inside its declared limits and satisfies each constraint expression. The
// override validator already enforces this before a render; the check records the verdict in
// the report so the viewer sees it listed with the others.
export const parameterLimitsDefinition: CheckDefinition = {
  id: 'parameter-limits',
  name: 'Parameter limits',
  partClasses: ['A', 'B', 'C'],
  inputs: ['parameters', 'design'],
};

export const parameterLimits: CheckImplementation = ({ design, values }) => {
  const r = validateOverrides(design, values);
  const inputsUsed = {
    values,
    limits: design.parameters.map((p) => ({
      id: p.id,
      min: p.min,
      max: p.max,
      constraints: p.constraints,
    })),
  };
  if (r.ok) {
    return {
      result: 'pass',
      finding: `All ${Object.keys(values).length} values sit inside their declared limits and constraints.`,
      inputsUsed,
    };
  }
  return {
    result: 'fail',
    finding: r.violations.map((v) => v.detail).join(' '),
    suggestedRevision: r.violations
      .map((v) =>
        v.reason === 'above-maximum' || v.reason === 'below-minimum'
          ? `Set ${v.name} inside its limits.`
          : `Correct ${v.name}: ${v.detail}`,
      )
      .join(' '),
    inputsUsed,
  };
};
