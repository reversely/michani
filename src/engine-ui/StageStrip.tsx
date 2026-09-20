import { useState } from 'react';

// The stages of a part and what the engine is doing right now (issue #27). The strip lights
// the current stage; below it, the latest detail, the views of the build in flight, and the
// exact prompt CADAM received. Every string renders as plain text.

export type ProgressView = { label: string; pngBase64: string };
export type ProgressEvent = {
  at: string;
  stage: 'plan' | 'generate' | 'draft' | 'verify' | 'done';
  detail: string;
  attempt?: number;
  build?: number;
  agentId?: string;
  prompt?: { system: string; user: string };
  views?: ProgressView[];
};

export type Stage = 'gather' | 'plan' | 'build' | 'verify' | 'done';
const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'gather', label: 'Gather' },
  { id: 'plan', label: 'Plan' },
  { id: 'build', label: 'Generate' },
  { id: 'verify', label: 'Verify' },
  { id: 'done', label: 'Done' },
];

export function stageOfState(state: string): Stage {
  if (state === 'gathering') return 'gather';
  if (state === 'specified' || state === 'planned') return 'plan';
  if (state === 'confirmed') return 'build';
  return 'done';
}

export function stageOfEvent(e: ProgressEvent): Stage {
  if (e.stage === 'generate' || e.stage === 'draft') return 'build';
  return e.stage;
}

export function StageStrip({
  stage,
  busy,
  latest,
  failed,
}: {
  stage: Stage;
  busy: boolean;
  latest?: ProgressEvent;
  failed?: boolean;
}) {
  const index = STAGES.findIndex((s) => s.id === stage);
  const detail = latest
    ? [
        latest.attempt ? `attempt ${latest.attempt}` : '',
        latest.build ? `build ${latest.build}` : '',
        latest.detail,
      ]
        .filter(Boolean)
        .join(', ')
    : busy
      ? 'working'
      : '';
  return (
    <div aria-label="Progress" role="status" className="text-xs">
      <ol className="flex flex-wrap items-center gap-1">
        {STAGES.map((s, i) => {
          const state = i < index ? 'past' : i === index ? 'current' : 'ahead';
          const colour =
            state === 'current'
              ? failed && s.id === 'done'
                ? 'var(--fail)'
                : 'var(--accent)'
              : state === 'past'
                ? 'var(--ink-dim)'
                : 'var(--ink-meta)';
          return (
            <li key={s.id} className="flex items-center gap-1">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={`rounded px-2 py-0.5 ${state === 'current' ? 'font-semibold' : ''} ${state === 'current' && busy ? 'ws-pulse' : ''}`}
                style={{
                  color: state === 'current' ? 'var(--accent-ink)' : colour,
                  background:
                    state === 'current'
                      ? failed && s.id === 'done'
                        ? 'var(--fail)'
                        : 'var(--accent)'
                      : 'transparent',
                }}
              >
                {s.label}
              </span>
              {i < STAGES.length - 1 && (
                <span aria-hidden style={{ color: 'var(--line)' }}>
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {detail && (
        <p className="mt-1 px-2" style={{ color: 'var(--ink-dim)' }}>
          {detail}
        </p>
      )}
    </div>
  );
}

export function BuildViews({
  views,
  caption,
}: {
  views: ProgressView[];
  caption: string;
}) {
  if (views.length === 0) return null;
  return (
    <figure className="ws-enter">
      <div className="grid grid-cols-2 gap-2">
        {views.map((v) => (
          <img
            key={v.label}
            src={`data:image/png;base64,${v.pngBase64}`}
            alt={`Rendered view: ${v.label}`}
            className="w-full rounded-md"
            style={{ border: '1px solid var(--line)' }}
          />
        ))}
      </div>
      <figcaption className="mt-1 text-xs" style={{ color: 'var(--ink-meta)' }}>
        {caption}
      </figcaption>
    </figure>
  );
}

export function PromptReference({
  prompt,
}: {
  prompt: { system: string; user: string };
}) {
  // The panes exist only while open, so a closed reference has no boxes on the page.
  const [open, setOpen] = useState(false);
  return (
    <details
      className="text-xs"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer" style={{ color: 'var(--ink-dim)' }}>
        Prompt sent to CADAM ({prompt.system.length + prompt.user.length}{' '}
        characters)
      </summary>
      {open &&
        (['system', 'user'] as const).map((part) => (
          <div key={part}>
            <p
              className="mt-2 font-semibold"
              style={{ color: 'var(--ink-meta)' }}
            >
              {part === 'system' ? 'System' : 'User'}
            </p>
            <pre
              className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md p-2"
              style={{
                background: 'var(--surface-2)',
                color: 'var(--ink-dim)',
              }}
            >
              {prompt[part]}
            </pre>
          </div>
        ))}
    </details>
  );
}
