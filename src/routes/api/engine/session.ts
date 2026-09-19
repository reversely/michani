import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { loadSession } from '@/server/engine/store';
import type { Execution } from '@/engine/loop';

// One session by id, for reopening from the sidebar. The OpenSCAD source travels only for a
// finished, passing part.
export const Route = createFileRoute('/api/engine/session')({
  server: {
    handlers: {
      OPTIONS: preflight,
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
