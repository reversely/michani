import { createFileRoute } from '@tanstack/react-router';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { requiredEnv } from '@/server/env';
import { getFolderIndex } from '@/server/library';
import { runRequirementsAgent } from '@/server/agents/requirements';
import {
  DemoError,
  loadDemoSession,
  saveDemoSession,
} from '@/server/demo/session';

const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    request: z.string().min(1).max(4000),
    measurements: z.record(z.number()).default({}),
  })
  .strict();

export const DEMO_MODEL = 'claude-sonnet-5';

// Runs the requirements step for a demo conversation and stores the outcome in its settings.
// Until checkpoint 5 supplies the library agent, the design is chosen by id in the request.
export const Route = createFileRoute('/api/demo/requirements')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          const demo = loadDemoSession(body.sessionId);
          const { attributes, components } = getFolderIndex();
          const anthropic = createAnthropic({
            apiKey: requiredEnv('ANTHROPIC_API_KEY'),
          });
          const started = Date.now();
          const result = await runRequirementsAgent({
            model: anthropic(DEMO_MODEL),
            request: body.request,
            measurements: body.measurements,
            attributes,
            catalogue: components,
            conversationId: body.sessionId,
          });
          const next = {
            ...demo,
            request: body.request,
            measurements: body.measurements,
            question:
              result.kind === 'question'
                ? { question: result.question, missing: result.missing }
                : undefined,
            specification:
              result.kind === 'specification'
                ? result.specification
                : demo.specification,
            // A new specification resets the plan, so a confirmed flag never outlives its plan.
            plan: result.kind === 'specification' ? result.plan : demo.plan,
          };
          saveDemoSession(body.sessionId, next);
          return json({ result, elapsedMs: Date.now() - started });
        } catch (err) {
          if (err instanceof DemoError)
            return json({ error: err.message }, err.status);
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request', issues: err.issues }, 400);
          logError(err, { functionName: 'demo-requirements', statusCode: 500 });
          return json({ error: 'requirements_failed' }, 500);
        }
      },
    },
  },
});
