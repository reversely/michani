import { createFileRoute } from '@tanstack/react-router';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { requiredEnv } from '@/server/env';
import { getFolderIndex, listDesigns } from '@/server/library';
import { PlanNotConfirmedError } from '@/server/loop/controller';
import { runAdaptationLoop } from '@/server/loop/run';
import { buildReport, renderMarkdown } from '@/server/report/build';
import {
  DemoError,
  loadDemoSession,
  saveDemoSession,
} from '@/server/demo/session';
import { DEMO_MODEL } from './requirements';

const bodySchema = z.object({ sessionId: z.string().uuid() }).strict();

// Runs draft, render, and verification for a confirmed adaptation Plan (R8 to R10). The
// second library candidate, when one exists, is the fallback design after three failed
// attempts. Returns the outcome, the validated overrides, and the design source for the
// browser preview.
export const Route = createFileRoute('/api/demo/run-loop')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          const demo = loadDemoSession(body.sessionId);
          if (!demo.specification || !demo.plan)
            return json({ error: 'no_specification' }, 409);
          const designs = await listDesigns();
          const design = designs.find(
            (d) => d.id === demo.plan?.candidateDesignId,
          );
          if (!design) return json({ error: 'no_candidate_design' }, 409);
          const library = demo.library as
            | { kind?: string; candidates?: Array<{ designId: string }> }
            | undefined;
          const fallbackId = library?.candidates
            ?.map((c) => c.designId)
            .find((id) => id !== design.id);
          const fallbackDesign = fallbackId
            ? designs.find((d) => d.id === fallbackId)
            : undefined;
          const buildVolumeValue = demo.specification.printSettings.find(
            (v) => v.definitionId === 'build-volume',
          )?.value;
          const buildVolume = parseBuildVolume(buildVolumeValue);
          const anthropic = createAnthropic({
            apiKey: requiredEnv('ANTHROPIC_API_KEY'),
          });
          const started = Date.now();
          const outcome = await runAdaptationLoop({
            model: anthropic(DEMO_MODEL),
            plan: demo.plan,
            specification: demo.specification,
            design,
            fallbackDesign,
            attributes: getFolderIndex().attributes,
            buildVolume,
          });
          const used = designs.find((d) => d.id === outcome.designId) ?? design;
          saveDemoSession(body.sessionId, {
            ...demo,
            loop: outcome,
          });
          const { scad, ...entry } = used;
          const report = outcome.report
            ? buildReport({
                design: used,
                specification: demo.specification,
                plan: demo.plan,
                values: outcome.values ?? {},
                report: outcome.report,
                attempts: outcome.attempts.length,
              })
            : undefined;
          return json({
            outcome,
            design: entry,
            scad,
            report,
            reportMarkdown: report ? renderMarkdown(report) : undefined,
            elapsedMs: Date.now() - started,
          });
        } catch (err) {
          if (err instanceof PlanNotConfirmedError)
            return json(
              { error: 'plan_not_confirmed', message: err.message },
              403,
            );
          if (err instanceof DemoError)
            return json({ error: err.message }, err.status);
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request' }, 400);
          logError(err, { functionName: 'demo-run-loop', statusCode: 500 });
          return json({ error: 'loop_failed' }, 500);
        }
      },
    },
  },
});

function parseBuildVolume(
  value: unknown,
): [number, number, number] | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(/\s*x\s*/i).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n <= 0))
    return undefined;
  return [parts[0], parts[1], parts[2]];
}
