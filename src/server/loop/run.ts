import type { LanguageModel } from 'ai';
import type {
  AttributeDefinition,
  DesignEntry,
  Plan,
  Specification,
} from '@shared/schemas/library';
import type { Parameter } from '@shared/types';
import type { OverrideViolation } from '@shared/library/overrides';
import { runDraftingAgent } from '@/server/agents/drafting';
import { registerDefaultChecks } from '@/server/verification/checks';
import { runChecks, type VerificationReport } from '@/server/verification/run';
import { renderScadToStl } from '@/server/render/openscad';
import { MAX_DRAFT_ATTEMPTS, requireConfirmed } from './controller';

// The demo loop after a confirmed Plan (PRD R8 to R10): draft, render, verify; on a failed
// check send the findings back to drafting up to three times; then return to design selection
// once (the caller supplies the next candidate); then stop with a failure report. The bounds
// live here in code, never in agent output.

export type LoopAttempt = {
  attempt: number;
  designId: string;
  proposed: Record<string, number>;
  violations: OverrideViolation[];
  renderMs?: number;
  report?: VerificationReport;
  elapsedMs: number;
};

export type LoopOutcome = {
  ok: boolean;
  designId: string;
  values?: Record<string, number>;
  params?: Parameter[];
  report?: VerificationReport;
  attempts: LoopAttempt[];
  reselected: boolean;
  message: string;
};

export type DesignWithSource = DesignEntry & { scad: string };

export type LoopInput = {
  model: LanguageModel;
  plan: Plan | undefined;
  specification: Specification;
  design: DesignWithSource;
  // The next candidate to try after three failed attempts, when the library step offered one.
  fallbackDesign?: DesignWithSource;
  attributes: AttributeDefinition[];
  buildVolume?: [number, number, number];
  maxAttempts?: number;
};

export async function runAdaptationLoop(
  input: LoopInput,
): Promise<LoopOutcome> {
  requireConfirmed(input.plan);
  registerDefaultChecks();
  const maxAttempts = input.maxAttempts ?? MAX_DRAFT_ATTEMPTS;
  const attempts: LoopAttempt[] = [];

  const tryDesign = async (
    design: DesignWithSource,
    offset: number,
  ): Promise<LoopOutcome | null> => {
    let previousViolations: OverrideViolation[] | undefined;
    for (let i = 1; i <= maxAttempts; i++) {
      const started = Date.now();
      const draft = await runDraftingAgent({
        model: input.model,
        specification: input.specification,
        design,
        attributes: input.attributes,
        previousViolations,
      });
      const attempt: LoopAttempt = {
        attempt: offset + i,
        designId: design.id,
        proposed: draft.proposed,
        violations: draft.ok ? [] : draft.violations,
        elapsedMs: 0,
      };
      if (!draft.ok) {
        previousViolations = draft.violations;
        attempt.elapsedMs = Date.now() - started;
        attempts.push(attempt);
        continue;
      }
      const render = await renderScadToStl(design.scad, draft.values);
      attempt.renderMs = render.ms;
      const report = await runChecks({
        design,
        specification: input.specification,
        values: draft.values,
        mesh: render.summary ?? undefined,
        renderExitCode: render.exitCode,
        renderLog: render.log,
        buildVolume: input.buildVolume,
      });
      attempt.report = report;
      attempt.elapsedMs = Date.now() - started;
      attempts.push(attempt);
      if (report.failed.length === 0) {
        return {
          ok: true,
          designId: design.id,
          values: draft.values,
          params: draft.params,
          report,
          attempts,
          reselected: offset > 0,
          message: `Every check passed${report.warned.length ? ` with ${report.warned.length} warning${report.warned.length === 1 ? '' : 's'}` : ''}.`,
        };
      }
      // A failed check feeds the drafting agent as a violation with the check's revision.
      previousViolations = report.failed.map((r) => ({
        name: r.checkId,
        reason: 'constraint' as const,
        detail: `${r.finding}${r.suggestedRevision ? ` Suggested revision: ${r.suggestedRevision}` : ''}`,
      }));
    }
    return null;
  };

  const first = await tryDesign(input.design, 0);
  if (first) return first;
  if (input.fallbackDesign && input.fallbackDesign.id !== input.design.id) {
    const second = await tryDesign(input.fallbackDesign, maxAttempts);
    if (second) return second;
  }
  const last = attempts[attempts.length - 1];
  const lastReport = last?.report;
  const detail =
    lastReport?.failed.map((r) => r.finding).join(' ') ??
    last?.violations.map((v) => v.detail).join(' ') ??
    '';
  return {
    ok: false,
    designId: last?.designId ?? input.design.id,
    report: lastReport,
    attempts,
    reselected: attempts.some((a) => a.designId !== input.design.id),
    message:
      `The loop stopped after ${attempts.length} attempts${input.fallbackDesign ? ' across two designs' : ''}. ${detail}`.trim(),
  };
}
