import type { LanguageModel } from 'ai';
import {
  planSchema,
  type DesignEntry,
  type Plan,
  type Specification,
} from '@shared/schemas/library';
import type { OverrideViolation } from '@shared/library/overrides';
import { validateOverrides } from '@shared/library/overrides';
import { runDraftingAgent } from '@/server/agents/drafting';
import {
  applyCandidateToPlan,
  runLibraryAgent,
  toIndexEntry,
  type LibraryResult,
} from '@/server/agents/library';
import { CHECKS_BY_CLASS } from '@/server/agents/requirements';
import { designFromGeneratedCode } from '@/server/agents/generation';
import { cadam } from './tools/cadam';
import { library } from './tools';
import { runVerification, type VerificationRun } from './agents/verification';
import { advance, confirmPlan, setPlan, type Session } from './session';

// The engine loop after gathering (issues #11 to #15): select a design and plan, wait for the
// person's confirmation, then draft or generate, render through CADAM, and verify with the
// agents. Failed verdicts return to drafting up to three times.

export const MAX_ATTEMPTS = 3;

export type Attempt = {
  attempt: number;
  designId: string;
  values: Record<string, number>;
  violations: OverrideViolation[];
  renderMs?: number;
  verification?: VerificationRun;
  ms: number;
};

export type Execution = {
  ok: boolean;
  function: Plan['function'];
  designId: string;
  designName: string;
  source: DesignEntry['source'];
  evidenceLevel: DesignEntry['evidenceLevel'];
  riskLabel: DesignEntry['riskLabel'];
  values: Record<string, number>;
  scad: string;
  attempts: Attempt[];
  verification?: VerificationRun;
  message: string;
};

// Specified -> planned: the library agent ranks designs; no match revises the plan to generation.
export async function planSession(
  session: Session,
  model: LanguageModel,
): Promise<{ session: Session; library: LibraryResult; reply: string }> {
  const { designs, components } = library();
  const result = await runLibraryAgent({
    model,
    specification: session.specification,
    index: designs.map(toIndexEntry),
    catalogue: components,
  });
  const base: Plan = planSchema.parse({
    id: `plan-${session.id}`,
    function: 'adaptation',
    candidateDesignId: 'pending',
    measurementsNeeded: [],
    checkIds: CHECKS_BY_CLASS.A,
    riskLabel:
      session.specification.contactClass &&
      session.specification.contactClass !== 'none' &&
      session.specification.contactClass !== 'skin'
        ? 'needs expert review'
        : 'general',
    reason: 'pending',
    confirmed: false,
  });
  let plan: Plan;
  let reply: string;
  if (result.kind === 'candidates') {
    plan = {
      ...applyCandidateToPlan(base, result.candidates[0]),
      reason: result.candidates[0].reason,
    };
    reply = `Plan: adapt the library design "${result.candidates[0].name}". ${result.candidates[0].reason} Checks: ${plan.checkIds.join(', ')}. Risk label: ${plan.riskLabel}. Shall I go ahead?`;
  } else {
    plan = planSchema.parse({
      ...base,
      function: 'generation',
      candidateDesignId: undefined,
      generationBrief: generationBriefFrom(session.specification),
      reason: result.message,
      riskLabel: 'needs expert review',
    });
    reply = `${result.message} Plan: generate a new design from the specification, verified by every agent and labelled untested. Shall I go ahead?`;
  }
  return { session: setPlan(session, plan), library: result, reply };
}

export function confirmSession(session: Session): Session {
  return confirmPlan(session);
}

