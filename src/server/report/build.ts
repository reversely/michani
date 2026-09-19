import type {
  CheckResult,
  DesignEntry,
  Plan,
  Specification,
} from '@shared/schemas/library';
import type { VerificationReport } from '@/server/verification/run';

// The check report (PRD R11, R12): one JSON record and one Markdown rendering of it. Both are
// built from validated CheckResult and DesignEntry records. Every model-produced string is
// escaped before it enters the Markdown so a finding cannot inject formatting or links.

export type ReportComponent = {
  id: string;
  label: string;
  geometrySource: string;
};

export type ReportRecord = {
  generatedAt: string;
  design: {
    id: string;
    name: string;
    source: DesignEntry['source'];
    partClass: DesignEntry['partClass'];
    riskLabel: DesignEntry['riskLabel'];
    evidenceLevel: DesignEntry['evidenceLevel'];
    licence: string;
    attribution: string;
  };
  plan: { function: Plan['function']; reason: string; confirmed: boolean };
  values: Record<string, number>;
  requirements: string[];
  clearance: { value: number; source: string } | null;
  components: ReportComponent[];
  checks: Array<{
    checkId: string;
    result: CheckResult['result'];
    finding: string;
    suggestedRevision?: string;
  }>;
  didNotRun: Array<{ checkId: string; name: string; reason: string }>;
  loadCheckStatement: string;
  attempts: number;
  attributions: string[];
};

export const NOPSCADLIB_ATTRIBUTION =
  'NopSCADlib by nophead, GPL-3.0, https://github.com/nophead/NopSCADlib (purchased-part geometry in the preview).';

export const NO_LOAD_CHECK_STATEMENT =
  'No load, strength, or fatigue check ran. The checks above cover parameter limits, mesh validity, fit, alignment, and requirement coverage only.';

export function buildReport(input: {
  design: DesignEntry;
  specification: Specification;
  plan: Plan;
  values: Record<string, number>;
  report: VerificationReport;
  attempts: number;
  generatedAt?: Date;
}): ReportRecord {
  const { design, specification, plan, report } = input;
  const clearanceValue = specification.printSettings.find(
    (v) => v.definitionId === 'clearance',
  );
  const components: ReportComponent[] = specification.components.map((c) => ({
    id: c.id,
    label: c.label,
    geometrySource: c.geometrySource
      ? `${c.geometrySource.tier} ${c.geometrySource.module} (${c.geometrySource.licence}, evidence level ${c.geometrySource.evidenceLevel})`
      : 'measurements only, no geometry modelled',
  }));
  const attributions = [
    `${design.name}: ${design.licence}. ${design.attribution}`,
  ];
  if (
    specification.components.some(
      (c) => c.geometrySource?.tier === 'nopscadlib',
    )
  ) {
    attributions.push(NOPSCADLIB_ATTRIBUTION);
  }
  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    design: {
      id: design.id,
      name: design.name,
      source: design.source,
      partClass: design.partClass,
      riskLabel: design.riskLabel,
      evidenceLevel:
        design.source === 'generated' ? 'untested' : design.evidenceLevel,
      licence: design.licence,
      attribution: design.attribution,
    },
    plan: {
      function: plan.function,
      reason: plan.reason,
      confirmed: plan.confirmed,
    },
    values: input.values,
    requirements: specification.requirements,
    clearance:
      clearanceValue && typeof clearanceValue.value === 'number'
        ? { value: clearanceValue.value, source: clearanceValue.source }
        : null,
    components,
    checks: report.results.map((r) => ({
      checkId: r.checkId,
      result: r.result,
      finding: r.finding,
      ...(r.suggestedRevision
        ? { suggestedRevision: r.suggestedRevision }
        : {}),
    })),
    didNotRun: report.didNotRun,
    loadCheckStatement: NO_LOAD_CHECK_STATEMENT,
    attempts: input.attempts,
    attributions,
  };
}

// Escapes Markdown control characters in text the model or the user wrote, so it renders as
// plain words. Pipes are escaped too because findings sit inside a table.
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]()#|<>]/g, (c) => `\\${c}`)
    .replace(/\r?\n/g, ' ');
}

export function renderMarkdown(record: ReportRecord): string {
  const e = escapeMarkdown;
  const lines: string[] = [];
  lines.push(`# Check report: ${e(record.design.name)}`, '');
  lines.push(`Generated ${record.generatedAt}.`, '');
  lines.push('## Design', '');
  lines.push('| Field | Value |', '| --- | --- |');
  lines.push(`| Design | ${e(record.design.id)} (${e(record.design.name)}) |`);
  lines.push(`| Source | ${e(record.design.source)} |`);
  lines.push(`| Part class | ${e(record.design.partClass)} |`);
  lines.push(`| Risk label | ${e(record.design.riskLabel)} |`);
  lines.push(`| Evidence level | ${e(record.design.evidenceLevel)} |`);
  lines.push(
    `| Plan | ${e(record.plan.function)}, confirmed: ${record.plan.confirmed ? 'yes' : 'no'} |`,
  );
  lines.push(`| Attempts | ${record.attempts} |`, '');
  lines.push('## Requirements', '');
  for (const r of record.requirements) lines.push(`- ${e(r)}`);
  lines.push('');
  lines.push('## Parameter values', '');
  lines.push('| Variable | Value |', '| --- | --- |');
  for (const [k, v] of Object.entries(record.values))
    lines.push(`| ${e(k)} | ${v} |`);
  lines.push('');
  lines.push('## Print settings', '');
  lines.push(
    record.clearance
      ? `Clearance ${record.clearance.value} mm${record.clearance.source === 'computed' ? ' (default applied by the requirements step because the request gave none)' : ` (${e(record.clearance.source)})`}.`
      : 'No clearance value recorded.',
    '',
  );
  lines.push('## Components', '');
  if (record.components.length === 0)
    lines.push('No purchased components.', '');
  else {
    lines.push('| Component | Geometry source |', '| --- | --- |');
    for (const c of record.components)
      lines.push(`| ${e(c.label)} | ${e(c.geometrySource)} |`);
    lines.push('');
  }
  lines.push('## Checks', '');
  lines.push(
    '| Check | Result | Finding | Suggested revision |',
    '| --- | --- | --- | --- |',
  );
  for (const c of record.checks) {
    lines.push(
      `| ${e(c.checkId)} | ${c.result} | ${e(c.finding)} | ${c.suggestedRevision ? e(c.suggestedRevision) : ''} |`,
    );
  }
  for (const d of record.didNotRun)
    lines.push(`| ${e(d.checkId)} | did not run | ${e(d.reason)} | |`);
  lines.push('');
  lines.push(`${e(record.loadCheckStatement)}`, '');
  lines.push('## Licence and attribution', '');
  for (const a of record.attributions) lines.push(`- ${e(a)}`);
  lines.push('');
  return lines.join('\n');
}
