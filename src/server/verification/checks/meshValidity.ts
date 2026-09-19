import type { CheckDefinition } from '@shared/schemas/library';
import type { CheckImplementation } from '../registry';

// The render succeeded, the mesh is closed, and the bounding box fits the build volume when
// the user supplied one.
export const meshValidityDefinition: CheckDefinition = {
  id: 'mesh-validity',
  name: 'Mesh validity',
  partClasses: ['A', 'B', 'C'],
  inputs: ['mesh', 'buildVolume'],
};

export const meshValidity: CheckImplementation = ({
  mesh,
  renderExitCode,
  renderLog,
  buildVolume,
}) => {
  const inputsUsed = {
    renderExitCode,
    triangles: mesh?.triangles,
    size: mesh?.size,
    openEdges: mesh?.openEdges,
    buildVolume,
  };
  if (renderExitCode !== 0 || !mesh) {
    const tail = (renderLog ?? '')
      .split('\n')
      .filter(Boolean)
      .slice(-3)
      .join(' ');
    return {
      result: 'fail',
      finding:
        `The render did not produce a mesh (exit code ${renderExitCode ?? 'none'}). ${tail}`.trim(),
      suggestedRevision:
        'Choose values that produce solid geometry; check the log for the failing operation.',
      inputsUsed,
    };
  }
  if (mesh.triangles === 0) {
    return {
      result: 'fail',
      finding: 'The render produced an empty mesh.',
      suggestedRevision:
        'Choose values that leave solid material; a wall or arm thickness may be zero.',
      inputsUsed,
    };
  }
  if (mesh.openEdges > 0) {
    return {
      result: 'fail',
      finding: `The mesh has ${mesh.openEdges} open edges and is not watertight.`,
      suggestedRevision:
        'Adjust values so that all features overlap into one solid; a thin gap between features often causes this.',
      inputsUsed,
    };
  }
  if (buildVolume) {
    const sorted = [...mesh.size].sort((a, b) => b - a);
    const volumeSorted = [...buildVolume].sort((a, b) => b - a);
    const fits = sorted.every((s, i) => s <= volumeSorted[i] + 1e-6);
    if (!fits) {
      return {
        result: 'fail',
        finding: `The part measures ${mesh.size.map((v) => v.toFixed(1)).join(' x ')} mm and does not fit the build volume ${buildVolume.join(' x ')} mm.`,
        suggestedRevision: 'Reduce the largest dimension or split the part.',
        inputsUsed,
      };
    }
  }
  return {
    result: 'pass',
    finding: `Closed mesh with ${mesh.triangles} triangles, ${mesh.size.map((v) => v.toFixed(1)).join(' x ')} mm.`,
    inputsUsed,
  };
};
