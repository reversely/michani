import type {
  CheckDefinition,
  InterfaceFeature,
} from '@shared/schemas/library';
import type { CheckImplementation } from '../registry';

// For each pair of mating interface features, the design dimension must exceed (or fall
// short of, for a 'minus' rule) the measured dimension by at least the clearance. The design
// side reads its dimension from the parameter its feature names; the component side reads the
// measured attribute value with the same attribute id.
export const fitClearanceDefinition: CheckDefinition = {
  id: 'fit-clearance',
  name: 'Fit and clearance',
  partClasses: ['B', 'C'],
  inputs: ['parameters', 'design', 'specification'],
};

function featureValue(
  feature: InterfaceFeature,
  attributeId: string,
): number | undefined {
  const v = feature.attributes.find(
    (a) => a.definitionId === attributeId,
  )?.value;
  return typeof v === 'number' ? v : undefined;
}

export const fitClearance: CheckImplementation = ({
  design,
  specification,
  values,
}) => {
  const clearance = specification.printSettings.find(
    (v) => v.definitionId === 'clearance',
  )?.value;
  const clearanceMm = typeof clearance === 'number' ? clearance : 0;
  const pairs: Array<{
    designFeature: string;
    componentFeature: string;
    attributeId: string;
    designValue: number;
    measured: number;
    rule: string;
  }> = [];
  const problems: string[] = [];
  const revisions: string[] = [];

  for (const feature of design.interfaceFeatures) {
    if (!feature.matesWith) continue;
    // The design feature's attribute names the parameter that sets its dimension: the
    // attribute value carries the parameter id as a string.
    for (const attr of feature.attributes) {
      if (typeof attr.value !== 'string') continue;
      const param = design.parameters.find((p) => p.id === attr.value);
      if (!param) continue;
      const designValue = values[param.variable] ?? param.default;
      for (const component of specification.components) {
        const mate = component.interfaceFeatures.find(
          (f) => f.id === feature.matesWith,
        );
        if (!mate) continue;
        const measured = featureValue(mate, attr.definitionId);
        if (measured === undefined) continue;
        const rule =
          feature.clearanceRule === 'none'
            ? mate.clearanceRule
            : feature.clearanceRule;
        pairs.push({
          designFeature: feature.id,
          componentFeature: mate.id,
          attributeId: attr.definitionId,
          designValue,
          measured,
          rule,
        });
        const needed =
          rule === 'minus' ? measured - clearanceMm : measured + clearanceMm;
        const ok =
          rule === 'minus'
            ? designValue <= needed + 1e-6
            : designValue >= needed - 1e-6;
        if (!ok) {
          problems.push(
            `${feature.id} is ${designValue} mm but ${mate.id} measures ${measured} mm with ${clearanceMm} mm clearance, so it needs ${rule === 'minus' ? 'at most' : 'at least'} ${needed.toFixed(2)} mm.`,
          );
          revisions.push(`Set ${param.id} to ${needed.toFixed(2)}.`);
        }
      }
    }
  }

  const inputsUsed = { clearanceMm, pairs };
  if (pairs.length === 0) {
    return {
      result: 'warn',
      finding:
        'No mating feature pair was found between the design and the measured components, so no fit was checked.',
      inputsUsed,
    };
  }
  if (problems.length > 0) {
    return {
      result: 'fail',
      finding: problems.join(' '),
      suggestedRevision: revisions.join(' '),
      inputsUsed,
    };
  }
  return {
    result: 'pass',
    finding: `${pairs.length} mating feature pair${pairs.length === 1 ? '' : 's'} fit with ${clearanceMm} mm clearance.`,
    inputsUsed,
  };
};
