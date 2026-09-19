import { createFileRoute } from '@tanstack/react-router';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { requiredEnv } from '@/server/env';
import { getFolderIndex, listDesigns } from '@/server/library';
import {
  draftWithRetries,
  PlanNotConfirmedError,
} from '@/server/loop/controller';
import {
  DemoAuthError,
  loadDemoConversation,
  saveDemoState,
} from '@/server/demo/session';
import { DEMO_MODEL } from './requirements';

const bodySchema = z.object({ conversationId: z.string().uuid() }).strict();

// Drafting step behind the confirmed-Plan gate (R7, R10, R17). Returns the validated override
// list plus the design's SCAD source so the browser renders through the -D path; nothing in
// the response was written by the model without passing validation.
export const Route = createFileRoute('/api/demo/draft')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          const { supabase, settings, demo } = await loadDemoConversation(
            request,
            body.conversationId,
          );
          if (!demo.specification || !demo.plan)
            return json({ error: 'no_specification' }, 409);
          const designs = await listDesigns();
          const design = designs.find(
            (d) => d.id === demo.plan?.candidateDesignId,
          );
          if (!design) return json({ error: 'no_candidate_design' }, 409);
          const anthropic = createAnthropic({
            apiKey: requiredEnv('ANTHROPIC_API_KEY'),
          });
          const outcome = await draftWithRetries({
            model: anthropic(DEMO_MODEL),
            plan: demo.plan,
            specification: demo.specification,
            design,
            attributes: getFolderIndex().attributes,
          });
          await saveDemoState(supabase, body.conversationId, settings, {
            ...demo,
            draft: outcome.ok
              ? { values: outcome.values, attempts: outcome.attempts }
              : { attempts: outcome.attempts, message: outcome.message },
          });
          const { scad, ...entry } = design;
          return json({ outcome, design: entry, scad });
        } catch (err) {
          if (err instanceof PlanNotConfirmedError)
            return json(
              { error: 'plan_not_confirmed', message: err.message },
              403,
            );
          if (err instanceof DemoAuthError)
            return json({ error: err.message }, err.status);
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request' }, 400);
          logError(err, { functionName: 'demo-draft', statusCode: 500 });
          return json({ error: 'draft_failed' }, 500);
        }
      },
    },
  },
});
