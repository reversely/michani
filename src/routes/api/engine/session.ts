import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { loadSession, updateWorkspace } from '@/server/engine/store';
import { workspaceSchema } from '@/engine/session';
import type { Execution } from '@/engine/loop';

// One session by id, for reopening from the sidebar, and a PATCH that files it in the
// workspace (issue #22). The OpenSCAD source travels only for a finished, passing part.
const patchBody = z
  .object({ id: z.string().uuid(), workspace: workspaceSchema.partial() })
  .strict();
export const Route = createFileRoute('/api/engine/session')({
  server: {
    handlers: {
      OPTIONS: preflight,
      PATCH: async ({ request }) => {
        const body = patchBody.safeParse(
          await request.json().catch(() => null),
        );
        if (!body.success) return json({ error: 'invalid_request' }, 400);
        const session = updateWorkspace(body.data.id, body.data.workspace);
        return json({ workspace: session.workspace });
      },
      GET: async ({ request }) => {
        const id = z
          .string()
          .uuid()
          .safeParse(new URL(request.url).searchParams.get('id'));
        if (!id.success) return json({ error: 'invalid_request' }, 400);
        const session = loadSession(id.data);
        const execution = session.execution as Execution | undefined;
        return json({
          session: {
            ...session,
            execution: execution
              ? {
                  ...execution,
                  scad: execution.ok ? execution.scad : undefined,
                }
              : undefined,
          },
        });
      },
    },
  },
});
