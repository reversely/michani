import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiJson } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import type { Parameter } from '@shared/types';

// The engine's conversation screen (issue #17): chat on the left, the specification, plan,
// progress, verdicts with evidence, and the preview on the right. No account, no database.
// Every string renders as plain text.

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  at: z.string(),
});
const verdictSchema = z.object({
  agentId: z.string(),
  result: z.enum(['pass', 'warn', 'fail']),
  finding: z.string(),
  suggestedRevision: z.string().optional(),
  evidence: z.array(
    z.object({ tool: z.string(), input: z.unknown(), output: z.unknown() }),
  ),
  steps: z.number(),
  ms: z.number(),
});
const sessionSchema = z.object({
  id: z.string(),
  state: z.string(),
  transcript: z.array(turnSchema),
  specification: z
    .object({
      purpose: z.string().optional(),
      dimensions: z.array(
        z.object({ name: z.string(), value: z.number(), unit: z.string() }),
      ),
      material: z.string().optional(),
      hardware: z.string().optional(),
      components: z.array(
        z.object({ id: z.string(), label: z.string() }).passthrough(),
      ),
      load: z.string().optional(),
      environment: z.string().optional(),
      contactClass: z.string().optional(),
      requirements: z.array(z.string()),
    })
    .passthrough(),
  plan: z
    .object({
      function: z.string(),
      candidateDesignId: z.string().optional(),
      generationBrief: z.string().optional(),
      reason: z.string(),
      confirmed: z.boolean(),
      riskLabel: z.string(),
    })
    .passthrough()
    .optional(),
  execution: z
    .object({
      ok: z.boolean(),
      function: z.string(),
      designId: z.string(),
      designName: z.string(),
      source: z.string(),
      evidenceLevel: z.string(),
      riskLabel: z.string(),
      values: z.record(z.number()),
      scad: z.string().optional(),
      attempts: z.array(
        z
          .object({
            attempt: z.number(),
            designId: z.string(),
            renderMs: z.number().optional(),
            ms: z.number(),
          })
          .passthrough(),
      ),
      verification: z
        .object({
          verdicts: z.array(verdictSchema),
          didNotRun: z.array(
            z.object({ agentId: z.string(), reason: z.string() }),
          ),
        })
        .optional(),
      message: z.string(),
    })
    .optional(),
});
type EngineSession = z.infer<typeof sessionSchema>;
const turnResponse = z.object({
  reply: z.string(),
  session: sessionSchema,
  elapsedMs: z.number(),
});

const FIELDS: Array<{
  label: string;
  get: (s: EngineSession['specification']) => string;
}> = [
  { label: 'Purpose', get: (s) => s.purpose ?? '' },
  {
    label: 'Dimensions',
    get: (s) =>
      s.dimensions.map((d) => `${d.name} ${d.value} ${d.unit}`).join(', '),
  },
  { label: 'Material', get: (s) => s.material ?? '' },
  {
    label: 'Hardware',
    get: (s) =>
      s.hardware === 'listed'
        ? s.components.map((c) => c.label).join(', ')
        : (s.hardware ?? ''),
  },
  { label: 'Load', get: (s) => s.load ?? '' },
  { label: 'Environment', get: (s) => s.environment ?? '' },
  { label: 'Contact', get: (s) => s.contactClass ?? '' },
];

