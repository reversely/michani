// Loop visibility (PRD R14): every agent step and every check result as it completes, plus a
// gate refusal when one occurs. The demo page feeds it from step state; all text renders as
// plain React children.

export type LoopStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'refused';

export type LoopStepRow = {
  id: string;
  label: string;
  status: LoopStepStatus;
  detail?: string;
  elapsedMs?: number;
};

export type LoopCheckRow = {
  checkId: string;
  result: 'pass' | 'warn' | 'fail' | 'did not run';
  finding: string;
};

type Props = {
  steps: LoopStepRow[];
  checks: LoopCheckRow[];
  refusal?: string;
};

const STATUS_LABEL: Record<LoopStepStatus, string> = {
  pending: 'waiting',
  running: 'running',
  done: 'done',
  failed: 'failed',
  refused: 'refused',
};

export function LoopPanel({ steps, checks, refusal }: Props) {
  return (
    <aside
      aria-label="Loop progress"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 text-sm text-adam-text-primary sm:p-6"
    >
      <h2 className="text-base font-semibold">Loop progress</h2>
      <ol className="flex flex-col gap-1">
        {steps.map((s) => (
          <li key={s.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <span className="sm:w-40 sm:shrink-0">{s.label}</span>
            <span
              className={
                s.status === 'failed' || s.status === 'refused'
                  ? 'text-red-400'
                  : s.status === 'done'
                    ? 'text-adam-text-primary'
                    : 'text-adam-neutral-400'
              }
            >
              {STATUS_LABEL[s.status]}
              {s.elapsedMs !== undefined
                ? ` (${(s.elapsedMs / 1000).toFixed(1)} s)`
                : ''}
              {s.detail ? `: ${s.detail}` : ''}
            </span>
          </li>
        ))}
      </ol>
      {refusal && (
        <p role="alert" className="text-red-400">
          {refusal}
        </p>
      )}
      {checks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {checks.map((c) => (
            <li
              key={c.checkId}
              className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"
            >
              <span className="sm:w-40 sm:shrink-0">{c.checkId}</span>
              <span
                className={
                  c.result === 'fail'
                    ? 'text-red-400'
                    : c.result === 'did not run'
                      ? 'text-adam-neutral-400'
                      : ''
                }
              >
                {c.result}: {c.finding}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
