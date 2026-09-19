import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { apiJson } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MeasurementsPanel } from '@/components/demo/MeasurementsPanel';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { CheckReportPanel } from '@/components/demo/CheckReportPanel';
import {
  LoopPanel,
  type LoopCheckRow,
  type LoopStepRow,
} from '@/components/demo/LoopPanel';
import { buildPackageFiles, zipPackage } from '@/utils/packageUtils';
import type { ReportRecord } from '@/server/report/build';
import type { Parameter } from '@shared/types';
import {
  attributeDefinitionSchema,
  planSchema,
  specificationSchema,
  type AttributeDefinition,
  type Plan,
  type Specification,
} from '@shared/schemas/library';

// The demo route: one request, the requirements step, the measurements and plan panel, and
// the confirm action. Later checkpoints add the library, drafting, render, and report steps
// to this same page.

const libraryResponse = z.object({
  attributes: z.array(attributeDefinitionSchema),
});

const requirementsResponse = z.object({
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('question'),
      question: z.string(),
      missing: z.array(
        z.object({
          parameterId: z.string(),
          attributeId: z.string(),
          name: z.string(),
          unit: z.string(),
          reason: z.string(),
        }),
      ),
    }),
    z.object({
      kind: z.literal('specification'),
      specification: specificationSchema,
      plan: planSchema,
    }),
  ]),
  elapsedMs: z.number(),
});

const confirmResponse = z.object({ plan: planSchema });

const candidateSchema = z.object({
  designId: z.string(),
  name: z.string(),
  reason: z.string(),
  partClass: z.enum(['A', 'B', 'C']),
  evidenceLevel: z.string(),
});
const libraryStepResponse = z.object({
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('candidates'),
      candidates: z.array(candidateSchema),
      componentsWithoutGeometry: z.array(z.string()),
      stop: z.string().optional(),
    }),
    z.object({
      kind: z.literal('no-match'),
      message: z.string(),
      componentsWithoutGeometry: z.array(z.string()),
    }),
  ]),
  plan: planSchema,
  question: z
    .object({
      question: z.string(),
      missing: z.array(
        z.object({
          parameterId: z.string(),
          attributeId: z.string(),
          name: z.string(),
          unit: z.string(),
          reason: z.string(),
        }),
      ),
    })
    .optional(),
  elapsedMs: z.number(),
});
type LibraryStep = z.infer<typeof libraryStepResponse>['result'];

const parameterSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  value: z.number(),
  defaultValue: z.number(),
  type: z.literal('number'),
});
const checkResultSchema = z.object({
  checkId: z.string(),
  result: z.enum(['pass', 'warn', 'fail']),
  finding: z.string(),
  suggestedRevision: z.string().optional(),
});
const reportSchema = z.object({
  results: z.array(checkResultSchema),
  didNotRun: z.array(
    z.object({ checkId: z.string(), name: z.string(), reason: z.string() }),
  ),
  failed: z.array(checkResultSchema),
  warned: z.array(checkResultSchema),
});
const loopAttemptSchema = z.object({
  attempt: z.number(),
  designId: z.string(),
  proposed: z.record(z.number()),
  violations: z.array(
    z.object({ name: z.string(), reason: z.string(), detail: z.string() }),
  ),
  renderMs: z.number().optional(),
  report: reportSchema.optional(),
  elapsedMs: z.number(),
});
const loopResponse = z.object({
  outcome: z.object({
    ok: z.boolean(),
    designId: z.string(),
    values: z.record(z.number()).optional(),
    params: z.array(parameterSchema).optional(),
    report: reportSchema.optional(),
    attempts: z.array(loopAttemptSchema),
    reselected: z.boolean(),
    message: z.string(),
  }),
  scad: z.string(),
  report: z.unknown().optional(),
  reportMarkdown: z.string().optional(),
  elapsedMs: z.number(),
});
type LoopStep = z.infer<typeof loopResponse>;

