import type { LanguageModel } from 'ai';
import type {
  AttributeDefinition,
  DesignEntry,
  Plan,
  Specification,
} from '@shared/schemas/library';
import type { Parameter } from '@shared/types';
import {
  validateOverrides,
  type OverrideViolation,
} from '@shared/library/overrides';
import { runDraftingAgent } from '@/server/agents/drafting';

// Loop controller (PRD R7, R10, R17). The gate and the validation are plain TypeScript: the
// model never decides whether it may draft, and no value reaches the renderer unchecked.

export const MAX_DRAFT_ATTEMPTS = 3;

export class PlanNotConfirmedError extends Error {
  constructor() {
    super(
      'The plan is not confirmed. Drafting and generation are unavailable until the user confirms the plan.',
    );
  }
}

// Which tools the model may call at this point in the loop. Drafting and generation only
// appear once the plan is confirmed; a call that arrives anyway is refused by `requireConfirmed`.
export function availableTools(
  plan: Plan | undefined,
): Array<'requirements' | 'library' | 'draft' | 'generate'> {
  const tools: Array<'requirements' | 'library' | 'draft' | 'generate'> = [
    'requirements',
    'library',
  ];
  if (plan?.confirmed)
    tools.push(plan.function === 'generation' ? 'generate' : 'draft');
  return tools;
}

export function requireConfirmed(
  plan: Plan | undefined,
): asserts plan is Plan & { confirmed: true } {
  if (!plan?.confirmed) throw new PlanNotConfirmedError();
}

export type DraftAttempt = {
  attempt: number;
  proposed: Record<string, number>;
  violations: OverrideViolation[];
  notes?: string;
  elapsedMs: number;
};

export type DraftOutcome =
  | {
      ok: true;
      params: Parameter[];
      values: Record<string, number>;
      attempts: DraftAttempt[];
    }
  | { ok: false; attempts: DraftAttempt[]; message: string };

// Runs the drafting agent up to `maxAttempts` times, returning each rejection to the next
// attempt. Every proposal passes through validateOverrides before it counts as accepted.
export async function draftWithRetries(input: {
  model: LanguageModel;
  plan: Plan | undefined;
  specification: Specification;
  design: DesignEntry;
  attributes: AttributeDefinition[];
  maxAttempts?: number;
}): Promise<DraftOutcome> {
  requireConfirmed(input.plan);
  const maxAttempts = input.maxAttempts ?? MAX_DRAFT_ATTEMPTS;
  const attempts: DraftAttempt[] = [];
  let previousViolations: OverrideViolation[] | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    const result = await runDraftingAgent({
      model: input.model,
      specification: input.specification,
      design: input.design,
      attributes: input.attributes,
      previousViolations,
    });
    const record: DraftAttempt = {
      attempt,
      proposed: result.proposed,
      violations: result.ok ? [] : result.violations,
      notes: result.notes,
      elapsedMs: Date.now() - started,
    };
    attempts.push(record);
    if (result.ok)
      return {
        ok: true,
        params: result.params,
        values: result.values,
        attempts,
      };
    previousViolations = result.violations;
  }
  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    attempts,
    message: `Drafting failed after ${attempts.length} attempts. ${last.violations.map((v) => v.detail).join(' ')}`,
  };
}

// Direct validation entry for callers that already hold values, such as a slider edit in the
// interface. Same rules, same rejections.
export function validateForRender(
  design: Pick<DesignEntry, 'parameters'>,
  values: Record<string, unknown>,
) {
  return validateOverrides(design, values);
}