export function EngineView() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [session, setSession] = useState<EngineSession>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [elapsed, setElapsed] = useState<number>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [session?.transcript.length, busy]);

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return;
      setBusy(true);
      setError(undefined);
      setDraft('');
      setSession(
        (s) =>
          s && {
            ...s,
            transcript: [
              ...s.transcript,
              { role: 'user', text, at: new Date().toISOString() },
            ],
          },
      );
      try {
        const r = turnResponse.parse(
          await apiJson('engine/turn', {
            method: 'POST',
            body: JSON.stringify({ sessionId, message: text }),
          }),
        );
        setSession(r.session);
        setElapsed(r.elapsedMs);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId],
  );

  const spec = session?.specification;
  const exec = session?.execution;
  const params: Parameter[] | undefined = exec?.ok
    ? Object.entries(exec.values).map(([name, value]) => ({
        name,
        displayName: name,
        value,
        defaultValue: value,
        type: 'number' as const,
      }))
    : undefined;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4 text-adam-text-primary lg:flex-row lg:overflow-hidden">
      <section
        aria-label="Conversation"
        className="flex min-h-[60vh] flex-1 flex-col rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 lg:h-full lg:min-h-0"
      >
        <h1 className="border-b border-adam-neutral-700 px-4 py-3 text-base font-semibold">
          Printed part from a conversation
        </h1>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3 text-sm">
          {!session && (
            <p className="text-adam-neutral-300">
              Describe the part you need. The assistant asks for what a
              specification still lacks, proposes a plan, and after you confirm
              it drafts, renders, and verifies the part.
            </p>
          )}
          {session?.transcript.map((t, i) => (
            <p
              key={i}
              className={
                t.role === 'user'
                  ? 'self-end rounded-md bg-adam-neutral-700 px-3 py-2'
                  : 'self-start rounded-md bg-adam-neutral-800 px-3 py-2'
              }
            >
              {t.text}
            </p>
          ))}
          {busy && (
            <p className="self-start px-3 py-2 text-adam-neutral-400">
              Working
            </p>
          )}
          {error && (
            <p role="alert" className="text-red-400">
              {error}
            </p>
          )}
          <div ref={endRef} />
        </div>
        <form
          className="flex flex-col gap-2 border-t border-adam-neutral-700 p-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor="engine-message" className="sr-only">
            Message
          </label>
          <Textarea
            id="engine-message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="flex-1"
            placeholder={
              session?.state === 'planned'
                ? 'Type yes to confirm the plan, or say what to change'
                : 'Describe the part'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || draft.trim().length === 0}>
              Send
            </Button>
            {session?.state === 'planned' && !busy && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void send('yes')}
              >
                Confirm plan
              </Button>
            )}
          </div>
          {elapsed !== undefined && (
            <span className="self-center text-xs text-adam-neutral-400">
              {(elapsed / 1000).toFixed(1)} s
            </span>
          )}
        </form>
      </section>

      <aside
        aria-label="Specification and results"
        className="flex w-full flex-col gap-4 overflow-y-auto lg:h-full lg:w-[28rem] lg:shrink-0"
      >
        <section className="rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 text-sm">
          <h2 className="mb-2 font-semibold">
            Specification{session ? ` (${session.state})` : ''}
          </h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
            {FIELDS.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-adam-neutral-300">{f.label}</dt>
                <dd
                  className={spec && f.get(spec) ? '' : 'text-adam-neutral-500'}
                >
                  {spec && f.get(spec) ? f.get(spec) : 'not yet stated'}
                </dd>
              </div>
            ))}
          </dl>
          {spec && spec.requirements.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {spec.requirements.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </section>

        {session?.plan && (
          <section className="rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 text-sm">
            <h2 className="mb-2 font-semibold">
              Plan{session.plan.confirmed ? ' (confirmed)' : ''}
            </h2>
            <p>
              {session.plan.function === 'adaptation'
                ? `Adapt library design "${session.plan.candidateDesignId}".`
                : 'Generate a new design.'}{' '}
              Risk label: {session.plan.riskLabel}.
            </p>
            <p className="text-adam-neutral-300">{session.plan.reason}</p>
          </section>
        )}

        {exec && (
          <section className="rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 text-sm">
            <h2 className="mb-2 font-semibold">Result</h2>
            <p>{exec.message}</p>
            <p className="text-adam-neutral-300">
              {exec.designName} ({exec.source}, evidence level{' '}
              {exec.evidenceLevel}, risk label {exec.riskLabel}),{' '}
              {exec.attempts.length} attempt
              {exec.attempts.length === 1 ? '' : 's'}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {exec.verification?.verdicts.map((v) => (
                <li key={v.agentId}>
                  <p
                    className={
                      v.result === 'fail'
                        ? 'text-red-400'
                        : v.result === 'warn'
                          ? 'text-amber-300'
                          : ''
                    }
                  >
                    {v.agentId}: {v.result}. {v.finding}
                    {v.suggestedRevision
                      ? ` Suggested revision: ${v.suggestedRevision}`
                      : ''}
                  </p>
                  <details className="text-xs text-adam-neutral-400">
                    <summary>
                      {v.evidence.length} tool call
                      {v.evidence.length === 1 ? '' : 's'} in {v.steps} steps
                    </summary>
                    <ul className="list-disc pl-5">
                      {v.evidence.map((ev, i) => (
                        <li key={i}>
                          {ev.tool}: {JSON.stringify(ev.output)?.slice(0, 240)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
              {exec.verification?.didNotRun.map((d) => (
                <li key={d.agentId} className="text-adam-neutral-400">
                  {d.agentId}: did not run, {d.reason}
                </li>
              ))}
            </ul>
          </section>
        )}

        {exec?.ok && exec.scad && params && (
          <section className="rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-2">
            <div className="h-[360px] w-full overflow-hidden rounded-md">
              <OpenSCADPreview
                scadCode={exec.scad}
                params={params}
                color="#4682B4"
              />
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
