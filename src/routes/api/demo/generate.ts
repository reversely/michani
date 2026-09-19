import { createFileRoute } from '@tanstack/react-router';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { requiredEnv } from '@/server/env';
import { getFolderIndex, saveGeneratedDesign } from '@/server/library';
import { PlanNotConfirmedError } from '@/server/loop/controller';
import {
  GenerationNotSelectedError,
  runGeneration,
} from '@/server/agents/generation';
import { buildReport, renderMarkdown } from '@/server/report/build';
import { validateOverrides } from '@shared/library/overrides';
import {
  DemoError,
  loadDemoSession,
  saveDemoSession,
} from '@/server/demo/session';
import { DEMO_MODEL } from './requirements';

const bodySchema = z.object({ sessionId: z.string().uuid() }).strict();

// Generation step (R18, R19): only for a confirmed Plan that selects generation. The table
// write happens inside runGeneration after every check returns pass or warn.
export const Route = createFileRoute('/api/demo/generate')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          const demo = loadDemoSession(body.sessionId);
          if (!demo.specification || !demo.plan)
            return json({ error: 'no_specification' }, 409);
          const anthropic = createAnthropic({
            apiKey: requiredEnv('ANTHROPIC_API_KEY'),
          });
          const started = Date.now();
          const outcome = await runGeneration({
            model: anthropic(DEMO_MODEL),
            plan: demo.plan,
            specification: demo.specification,
            attributes: getFolderIndex().attributes,
            conversationId: body.sessionId,
            save: saveGeneratedDesign,
          });
          saveDemoSession(body.sessionId, {
            ...demo,
            generation: {
              ok: outcome.ok,
              designId: outcome.design.id,
              saved: outcome.saved,
              message: outcome.message,
            },
          });
          const { scad, ...entry } = outcome.design;
          const report = outcome.report
            ? buildReport({
                design: entry,
                specification: demo.specification,
                plan: demo.plan,
                values: outcome.values,
                report: outcome.report,
                attempts: 1,
              })
            : undefined;
          // Same shape as the adaptation loop response, so the page renders both alike.
          const validated = validateOverrides(entry, outcome.values);
          const loopShaped = {
            ok: outcome.ok,
            designId: entry.id,
            values: outcome.values,
            params: validated.ok ? validated.params : [],
            report: outcome.report,
            attempts: [
              {
                attempt: 1,
                designId: entry.id,
                proposed: outcome.values,
                violations: [],
                renderMs: outcome.renderMs,
                report: outcome.report,
                elapsedMs: Date.now() - started,
              },
            ],
            reselected: false,
            message: outcome.message,
            saved: outcome.saved,
          };
          return json({
            outcome: loopShaped,
            scad,
            report,
            reportMarkdown: report ? renderMarkdown(report) : undefined,
            elapsedMs: Date.now() - started,
          });
        } catch (err) {
          if (
            err instanceof PlanNotConfirmedError ||
            err instanceof GenerationNotSelectedError
          )
            return json(
              { error: 'generation_unavailable', message: err.message },
              403,
            );
          if (err instanceof DemoError)
            return json({ error: err.message }, err.status);
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request' }, 400);
          logError(err, { functionName: 'demo-generate', statusCode: 500 });
          return json({ error: 'generation_failed' }, 500);
        }
      },
    },
  },
});
