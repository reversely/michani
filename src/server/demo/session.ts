import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  planSchema,
  specificationSchema,
  type Plan,
  type Specification,
} from '@shared/schemas/library';

// Demo session state: one JSON record per session id, kept in a temp directory on the server.
// No user, no database. The page generates the id; the routes validate it as a UUID so the
// file name is never attacker-controlled.

export const demoQuestionSchema = z.object({
  question: z.string(),
  missing: z.array(
    z.object({
      parameterId: z.string(),
      attributeId: z.string(),
      name: z.string(),
      unit: z.string(),
      reason: z.string(),
    }),
  ),
});

export const demoStateSchema = z
  .object({
    designId: z.string().optional(),
    request: z.string().optional(),
    measurements: z.record(z.number()).default({}),
    specification: specificationSchema.optional(),
    plan: planSchema.optional(),
    question: demoQuestionSchema.optional(),
  })
  .passthrough();
export type DemoState = z.infer<typeof demoStateSchema>;

export class DemoError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sessionIdSchema = z.string().uuid();
const storeDir = path.join(tmpdir(), 'michani-demo-sessions');

function fileFor(sessionId: string): string {
  return path.join(storeDir, `${sessionIdSchema.parse(sessionId)}.json`);
}

export function loadDemoSession(sessionId: string): DemoState {
  const file = fileFor(sessionId);
  if (!existsSync(file)) return demoStateSchema.parse({});
  return demoStateSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

export function saveDemoSession(sessionId: string, demo: DemoState): void {
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(fileFor(sessionId), JSON.stringify(demo));
}

export type { Plan, Specification };
