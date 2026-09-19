import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { requiredEnv } from '@/server/env';
import { createEngine, type Engine } from '@/engine/run';
import { newSession, sessionSchema, type Session } from '@/engine/session';

// Server-side home for engine sessions: one JSON file per UUID in a temp directory, no
// account and no database. The engine itself is one per process.

const dir = path.join(tmpdir(), 'michani-engine-sessions');
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
};

// The sidebar's session list: ids, titles, states, and times only. The title is the
// specification summary when one exists, else the person's first message.
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
      rows.push({
        id: session.id,
        title: (session.specification.summary ?? firstUser).slice(0, 80),
        state: session.state,
        updatedAt: statSync(path.join(dir, file)).mtime.toISOString(),
        turns: session.transcript.length,
      });
    } catch {
      // A file that fails to parse is not listed; it stays on disk for inspection.
    }
  }
  return rows
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
