import { createFileRoute } from '@tanstack/react-router';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { requiredEnv } from '@/server/env';
import { getFolderIndex, listDesigns } from '@/server/library';
import {
  applyCandidateToPlan,
  missingMeasurements,
  revisePlanForGeneration,
  runLibraryAgent,
  toIndexEntry,
} from '@/server/agents/library';
import {
  DemoError,
  loadDemoSession,
  saveDemoSession,
} from '@/server/demo/session';
import { DEMO_MODEL } from './requirements';

const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    measurements: z.record(z.number()).default({}),
  })
  .strict();

// Runs the library step for a demo conversation that already holds a Specification. Stores the
// candidates or the no-match message, and rewrites the Plan: the top candidate for adaptation,
// or generation after a no-match. Either way the confirmed flag resets to false.
export const Route = createFileRoute('/api/demo/library')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          const demo = loadDemoSession(body.sessionId);
          if (!demo.specification || !demo.plan)
            return json({ error: 'no_specification' }, 409);
          const started = Date.now();
          const designs = await listDesigns();
          const index = designs.map(toIndexEntry);
          const indexMs = Date.now() - started;
          const anthropic = createAnthropic({
            apiKey: requiredEnv('ANTHROPIC_API_KEY'),
          });
          const result = await runLibraryAgent({
            model: anthropic(DEMO_MODEL),
            specification: demo.specification,
            index,
            catalogue: getFolderIndex().components,
          });
          const { attributes } = getFolderIndex();
          if (result.kind === 'no-match') {
            const plan = revisePlanForGeneration(
              demo.plan,
              demo.specification,
              result.message,
            );
            saveDemoSession(body.sessionId, {
              ...demo,
              plan,
              library: result,
              question: undefined,
            });
            return json({
              result,
              plan,
              indexMs,
              elapsedMs: Date.now() - started,
            });
          }
          const chosen = designs.find(
            (d) => d.id === result.candidates[0].designId,
          )!;
          const supplied = { ...demo.measurements, ...body.measurements };
          const missing = missingMeasurements(
            chosen,
            demo.specification,
            supplied,
            attributes,
          );
          const plan = applyCandidateToPlan(demo.plan, result.candidates[0]);
          if (missing.length > 0) {
            // The design needs values the request did not give: ask by name and unit (R2).
            const question = {
              question: `The ${chosen.name.toLowerCase()} design needs ${missing.length} more measurement${missing.length === 1 ? '' : 's'}: ${missing.map((m) => `${m.name.toLowerCase()} (${m.unit})`).join(', ')}.`,
              missing,
            };
            saveDemoSession(body.sessionId, {
              ...demo,
              measurements: supplied,
              plan,
              library: result,
              question,
            });
            return json({
              result,
              plan,
              question,
              indexMs,
              elapsedMs: Date.now() - started,
            });
          }
          // Every value is in hand: fold typed measurements into the specification by parameter id.
          const known = new Set(
            demo.specification.partMeasurements.map((m) => m.parameterId),
          );
          const partMeasurements = [
            ...demo.specification.partMeasurements,
            ...Object.entries(supplied)
              .filter(
                ([id]) =>
                  !known.has(id) && chosen.parameters.some((p) => p.id === id),
              )
              .map(([parameterId, value]) => ({
                parameterId,
                value,
                source: 'user' as const,
              })),
          ];
          const specification = { ...demo.specification, partMeasurements };
          saveDemoSession(body.sessionId, {
            ...demo,
            measurements: supplied,
            specification,
            plan,
            library: result,
            question: undefined,
          });
          return json({
            result,
            plan,
            question: undefined,
            indexMs,
            elapsedMs: Date.now() - started,
          });
        } catch (err) {
          if (err instanceof DemoError)
            return json({ error: err.message }, err.status);
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request' }, 400);
          logError(err, { functionName: 'demo-library', statusCode: 500 });
          return json({ error: 'library_failed' }, 500);
        }
      },
    },
  },
});
