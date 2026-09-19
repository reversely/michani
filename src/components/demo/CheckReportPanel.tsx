import { Button } from '@/components/ui/button';
import type { ReportRecord } from '@/server/report/build';

// Renders the check report (PRD R12) and offers the package download. All text is rendered
// as plain React children, so model findings never reach innerHTML.
type Props = {
  report: ReportRecord;
  onDownload?: () => void;
  downloading?: boolean;
  downloadReady: boolean;
};

export function CheckReportPanel({
  report,
  onDownload,
  downloading,
  downloadReady,
}: Props) {
  return (
    <section
      aria-label="Check report"
      className="flex flex-col gap-4 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 text-adam-text-primary sm:p-6"
    >
      <h2 className="text-base font-semibold">Check report</h2>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-adam-neutral-300">Design</dt>
        <dd>
          {report.design.name} (class {report.design.partClass},{' '}
          {report.design.source})
        </dd>
        <dt className="text-adam-neutral-300">Risk label</dt>
        <dd>{report.design.riskLabel}</dd>
        <dt className="text-adam-neutral-300">Evidence level</dt>
        <dd>{report.design.evidenceLevel}</dd>
        <dt className="text-adam-neutral-300">Clearance</dt>
        <dd>
          {report.clearance
            ? `${report.clearance.value} mm${report.clearance.source === 'computed' ? ' (default, no value in the request)' : ''}`
            : 'none recorded'}
        </dd>
        <dt className="text-adam-neutral-300">Attempts</dt>
        <dd>{report.attempts}</dd>
      </dl>

      {report.components.length > 0 && (
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">Components</h3>
          <ul className="list-disc pl-5">
            {report.components.map((c) => (
              <li key={c.id}>
                {c.label}: {c.geometrySource}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="text-adam-neutral-300">
              <th className="py-1 pr-3">Check</th>
              <th className="py-1 pr-3">Result</th>
              <th className="py-1">Finding</th>
            </tr>
          </thead>
          <tbody>
            {report.checks.map((c) => (
              <tr key={c.checkId} className="align-top">
                <td className="py-1 pr-3">{c.checkId}</td>
                <td className="py-1 pr-3">{c.result}</td>
                <td className="py-1">
                  {c.finding}
                  {c.suggestedRevision
                    ? ` Suggested revision: ${c.suggestedRevision}`
                    : ''}
                </td>
              </tr>
            ))}
            {report.didNotRun.map((d) => (
              <tr key={d.checkId} className="align-top text-adam-neutral-400">
                <td className="py-1 pr-3">{d.checkId}</td>
                <td className="py-1 pr-3">did not run</td>
                <td className="py-1">{d.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-adam-neutral-300">
        {report.loadCheckStatement}
      </p>

      <div className="flex flex-col gap-1 text-xs text-adam-neutral-400">
        {report.attributions.map((a, i) => (
          <p key={i}>{a}</p>
        ))}
      </div>

      {onDownload && (
        <Button
          type="button"
          onClick={onDownload}
          disabled={!downloadReady || downloading}
          className="w-full sm:w-auto"
        >
          {downloading
            ? 'Building the package'
            : downloadReady
              ? 'Download package (STL, SCAD, report)'
              : 'Waiting for the preview to compile'}
        </Button>
      )}
    </section>
  );
}
