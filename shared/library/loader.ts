import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import parseParameters from '../parseParameters';
import {
  attributeDefinitionSchema,
  componentRecordSchema,
  designEntrySchema,
  evidenceLevelSchema,
  materialSchema,
  type AttributeDefinition,
  type Material,
  type ComponentRecord,
  type DesignEntry,
} from '../schemas/library';

export type LibraryIndex = {
  attributes: AttributeDefinition[];
  evidenceLevels: string[];
  materials: Material[];
  designs: Array<DesignEntry & { scad: string }>;
  components: ComponentRecord[];
  nopscadlibModules: string[];
};

export class LibraryLoadError extends Error {
  constructor(public readonly problems: string[]) {
    super(`library failed to load:\n${problems.join('\n')}`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Loads and validates every record under `root`. Throws LibraryLoadError listing every problem
// found, so a developer fixes them in one pass instead of one restart at a time.
export function loadLibrary(root = 'library'): LibraryIndex {
  const problems: string[] = [];

  const attributes = parseList(
    readJson(join(root, 'attributes.json')),
    attributeDefinitionSchema,
    'attributes.json',
    problems,
  );
  const attributeIds = new Set(attributes.map((a) => a.id));

  const evidenceLevels = parseList(
    readJson(join(root, 'evidence-levels.json')),
    evidenceLevelSchema,
    'evidence-levels.json',
    problems,
  );

  const materialsPath = join(root, 'materials.json');
  const materials = existsSync(materialsPath)
    ? parseList(
        readJson(materialsPath),
        materialSchema,
        'materials.json',
        problems,
      )
    : [];

  const modulesPath = join(root, 'nopscadlib-modules.json');
  const nopscadlibModules = existsSync(modulesPath)
    ? ((readJson(modulesPath) as { modules: string[] }).modules ?? [])
    : [];
  const moduleSet = new Set(nopscadlibModules);

  const designs: LibraryIndex['designs'] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'components') continue;
    const dir = join(root, entry.name);
    const metaPath = join(dir, 'design.json');
    if (!existsSync(metaPath)) continue;
    const parsed = designEntrySchema.safeParse(readJson(metaPath));
    if (!parsed.success) {
      problems.push(`${metaPath}: ${formatIssues(parsed.error.issues)}`);
      continue;
    }
    const design = parsed.data;
    if (design.id !== entry.name) {
      problems.push(
        `${metaPath}: id "${design.id}" does not match folder "${entry.name}"`,
      );
    }
    const scadPath = join(dir, design.file);
    if (!existsSync(scadPath)) {
      problems.push(`${metaPath}: file "${design.file}" not found`);
      continue;
    }
    const scad = readFileSync(scadPath, 'utf8');
    checkParametersAgainstScad(design, scad, attributeIds, problems, metaPath);
    designs.push({ ...design, scad });
  }

  const components: ComponentRecord[] = [];
  const componentsDir = join(root, 'components');
  if (existsSync(componentsDir)) {
    for (const file of readdirSync(componentsDir).filter((f) =>
      f.endsWith('.json'),
    )) {
      const path = join(componentsDir, file);
      const parsed = componentRecordSchema.safeParse(readJson(path));
      if (!parsed.success) {
        problems.push(`${path}: ${formatIssues(parsed.error.issues)}`);
        continue;
      }
      const component = parsed.data;
      for (const value of component.attributes) {
        if (!attributeIds.has(value.definitionId)) {
          problems.push(`${path}: unknown attribute "${value.definitionId}"`);
        }
      }
      const source = component.geometrySource;
      if (source && !moduleSet.has(source.module)) {
        problems.push(
          `${path}: NopSCADlib module "${source.module}" is not in nopscadlib-modules.json`,
        );
      }
      components.push(component);
    }
  }

  if (problems.length > 0) throw new LibraryLoadError(problems);
  return {
    attributes,
    evidenceLevels,
    materials,
    designs,
    components,
    nopscadlibModules,
  };
}

// The Customizer parser is what the sliders and the drafting agent see, so the metadata must
// agree with it: every declared parameter exists as a top-level variable, and its default and
// range match the file's own comment.
function checkParametersAgainstScad(
  design: DesignEntry,
  scad: string,
  attributeIds: Set<string>,
  problems: string[],
  where: string,
) {
  const parsed = new Map(parseParameters(scad).map((p) => [p.name, p]));
  const seen = new Set<string>();
  for (const param of design.parameters) {
    if (seen.has(param.id))
      problems.push(`${where}: duplicate parameter id "${param.id}"`);
    seen.add(param.id);
    if (!attributeIds.has(param.attributeId)) {
      problems.push(
        `${where}: parameter "${param.id}" names unknown attribute "${param.attributeId}"`,
      );
    }
    const inFile = parsed.get(param.variable);
    if (!inFile) {
      problems.push(
        `${where}: variable "${param.variable}" is not a top-level parameter in ${design.file}`,
      );
      continue;
    }
    if (inFile.defaultValue !== param.default) {
      problems.push(
        `${where}: "${param.variable}" default ${param.default} disagrees with file default ${String(inFile.defaultValue)}`,
      );
    }
    if (inFile.range?.min !== undefined && inFile.range.min !== param.min) {
      problems.push(
        `${where}: "${param.variable}" min ${param.min} disagrees with file range ${inFile.range.min}`,
      );
    }
    if (inFile.range?.max !== undefined && inFile.range.max !== param.max) {
      problems.push(
        `${where}: "${param.variable}" max ${param.max} disagrees with file range ${inFile.range.max}`,
      );
    }
  }
}

function parseList<T>(
  raw: unknown,
  schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
  },
  where: string,
  problems: string[],
): T[] {
  if (!Array.isArray(raw)) {
    problems.push(`${where}: expected an array`);
    return [];
  }
  const out: T[] = [];
  raw.forEach((item, i) => {
    const parsed = schema.safeParse(item);
    if (parsed.success && parsed.data !== undefined) out.push(parsed.data);
    else
      problems.push(
        `${where}[${i}]: ${formatIssues(parsed.error?.issues ?? [])}`,
      );
  });
  return out;
}

function formatIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
