import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { logError } from '@/server/serverLog';
import {
  engineInstance,
  loadSession,
  saveSession,
} from '@/server/engine/store';
import type { Execution } from '@/engine/loop';

const bodySchema = z
  .object({
    sessionId: z.string().uuid(),
    message: z.string().min(1).max(4000),
  })
  .strict();

// One conversational turn (issue #17). Returns the reply and the session; the OpenSCAD source
// of a finished part travels only in the execution record, for the preview.
export const Route = createFileRoute('/api/engine/turn')({
  server: {
    handlers: {
      OPTIONS: preflight,
      POST: async ({ request }) => {
        try {
          const body = bodySchema.parse(await request.json());
          const started = Date.now();
          const r = await engineInstance().turn(
            loadSession(body.sessionId),
            body.message,
          );
          saveSession(r.session);
          const execution = r.session.execution as Execution | undefined;
          return json({
            reply: r.reply,
            session: {
              ...r.session,
              execution: execution
                ? {
                    ...execution,
                    scad: execution.ok ? execution.scad : undefined,
                  }
                : undefined,
            },
            elapsedMs: Date.now() - started,
          });
        } catch (err) {
          if (err instanceof z.ZodError)
            return json({ error: 'invalid_request' }, 400);
          logError(err, { functionName: 'engine-turn', statusCode: 500 });
          return json(
            {
              error: 'turn_failed',
              message: err instanceof Error ? err.message : String(err),
            },
            500,
          );
        }
      },
    },
  },
});
