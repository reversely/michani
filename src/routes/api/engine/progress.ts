import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { json, preflight } from '@/server/api';
import { progressOf } from '@/server/engine/store';

// The progress events of the turn in flight for one session (issue #27).
export const Route = createFileRoute('/api/engine/progress')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async ({ request }) => {
        const id = z
          .string()
          .uuid()
          .safeParse(new URL(request.url).searchParams.get('id'));
        if (!id.success) return json({ error: 'invalid_request' }, 400);
        return json({ events: progressOf(id.data) });
      },
    },
  },
});
