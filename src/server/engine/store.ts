import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
