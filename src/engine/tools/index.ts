import { z } from 'zod';
import { loadLibrary, type LibraryIndex } from '@shared/library/loader';
import { validateOverrides } from '@shared/library/overrides';
import { specificationSchema } from '@shared/schemas/library';
import { parameterLimits } from '@/server/verification/checks/parameterLimits';
import { meshValidity } from '@/server/verification/checks/meshValidity';
import { fitClearance } from '@/server/verification/checks/fitClearance';
import { holeAlignment } from '@/server/verification/checks/holeAlignment';
import { printableSize } from '@/server/verification/checks/printableSize';
import { cadam } from './cadam';
import { listTools, registerTool } from './registry';

// The default tool set (issue #12). Registered once per process; every agent picks by name.

let index: LibraryIndex | null = null;
export function library(): LibraryIndex {
  index ??= loadLibrary('library');
  return index;
}

const designId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const overrides = z.record(z.string(), z.number());

function designOrThrow(id: string) {
  const d = library().designs.find((x) => x.id === id);
  if (!d) throw new Error(`no library design "${id}"`);
  return d;
}

export function registerDefaultTools(): void {
  if (listTools().some((t) => t.name === 'library_index')) return;

  registerTool({
    name: 'library_index',
    description:
      'Lists every library design: id, name, description, part class, evidence level, keywords, and the attribute ids its parameters use.',
    input: z.object({}).strict(),
    run: () =>
      library().designs.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        partClass: d.partClass,
        evidenceLevel: d.evidenceLevel,
        source: d.source,
        keywords: d.keywords,
        attributeIds: [...new Set(d.parameters.map((p) => p.attributeId))],
      })),
  });

  registerTool({
    name: 'library_design',
    description:
      'Returns one library design in full: parameters with limits, interface features, licence. Never returns the OpenSCAD source.',
    input: z.object({ designId }).strict(),
    run: ({ designId: id }) => {
      const { scad: _scad, ...entry } = designOrThrow(id);
      return entry;
    },
  });

  registerTool({
    name: 'catalogue',
    description:
      'Lists the purchased-part catalogue: id, label, measured attributes, interface features, and whether NopSCADlib geometry exists for it.',
    input: z.object({ query: z.string().optional() }).strict(),
    run: ({ query }) => {
      const q = query?.toLowerCase();
      return library()
        .components.filter(
          (c) =>
            !q ||
            c.label.toLowerCase().includes(q) ||
            c.keywords.some((k) => k.includes(q)),
        )
        .map((c) => ({
          id: c.id,
          label: c.label,
          attributes: c.attributes,
          interfaceFeatures: c.interfaceFeatures,
          geometry: c.geometrySource
            ? `${c.geometrySource.tier} ${c.geometrySource.module}`
            : 'none',
        }));
    },
  });

  registerTool({
    name: 'nopscadlib_modules',
    description:
      'Lists the NopSCADlib vitamin modules available for purchased-part geometry.',
    input: z.object({}).strict(),
    run: () => library().nopscadlibModules,
  });

  registerTool({
    name: 'materials',
    description:
      'Lists printable materials with default clearance, minimum wall, contact suitability, and service temperature.',
    input: z.object({ materialId: z.string().optional() }).strict(),
    run: ({ materialId }) =>
      library().materials.filter((m) => !materialId || m.id === materialId),
  });

  registerTool({
    name: 'attributes',
    description:
      'Lists the attribute definitions (id, name, unit, range) that measurements use.',
    input: z.object({}).strict(),
    run: () => library().attributes,
  });

  registerTool({
    name: 'unit_convert',
    description: 'Converts a length to millimetres from mm, cm, m, in, or ft.',
    input: z
      .object({
        value: z.number().finite(),
        unit: z.enum(['mm', 'cm', 'm', 'in', 'ft']),
      })
      .strict(),
    run: ({ value, unit }) => ({
      mm: value * { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }[unit],
    }),
  });

  registerTool({
    name: 'validate_overrides',
    description:
      'Checks a set of parameter values against a library design: declared names, limits, constraints. Returns the accepted values or the violations.',
    input: z.object({ designId, values: overrides }).strict(),
    run: ({ designId: id, values }) =>
      validateOverrides(designOrThrow(id), values),
  });

  registerTool({
    name: 'cadam_render',
    description:
      'Renders a library design with validated parameter overrides through CADAM and returns the mesh summary: triangle count, size in mm, open edges, exit code, render time.',
    input: z.object({ designId, values: overrides }).strict(),
    run: async ({ designId: id, values }) => {
      const design = designOrThrow(id);
      const check = validateOverrides(design, values);
      if (!check.ok) return { rejected: check.violations };
      const r = await cadam().render(design.scad, check.values);
      return {
        exitCode: r.exitCode,
        ms: r.ms,
        summary: r.summary,
        log: r.log.split('\n').slice(-5).join('\n'),
      };
    },
  });

  registerTool({
    name: 'cadam_render_code',
    description:
      'Renders OpenSCAD text (for example a generated design) through CADAM at its defaults and returns the mesh summary.',
    input: z.object({ scad: z.string().min(20).max(200_000) }).strict(),
    run: async ({ scad }) => {
      const r = await cadam().render(scad, {});
      return {
        exitCode: r.exitCode,
        ms: r.ms,
        summary: r.summary,
        log: r.log.split('\n').slice(-5).join('\n'),
      };
    },
  });

  registerTool({
    name: 'cadam_parameters',
    description:
      'Extracts the Customizer parameters (name, default, range) from OpenSCAD text through CADAM.',
    input: z.object({ scad: z.string().min(1).max(200_000) }).strict(),
    run: ({ scad }) =>
      cadam()
        .parameters(scad)
        .map((p) => ({
          name: p.name,
          defaultValue: p.defaultValue,
          type: p.type,
          range: p.range,
        })),
  });

  // The existing checks as tools. Each takes the design id, the accepted values, the
  // specification, and (where needed) a mesh summary the agent obtained from a render.
  const meshSummary = z
    .object({
      triangles: z.number(),
      min: z.tuple([z.number(), z.number(), z.number()]),
      max: z.tuple([z.number(), z.number(), z.number()]),
      size: z.tuple([z.number(), z.number(), z.number()]),
      openEdges: z.number(),
    })
    .strict();
  const checkInput = z
    .object({
      designId,
      values: overrides,
      specification: specificationSchema,
      mesh: meshSummary.optional(),
      renderExitCode: z.number().optional(),
      buildVolume: z.tuple([z.number(), z.number(), z.number()]).optional(),
    })
    .strict();
  const asCheckTool = (
    name: string,
    description: string,
    run: typeof parameterLimits,
  ) =>
    registerTool({
      name,
      description,
      input: checkInput,
      run: (i) =>
        run({
          design: designOrThrow(i.designId),
          values: i.values,
          specification: i.specification,
          mesh: i.mesh,
          renderExitCode: i.renderExitCode,
          buildVolume: i.buildVolume,
        }),
    });
  asCheckTool(
    'check_parameter_limits',
    'Confirms every value sits inside its declared limits and constraints.',
    parameterLimits,
  );
  asCheckTool(
    'check_mesh_validity',
    'Confirms the render succeeded, the mesh is closed, and it fits the build volume when given.',
    meshValidity,
  );
  asCheckTool(
    'check_fit_clearance',
    'Compares each mating feature pair against the measured hardware plus clearance.',
    fitClearance,
  );
  asCheckTool(
    'check_hole_alignment',
    'Compares design hole and opening positions with the measured component features.',
    holeAlignment,
  );
  asCheckTool(
    'check_printable_size',
    'Warns when the largest dimension exceeds a common printer bed.',
    printableSize,
  );
}
