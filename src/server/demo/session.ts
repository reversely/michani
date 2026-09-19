import { z } from 'zod';
import type { Json } from '@shared/database';
import { getAnonSupabaseClient } from '@/server/supabaseClient';
import {
  planSchema,
  specificationSchema,
  type Plan,
  type Specification,
} from '@shared/schemas/library';

// Per-conversation demo state lives in the conversation's existing `settings` jsonb column
// under the `demo` key (PRD, Data model). Only these helpers read and write it.

export const demoQuestionSchema = z.object({
  question: z.string(),
  missing: z.array(
    z.object({
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

export class DemoAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function loadDemoConversation(
  request: Request,
  conversationId: string,
) {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new DemoAuthError(401, 'sign in required');
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, settings')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single();
  if (error || !conversation)
    throw new DemoAuthError(404, 'conversation not found');
  const settings = (conversation.settings ?? {}) as Record<string, unknown>;
  const demo = demoStateSchema.parse(settings.demo ?? {});
  return { supabase, user, settings, demo };
}

export async function saveDemoState(
  supabase: ReturnType<typeof getAnonSupabaseClient>,
  conversationId: string,
  settings: Record<string, unknown>,
  demo: DemoState,
) {
  const { error } = await supabase
    .from('conversations')
    .update({ settings: { ...settings, demo } as unknown as Json })
    .eq('id', conversationId);
  if (error) throw new Error(`saving demo state failed: ${error.message}`);
}

export type { Plan, Specification };
