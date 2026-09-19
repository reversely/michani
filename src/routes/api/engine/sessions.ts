import { createFileRoute } from '@tanstack/react-router';
import { json, preflight } from '@/server/api';
import { listSessions } from '@/server/engine/store';

// The sidebar's list of sessions: ids, titles, states, times, turn counts. No content.
export const Route = createFileRoute('/api/engine/sessions')({
  server: {
    handlers: {
      OPTIONS: preflight,
      GET: async () => json({ sessions: listSessions() }),
    },
  },
});
