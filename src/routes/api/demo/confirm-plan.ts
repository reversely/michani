import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import {
  DemoAuthError,
  loadDemoConversation,
  saveDemoState,
} from '@/server/demo/session';

const bodySchema = z.object({ conversationId: z.string().uuid() }).strict();

// The only code path that sets a Plan's confirmed flag (PRD R17). Agent output never can,
// because the agent output schema has no such field.
export const Route = createFileRoute('/api/demo/confirm-plan')({
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
          if (!demo.plan) return json({ error: 'no_plan' }, 409);
          const plan = { ...demo.plan, confirmed: true };
          await saveDemoState(supabase, body.conversationId, settings, {
            ...demo,
            plan,
          });
          return json({ plan });
        } catch (err) {
          if (err instanceof DemoAuthError)
            return json({ error: err.message }, err.status);
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request' }, 400);
          logError(err, { functionName: 'demo-confirm-plan', statusCode: 500 });
          return json({ error: 'confirm_failed' }, 500);
        }
      },
    },
  },
});