export function DemoView() {
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  // One demo session per page load. The server keeps the session's records under this id;
  // no account and no database are involved.
  const [sessionId] = useState(() => crypto.randomUUID());
  const [request, setRequest] = useState('');
  const [measurements, setMeasurements] = useState<Record<string, number>>({});
  const [question, setQuestion] = useState<
    z.infer<typeof requirementsResponse>['result'] & { kind: 'question' }
  >();
  const [specification, setSpecification] = useState<Specification>();
  const [plan, setPlan] = useState<Plan>();
  const [library, setLibrary] = useState<LibraryStep>();
  const [loop, setLoop] = useState<LoopStep>();
  const [stlBlob, setStlBlob] = useState<Blob>();
  const [generation, setGeneration] = useState<LoopStep>();
  const [refusal, setRefusal] = useState<string>();
  const [stepTimes, setStepTimes] = useState<Record<string, number>>({});
  const [downloading, setDownloading] = useState(false);
  const [busy, setBusy] = useState<
    'requirements' | 'library' | 'confirm' | 'draft' | null
  >(null);
  const [error, setError] = useState<string>();
  const [elapsedMs, setElapsedMs] = useState<number>();

  useEffect(() => {
    apiJson('library', {})
      .then((data) => setAttributes(libraryResponse.parse(data).attributes))
      .catch((e) => setError(String(e)));
  }, []);

  const runRequirements = useCallback(async () => {
    setBusy('requirements');
    setError(undefined);
    try {
      // Parse here rather than through apiJson's schema parameter: the record schemas carry
      // defaults, and the explicit parse yields their output type with the defaults applied.
      const r = requirementsResponse.parse(
        await apiJson('demo/requirements', {
          method: 'POST',
          body: JSON.stringify({ sessionId, request, measurements }),
        }),
      );
      setElapsedMs(r.elapsedMs);
      setStepTimes((t) => ({ ...t, requirements: r.elapsedMs }));
      setRefusal(undefined);
      setGeneration(undefined);
      setLibrary(undefined);
      setLoop(undefined);
      if (r.result.kind === 'question') {
        setQuestion(r.result);
        setSpecification(undefined);
        setPlan(undefined);
      } else {
        setQuestion(undefined);
        setSpecification(r.result.specification);
        setPlan(r.result.plan);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [sessionId, request, measurements]);

  const runLibrary = useCallback(async () => {
    setBusy('library');
    setError(undefined);
    try {
      const r = libraryStepResponse.parse(
        await apiJson('demo/library', {
          method: 'POST',
          body: JSON.stringify({ sessionId, measurements }),
        }),
      );
      setLibrary(r.result);
      setPlan(r.plan);
      setQuestion(r.question ? { kind: 'question', ...r.question } : undefined);
      setStepTimes((t) => ({ ...t, library: r.elapsedMs }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [sessionId, measurements]);

  const runLoop = useCallback(async () => {
    setBusy('draft');
    setError(undefined);
    try {
      const r = loopResponse.parse(
        await apiJson('demo/run-loop', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        }),
      );
      setLoop(r);
      setStepTimes((t) => ({ ...t, loop: r.elapsedMs }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        /not confirmed|generation_unavailable|plan_not_confirmed/i.test(message)
      )
        setRefusal(message);
      else setError(message);
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  const runGenerate = useCallback(async () => {
    setBusy('draft');
    setError(undefined);
    try {
      const r = loopResponse.parse(
        await apiJson('demo/generate', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        }),
      );
      setGeneration(r);
      setLoop(r);
      setStepTimes((t) => ({ ...t, loop: r.elapsedMs }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        /not confirmed|generation_unavailable|plan_not_confirmed/i.test(message)
      )
        setRefusal(message);
      else setError(message);
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  const downloadPackage = useCallback(async () => {
    if (
      !loop?.outcome.ok ||
      !loop.report ||
      !loop.reportMarkdown ||
      !stlBlob ||
      !loop.outcome.values
    )
      return;
    setDownloading(true);
    try {
      const files = buildPackageFiles({
        stl: new Uint8Array(await stlBlob.arrayBuffer()),
        scad: loop.scad,
        values: loop.outcome.values,
        report: loop.report as ReportRecord,
        reportMarkdown: loop.reportMarkdown,
      });
      const zip = await zipPackage(files);
      const url = URL.createObjectURL(zip);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${loop.outcome.designId}-package.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }, [loop, stlBlob]);

  const confirmPlan = useCallback(async () => {
    setBusy('confirm');
    setError(undefined);
    try {
      const r = confirmResponse.parse(
        await apiJson('demo/confirm-plan', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        }),
      );
      setPlan(r.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col gap-6 overflow-y-auto px-4 py-6 text-adam-text-primary sm:px-6">
      <h1 className="text-xl font-semibold">Printed part from a request</h1>
      <p className="text-sm text-adam-neutral-300">
        Describe the part and the hardware it must fit, with measurements in
        millimetres. The requirements step returns a specification and a plan,
        or asks for any measurement the design still needs.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (question && library ? runLibrary() : runRequirements());
        }}
      >
        <label htmlFor="demo-request" className="text-sm font-medium">
          Request
        </label>
        <Textarea
          id="demo-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={4}
          placeholder="Tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, 12 mm gap, 14 mm wide at the bridge."
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="submit"
            disabled={busy !== null || request.trim().length === 0}
            className="w-full sm:w-auto"
          >
            {busy === 'requirements'
              ? 'Running requirements step'
              : question
                ? 'Send measurements'
                : 'Run requirements step'}
          </Button>
          {elapsedMs !== undefined && (
            <span className="text-xs text-adam-neutral-400">
              Requirements step took {(elapsedMs / 1000).toFixed(1)} s
            </span>
          )}
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {specification && (
        <section
          aria-label="Library selection"
          className="flex flex-col gap-3 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 sm:p-6"
        >
          <h2 className="text-base font-semibold">Library design</h2>
          {!library && (
            <Button
              type="button"
              onClick={() => void runLibrary()}
              disabled={busy !== null}
              className="w-full sm:w-auto"
            >
              {busy === 'library'
                ? 'Searching the library'
                : 'Select a library design'}
            </Button>
          )}
          {library?.kind === 'no-match' && (
            <p className="text-sm" role="status">
              {library.message}
            </p>
          )}
          {library?.kind === 'candidates' && (
            <ol className="flex flex-col gap-2 text-sm">
              {library.candidates.map((c, i) => (
                <li
                  key={c.designId}
                  className="rounded-md border border-adam-neutral-700 p-3"
                >
                  <p className="font-medium">
                    {i + 1}. {c.name} (class {c.partClass}, evidence level{' '}
                    {c.evidenceLevel})
                  </p>
                  <p className="text-adam-neutral-300">{c.reason}</p>
                </li>
              ))}
            </ol>
          )}
          {library?.kind === 'candidates' && library.stop && (
            <p className="text-sm text-red-400" role="alert">
              {library.stop}
            </p>
          )}
          {library && library.componentsWithoutGeometry.length > 0 && (
            <p className="text-xs text-adam-neutral-400">
              Measurements only, no geometry modelled:{' '}
              {library.componentsWithoutGeometry.join(', ')}
            </p>
          )}
        </section>
      )}
      {(question || specification || plan || refusal) && (
        <LoopPanel
          steps={loopSteps({
            question,
            specification,
            plan,
            library,
            loop,
            generation,
            busy,
            refusal,
            stepTimes,
          })}
          checks={loopChecks(loop)}
          refusal={refusal}
        />
      )}
      {(question || specification || plan) && (
        <MeasurementsPanel
          attributes={attributes}
          question={question}
          measurements={measurements}
          onMeasurementChange={(id, value) =>
            setMeasurements((m) => {
              const next = { ...m };
              if (value === undefined || Number.isNaN(value)) delete next[id];
              else next[id] = value;
              return next;
            })
          }
          specification={specification}
          plan={plan}
          onConfirm={() => void confirmPlan()}
          confirming={busy === 'confirm'}
        />
      )}
      {plan && !plan.confirmed && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void (plan.function === 'generation' ? runGenerate() : runLoop())
            }
            disabled={busy !== null}
            className="w-full sm:w-auto"
          >
            Try to {plan.function === 'generation' ? 'generate' : 'draft'}{' '}
            before confirming (D7)
          </Button>
        </div>
      )}
      {plan?.confirmed && plan.function === 'generation' && (
        <section
          aria-label="Generation, render, and checks"
          className="flex flex-col gap-3 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 sm:p-6"
        >
          <h2 className="text-base font-semibold">
            Generate, render, and checks
          </h2>
          {!generation && (
            <Button
              type="button"
              onClick={() => void runGenerate()}
              disabled={busy !== null}
              className="w-full sm:w-auto"
            >
              {busy === 'draft'
                ? 'Generating a new design'
                : 'Generate a new design'}
            </Button>
          )}
          {generation && (
            <p className="text-sm" role="status">
              {generation.outcome.message} Generation time{' '}
              {(generation.elapsedMs / 1000).toFixed(1)} s.
            </p>
          )}
          {generation?.outcome.ok && generation.outcome.params && (
            <div className="h-[420px] w-full overflow-hidden rounded-md border border-adam-neutral-700">
              <OpenSCADPreview
                scadCode={generation.scad}
                params={generation.outcome.params as Parameter[]}
                color="#4682B4"
                onOutputChange={setStlBlob}
              />
            </div>
          )}
        </section>
      )}
      {plan?.confirmed && plan.function === 'adaptation' && (
        <section
          aria-label="Draft, render, and checks"
          className="flex flex-col gap-3 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 sm:p-6"
        >
          <h2 className="text-base font-semibold">Draft, render, and checks</h2>
          {!loop && (
            <Button
              type="button"
              onClick={() => void runLoop()}
              disabled={busy !== null}
              className="w-full sm:w-auto"
            >
              {busy === 'draft' ? 'Running the loop' : 'Run the loop'}
            </Button>
          )}
          {loop && (
            <>
              <p className="text-sm" role="status">
                {loop.outcome.message} Loop time{' '}
                {(loop.elapsedMs / 1000).toFixed(1)} s.
              </p>
              <ol className="flex flex-col gap-1 text-sm">
                {loop.outcome.attempts.map((a) => (
                  <li key={a.attempt}>
                    Attempt {a.attempt} on {a.designId} (
                    {(a.elapsedMs / 1000).toFixed(1)} s
                    {a.renderMs !== undefined
                      ? `, render ${a.renderMs} ms`
                      : ''}
                    ):{' '}
                    {a.violations.length > 0
                      ? a.violations.map((v) => v.detail).join('; ')
                      : a.report
                        ? a.report.failed.length === 0
                          ? 'every check passed'
                          : a.report.failed.map((f) => f.finding).join('; ')
                        : 'no report'}
                  </li>
                ))}
              </ol>
              {loop.outcome.report && (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-adam-neutral-300">
                      <th className="py-1 pr-3">Check</th>
                      <th className="py-1 pr-3">Result</th>
                      <th className="py-1">Finding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loop.outcome.report.results.map((r) => (
                      <tr key={r.checkId} className="align-top">
                        <td className="py-1 pr-3">{r.checkId}</td>
                        <td className="py-1 pr-3">{r.result}</td>
                        <td className="py-1">
                          {r.finding}
                          {r.suggestedRevision
                            ? ` Suggested revision: ${r.suggestedRevision}`
                            : ''}
                        </td>
                      </tr>
                    ))}
                    {loop.outcome.report.didNotRun.map((d) => (
                      <tr
                        key={d.checkId}
                        className="align-top text-adam-neutral-400"
                      >
                        <td className="py-1 pr-3">{d.checkId}</td>
                        <td className="py-1 pr-3">did not run</td>
                        <td className="py-1">{d.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {loop.outcome.ok && loop.outcome.params && (
                <div className="h-[420px] w-full overflow-hidden rounded-md border border-adam-neutral-700">
                  <OpenSCADPreview
                    scadCode={loop.scad}
                    params={loop.outcome.params as Parameter[]}
                    color="#4682B4"
                    onOutputChange={setStlBlob}
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}
      {loop?.report ? (
        <CheckReportPanel
          report={loop.report as ReportRecord}
          onDownload={() => void downloadPackage()}
          downloading={downloading}
          downloadReady={!!stlBlob && loop.outcome.ok}
        />
      ) : null}
    </main>
  );
}

function loopSteps(state: {
  question: unknown;
  specification: unknown;
  plan?: Plan;
  library?: LibraryStep;
  loop?: LoopStep;
  generation?: LoopStep;
  busy: string | null;
  refusal?: string;
  stepTimes: Record<string, number>;
}): LoopStepRow[] {
  const { plan, library, loop, generation, busy, refusal, stepTimes } = state;
  const requirements: LoopStepRow = {
    id: 'requirements',
    label: 'Requirements and plan',
    status:
      busy === 'requirements'
        ? 'running'
        : state.question
          ? 'done'
          : state.specification
            ? 'done'
            : 'pending',
    detail: state.question
      ? 'asked for a measurement'
      : state.specification
        ? 'specification and plan ready'
        : undefined,
    elapsedMs: stepTimes.requirements,
  };
  const libraryRow: LoopStepRow = {
    id: 'library',
    label: 'Library selection',
    status: busy === 'library' ? 'running' : library ? 'done' : 'pending',
    detail:
      library?.kind === 'candidates'
        ? `${library.candidates.length} candidate${library.candidates.length === 1 ? '' : 's'}`
        : library?.kind === 'no-match'
          ? 'no match, plan revised to generation'
          : undefined,
    elapsedMs: stepTimes.library,
  };
  const confirm: LoopStepRow = {
    id: 'confirm',
    label: 'Plan confirmation',
    status:
      busy === 'confirm'
        ? 'running'
        : plan?.confirmed
          ? 'done'
          : refusal
            ? 'refused'
            : 'pending',
    detail: plan
      ? `${plan.function}${plan.confirmed ? ', confirmed' : ', waiting for confirmation'}`
      : undefined,
  };
  const work = plan?.function === 'generation' ? generation : loop;
  const workRow: LoopStepRow = {
    id: 'work',
    label:
      plan?.function === 'generation'
        ? 'Generation and render'
        : 'Drafting and render',
    status:
      busy === 'draft'
        ? 'running'
        : refusal
          ? 'refused'
          : work
            ? work.outcome.ok
              ? 'done'
              : 'failed'
            : 'pending',
    detail: work
      ? `${work.outcome.attempts.length} attempt${work.outcome.attempts.length === 1 ? '' : 's'}`
      : undefined,
    elapsedMs: stepTimes.loop,
  };
  const checks: LoopStepRow = {
    id: 'checks',
    label: 'Verification',
    status: work?.outcome.report
      ? work.outcome.report.failed.length === 0
        ? 'done'
        : 'failed'
      : 'pending',
    detail: work?.outcome.report
      ? `${work.outcome.report.results.length} checks ran, ${work.outcome.report.didNotRun.length} did not run`
      : undefined,
  };
  return [requirements, libraryRow, confirm, workRow, checks];
}

function loopChecks(loop?: LoopStep): LoopCheckRow[] {
  const report = loop?.outcome.report;
  if (!report) return [];
  return [
    ...report.results.map((r) => ({
      checkId: r.checkId,
      result: r.result,
      finding: r.finding,
    })),
    ...report.didNotRun.map((d) => ({
      checkId: d.checkId,
      result: 'did not run' as const,
      finding: d.reason,
    })),
  ];
}
