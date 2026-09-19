import type { ReportRecord } from '@/server/report/build';

// The download package (PRD R11): the STL, the OpenSCAD file with the chosen values, the
// component list, the two report files, and the licences. Pure file assembly here; the zip
// itself is produced in the browser by `zipPackage`.

export type PackageFile = { name: string; content: string | Uint8Array };

export const PACKAGE_FILE_NAMES = [
  'part.stl',
  'design.scad',
  'components.json',
  'report.json',
  'report.md',
  'LICENCE.txt',
] as const;

// The library file with the chosen values assigned in a header. OpenSCAD resolves a top-level
// variable to its last assignment, so a header alone would lose to the body's defaults; the
// header therefore sits first and the body's own assignments are commented out for exactly the
// overridden names, which is the only edit made to the file. Every other line is untouched.
export function scadWithOverrides(
  scad: string,
  values: Record<string, number>,
): string {
  const names = new Set(Object.keys(values));
  const body = scad
    .split('\n')
    .map((line) => {
      const m = /^([A-Za-z_$][A-Za-z0-9_]*)\s*=/.exec(line);
      return m && names.has(m[1])
        ? `// (default replaced above) ${line}`
        : line;
    })
    .join('\n');
  const header = [
    '// Parameter values chosen by the michani demo. The library file follows with its',
    '// default assignments for these names commented out; nothing else is changed.',
    ...Object.entries(values).map(([k, v]) => `${k} = ${v};`),
    '',
  ].join('\n');
  return header + body;
}

export function buildPackageFiles(input: {
  stl: Uint8Array;
  scad: string;
  values: Record<string, number>;
  report: ReportRecord;
  reportMarkdown: string;
}): PackageFile[] {
  const components = input.report.components.map((c) => ({
    id: c.id,
    label: c.label,
    geometrySource: c.geometrySource,
  }));
  const licence = [
    `Licence and attribution for ${input.report.design.name}`,
    '',
    ...input.report.attributions,
    '',
    input.report.loadCheckStatement,
    '',
  ].join('\n');
  return [
    { name: 'part.stl', content: input.stl },
    {
      name: 'design.scad',
      content: scadWithOverrides(input.scad, input.values),
    },
    {
      name: 'components.json',
      content: JSON.stringify(components, null, 2) + '\n',
    },
    {
      name: 'report.json',
      content: JSON.stringify(input.report, null, 2) + '\n',
    },
    { name: 'report.md', content: input.reportMarkdown },
    { name: 'LICENCE.txt', content: licence },
  ];
}

export async function zipPackage(files: PackageFile[]): Promise<Blob> {
  const { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } = await import(
    '@zip.js/zip.js'
  );
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const f of files) {
    await writer.add(
      f.name,
      typeof f.content === 'string'
        ? new TextReader(f.content)
        : new Uint8ArrayReader(f.content),
    );
  }
  return writer.close();
}
