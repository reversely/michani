import { createFileRoute } from '@tanstack/react-router';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import { requiredEnv } from '@/server/env';
import { getFolderIndex, listDesigns } from '@/server/library';
import {
  applyCandidateToPlan,
  revisePlanForGeneration,
  runLibraryAgent,
  toIndexEntry,
} from '@/server/agents/library';
import {
  DemoAuthError,
  loadDemoConversation,
  saveDemoState,
} from '@/server/demo/session';
import { DEMO_MODEL } from './requirements';

const bodySchema = z.object({ conversationId: z.string().uuid() }).strict();

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
          const { supabase, settings, demo } = await loadDemoConversation(
            request,
            body.conversationId,
          );
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
          const plan =
            result.kind === 'candidates'
              ? applyCandidateToPlan(demo.plan, result.candidates[0])
              : revisePlanForGeneration(
                  demo.plan,
                  demo.specification,
                  result.message,
                );
          await saveDemoState(supabase, body.conversationId, settings, {
            ...demo,
            plan,
            library: result,
          });
          return json({
            result,
            plan,
            indexMs,
            elapsedMs: Date.now() - started,
          });
        } catch (err) {
          if (err instanceof DemoAuthError)
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