// Confirmed -> executed.
export async function executeSession(
  session: Session,
  model: LanguageModel,
): Promise<{ session: Session; execution: Execution }> {
  if (session.state !== 'confirmed' || !session.plan)
    throw new Error('session is not confirmed');
  const plan = session.plan;
  const { designs, attributes } = library();
  const specification = session.specification;
  const attempts: Attempt[] = [];

  const verify = async (
    design: DesignEntry & { scad: string },
    values: Record<string, number>,
    attemptNo: number,
    started: number,
  ): Promise<{ attempt: Attempt; ok: boolean }> => {
    const render = await cadam().render(design.scad, values);
    const verification = await runVerification(
      {
        designId: design.id,
        partClass: design.partClass,
        values,
        specification,
        mesh: render.summary ?? undefined,
        renderExitCode: render.exitCode,
      },
      model,
    );
    const attempt: Attempt = {
      attempt: attemptNo,
      designId: design.id,
      values,
      violations: [],
      renderMs: render.ms,
      verification,
      ms: Date.now() - started,
    };
    attempts.push(attempt);
    return { attempt, ok: verification.failed.length === 0 };
  };

  const finish = (
    design: DesignEntry & { scad: string },
    values: Record<string, number>,
    ok: boolean,
    verification: VerificationRun | undefined,
    message: string,
  ): { session: Session; execution: Execution } => {
    const execution: Execution = {
      ok,
      function: plan.function,
      designId: design.id,
      designName: design.name,
      source: design.source,
      evidenceLevel:
        design.source === 'generated' ? 'untested' : design.evidenceLevel,
      riskLabel: design.riskLabel,
      values,
      scad: design.scad,
      attempts,
      verification,
      message,
    };
    return {
      session: advance({ ...session, execution }, 'executed'),
      execution,
    };
  };

  if (plan.function === 'generation') {
    // Up to MAX_ATTEMPTS generations (issue #16). Each retry receives the failed verdicts, and
    // the warned verdicts that carry a suggested revision, as a delimited feedback block.
    const brief = plan.generationBrief ?? specification.purpose ?? '';
    let feedback: string[] = [];
    let last:
      | {
          design: DesignEntry & { scad: string };
          values: Record<string, number>;
          verification?: VerificationRun;
        }
      | undefined;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const started = Date.now();
      const generated = await cadam().generate(
        generationBriefWithFeedback(
          brief,
          specification.requirements,
          feedback,
        ),
        model,
      );
      const design = {
        ...designFromGeneratedCode({
          id: `generated-${session.id.slice(0, 8)}-${i}`,
          title: generated.title,
          code: generated.code,
          conversationId: session.id,
          attributes,
        }),
        scad: generated.code,
      };
      // The render tool looks designs up by id, so the generated one joins the in-memory index.
      library().designs.push(design);
      const values = Object.fromEntries(
        design.parameters.map((p) => [p.variable, p.default]),
      );
      const { ok, attempt } = await verify(design, values, i, started);
      last = { design, values, verification: attempt.verification };
      const revisable =
        attempt.verification?.warned.filter((v) => v.suggestedRevision) ?? [];
      if (ok && revisable.length === 0)
        return finish(
          design,
          values,
          true,
          attempt.verification,
          'The generated design passed every agent.',
        );
      if (ok && i === MAX_ATTEMPTS)
        return finish(
          design,
          values,
          true,
          attempt.verification,
          `The generated design passed every agent with ${revisable.length} warning(s) still open after ${i} attempts.`,
        );
      feedback = [...(attempt.verification?.failed ?? []), ...revisable].map(
        (v) =>
          `${v.agentId} (${v.result}): ${v.finding}${v.suggestedRevision ? ` Suggested revision: ${v.suggestedRevision}` : ''}`,
      );
    }
    return finish(
      last!.design,
      last!.values,
      false,
      last!.verification,
      `The generated design still failed after ${attempts.length} attempts. ${last!.verification?.failed.map((v) => v.finding).join(' ') ?? ''}`.trim(),
    );
  }

  const design = designs.find((d) => d.id === plan.candidateDesignId);
  if (!design) throw new Error(`no library design "${plan.candidateDesignId}"`);
  let previousViolations: OverrideViolation[] | undefined;
  let lastVerification: VerificationRun | undefined;
  let lastValues: Record<string, number> = {};
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const started = Date.now();
    const draft = await runDraftingAgent({
      model,
      specification,
      design,
      attributes,
      previousViolations,
    });
    if (!draft.ok) {
      attempts.push({
        attempt: i,
        designId: design.id,
        values: draft.proposed,
        violations: draft.violations,
        ms: Date.now() - started,
      });
      previousViolations = draft.violations;
      continue;
    }
    const check = validateOverrides(design, draft.values);
    if (!check.ok) continue;
    lastValues = draft.values;
    const { ok, attempt } = await verify(design, draft.values, i, started);
    lastVerification = attempt.verification;
    if (ok)
      return finish(
        design,
        draft.values,
        true,
        attempt.verification,
        `Every agent passed${attempt.verification?.warned.length ? ` with ${attempt.verification.warned.length} warning(s)` : ''}.`,
      );
    previousViolations = attempt.verification!.failed.map((v) => ({
      name: v.agentId,
      reason: 'constraint' as const,
      detail: `${v.finding}${v.suggestedRevision ? ` Suggested revision: ${v.suggestedRevision}` : ''}`,
    }));
  }
  return finish(
    design,
    lastValues,
    false,
    lastVerification,
    `Stopped after ${attempts.length} attempts. ${lastVerification?.failed.map((v) => v.finding).join(' ') ?? ''}`.trim(),
  );
}

// The brief for a regeneration: the original brief and requirements, then the verdicts from
// the previous attempt inside a feedback block that the prompt treats as data to act on.
export function generationBriefWithFeedback(
  brief: string,
  requirements: string[],
  feedback: string[],
): string {
  const base = [brief, ...requirements.map((r, i) => `${i + 1}. ${r}`)].join(
    '\n',
  );
  if (feedback.length === 0) return base;
  return `${base}\n<feedback>\nThe previous attempt was verified and these verdicts must be resolved in this attempt:\n${feedback.map((f) => `- ${f.replace(/<\/?feedback>/g, '')}`).join('\n')}\n</feedback>`;
}

// The brief the generation function receives: the summary, the person's own detailed words,
// the size, the material, and every section with its status, so a style reference and the
// assumptions behind it reach the model that writes the geometry.
export function generationBriefFrom(spec: Specification): string {
  const size = spec.sizeMm
    ? [
        spec.sizeMm.width && `width ${spec.sizeMm.width} mm`,
        spec.sizeMm.depth && `depth ${spec.sizeMm.depth} mm`,
        spec.sizeMm.height && `height ${spec.sizeMm.height} mm`,
        spec.sizeMm.note,
      ]
        .filter(Boolean)
        .join(', ')
    : spec.dimensions.map((d) => `${d.name} ${d.value} ${d.unit}`).join(', ');
  return [
    spec.summary ?? spec.purpose ?? '',
    spec.details ? `Details from the person: ${spec.details}` : '',
    size ? `Size: ${size}.` : '',
    spec.material ? `Material: ${spec.material}.` : '',
    ...spec.sections.map(
      (s) =>
        `${s.heading} (${s.status}${s.source ? `, source ${s.source}` : ''}): ${s.content}`,
    ),
    ...spec.requirements,
  ]
    .filter(Boolean)
    .join('\n');
}
