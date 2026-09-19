import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { requiredEnv } from '@/server/env';
import { createEngine, type Engine } from '@/engine/run';
import {
  newSession,
  sessionSchema,
  workspaceSchema,
  type Session,
  type Workspace,
} from '@/engine/session';

// Server-side home for engine sessions: one JSON file per UUID under the repository's
// ignored .michani folder, no account and no database. The OS temp folder was the first home
// and macOS cleared it between sessions, which emptied the workspace. The engine itself is
// one per process.

export const sessionDir = path.resolve(
  process.env.MICHANI_SESSION_DIR ?? '.michani/sessions',
);
const dir = sessionDir;
const sessionId = z.string().uuid();
let engine: Engine | null = null;

export function engineInstance(): Engine {
  engine ??= createEngine(
    createAnthropic({ apiKey: requiredEnv('ANTHROPIC_API_KEY') })(
      'claude-sonnet-5',
    ),
  );
  return engine;
}

export function loadSession(id: string): Session {
  const file = path.join(dir, `${sessionId.parse(id)}.json`);
  if (!existsSync(file)) return newSession(id);
  return sessionSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function saveSession(session: Session): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${session.id}.json`), JSON.stringify(session));
}

export type SessionSummary = {
  id: string;
  title: string;
  state: string;
  updatedAt: string;
  turns: number;
  // Whether every verification agent passed; undefined until the part ran.
  ok?: boolean;
  pinned: boolean;
  archived: boolean;
};

// Applies a partial filing change and returns the saved session. Unknown keys are refused by
// the schema so a request cannot write arbitrary fields into the file.
export function updateWorkspace(
  id: string,
  patch: Partial<Workspace>,
): Session {
  const session = loadSession(id);
  const workspace = workspaceSchema.parse({
    ...session.workspace,
    ...patch,
  });
  const next = { ...session, workspace };
  saveSession(next);
  return next;
}

// The sidebar's session list: ids, titles, states, and times only. The title is the
// person's own name for the part, else the specification summary, else the first message.
export function listSessions(limit = 50): SessionSummary[] {
  if (!existsSync(dir)) return [];
  const rows: SessionSummary[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const session = sessionSchema.parse(
        JSON.parse(readFileSync(path.join(dir, file), 'utf8')),
      );
      const firstUser =
        session.transcript.find((t) => t.role === 'user')?.text ?? '';
      if (session.transcript.length === 0) continue;
      const execution = session.execution as { ok?: boolean } | undefined;
      rows.push({
        id: session.id,
        title: (
          session.workspace.title ??
          session.specification.summary ??
          firstUser
        ).slice(0, 80),
        state: session.state,
        updatedAt: statSync(path.join(dir, file)).mtime.toISOString(),
        turns: session.transcript.length,
        ok: execution?.ok,
        pinned: session.workspace.pinned,
        archived: session.workspace.archived,
      });
    } catch {
      // A file that fails to parse is not listed; it stays on disk for inspection.
    }
  }
  return rows
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
