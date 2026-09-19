import type {
  CheckDefinition,
  InterfaceFeature,
} from '@shared/schemas/library';
import type { CheckImplementation } from '../registry';

// Class C only: every design hole and opening whose mate is a measured component feature sits
// at the measured position. The design computes hole positions from its own parameters (inset
// from each board edge), so the check compares those computed positions with the component's
// measured feature positions. Where the component also carries a vitamin geometry source whose
// stored positions disagree with the measured ones, the result is warn naming both values.
export const holeAlignmentDefinition: CheckDefinition = {
  id: 'hole-alignment',
  name: 'Hole and opening alignment',
  partClasses: ['C'],
  inputs: ['parameters', 'design', 'specification'],
};

const TOLERANCE_MM = 0.25;

function paramValue(
  values: Record<string, number>,
  design: {
    parameters: Array<{ id: string; variable: string; default: number }>;
  },
  id: string,
): number | undefined {
  const p = design.parameters.find((x) => x.id === id);
  if (!p) return undefined;
  return values[p.variable] ?? p.default;
}

// Hole positions the design produces, mirroring the enclosure's hole_positions() module:
// inset from each corner of a board_length by board_width outline.
function designHolePositions(
  values: Record<string, number>,
  design: {
    parameters: Array<{ id: string; variable: string; default: number }>;
  },
): Array<[number, number]> | undefined {
  const length = paramValue(values, design, 'board-length');
  const width = paramValue(values, design, 'board-width');
  const inset = paramValue(values, design, 'hole-inset');
  if (length === undefined || width === undefined || inset === undefined)
    return undefined;
  return [
    [inset, inset],
    [length - inset, inset],
    [length - inset, width - inset],
    [inset, width - inset],
  ];
}

function nearest(
  point: [number, number],
  candidates: Array<[number, number]>,
): { distance: number; index: number } {
  let best = { distance: Infinity, index: -1 };
  candidates.forEach((c, i) => {
    const d = Math.hypot(c[0] - point[0], c[1] - point[1]);
    if (d < best.distance) best = { distance: d, index: i };
  });
  return best;
}

export const holeAlignment: CheckImplementation = ({
  design,
  specification,
  values,
}) => {
  const designHoles = designHolePositions(values, design);
  const measuredHoles: Array<{
    id: string;
    position: [number, number];
    component: string;
  }> = [];
  const vitaminNotes: string[] = [];
  let opening: { measured: number; designed: number } | undefined;

  for (const component of specification.components) {
    // Measured (user-sourced) hole features win; catalogue (library) positions only stand in
    // when the user measured none, and are compared against the measured ones below.
    const holes = component.interfaceFeatures.filter(
      (f) => f.featureType === 'hole' && f.position,
    );
    const userHoles = holes.filter((f) =>
      f.attributes.some((a) => a.source === 'user'),
    );
    for (const feature of userHoles.length > 0 ? userHoles : holes) {
      measuredHoles.push({
        id: feature.id,
        position: [feature.position![0], feature.position![1]],
        component: component.label,
      });
    }
    for (const feature of component.interfaceFeatures) {
      if (feature.featureType === 'opening' || feature.id === 'connector') {
        const offset = feature.attributes.find(
          (a) => a.definitionId === 'offset',
        )?.value;
        const designed = paramValue(values, design, 'opening-offset');
        if (typeof offset === 'number' && designed !== undefined)
          opening = { measured: offset, designed };
      }
    }
    // A vitamin-backed component may carry catalogue positions that disagree with what the
    // user measured; the measured values win and the disagreement is reported.
    if (
      component.geometrySource &&
      component.interfaceFeatures.some((f: InterfaceFeature) =>
        f.attributes.some((a) => a.source === 'user'),
      )
    ) {
      const libraryPositions = component.interfaceFeatures.filter(
        (f) =>
          f.featureType === 'hole' &&
          f.position &&
          f.attributes.every((a) => a.source === 'library'),
      );
      const userPositions = component.interfaceFeatures.filter(
        (f) =>
          f.featureType === 'hole' &&
          f.position &&
          f.attributes.some((a) => a.source === 'user'),
      );
      for (const u of userPositions) {
        const l = libraryPositions.find((x) => x.id === u.id);
        if (
          l &&
          l.position &&
          u.position &&
          (Math.abs(l.position[0] - u.position[0]) > TOLERANCE_MM ||
            Math.abs(l.position[1] - u.position[1]) > TOLERANCE_MM)
        ) {
          vitaminNotes.push(
            `${u.id}: measured (${u.position[0]}, ${u.position[1]}) mm, vitamin ${component.geometrySource.module} has (${l.position[0]}, ${l.position[1]}) mm`,
          );
        }
      }
    }
  }

  const inputsUsed = {
    designHoles,
    measuredHoles,
    opening,
    tolerance: TOLERANCE_MM,
  };
  if (!designHoles || measuredHoles.length === 0) {
    return {
      result: 'warn',
      finding:
        'No measured hole positions were supplied, so alignment was not checked.',
      inputsUsed,
    };
  }

  const problems: string[] = [];
  measuredHoles.forEach((hole, index) => {
    const { distance, index: designIndex } = nearest(
      hole.position,
      designHoles,
    );
    if (distance > TOLERANCE_MM) {
      problems.push(
        `hole ${index + 1} (${hole.id}) measured at (${hole.position[0]}, ${hole.position[1]}) mm is ${distance.toFixed(2)} mm from the nearest design hole ${designIndex + 1} at (${designHoles[designIndex][0]}, ${designHoles[designIndex][1]}) mm`,
      );
    }
  });
  if (opening && Math.abs(opening.measured - opening.designed) > TOLERANCE_MM) {
    problems.push(
      `the side opening is at ${opening.designed} mm but the connector is at ${opening.measured} mm`,
    );
  }

  if (problems.length > 0) {
    return {
      result: 'fail',
      finding: problems.join('; ') + '.',
      suggestedRevision:
        'Set hole-inset, board-length, board-width, and opening-offset to the measured values.',
      inputsUsed,
    };
  }
  if (vitaminNotes.length > 0) {
    return {
      result: 'warn',
      finding: `Holes align with the measured positions, but the vitamin disagrees: ${vitaminNotes.join('; ')}.`,
      inputsUsed,
    };
  }
  return {
    result: 'pass',
    finding: `${measuredHoles.length} holes${opening ? ' and the side opening' : ''} align with the measured positions within ${TOLERANCE_MM} mm.`,
    inputsUsed,
  };
};
