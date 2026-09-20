import type { LanguageModel } from 'ai';
import { requirementsExtractor } from './agents/requirements';
import { registerDefaultVerificationAgents } from './agents/verification';
import {
  executeSession,
  planSession,
  confirmSession,
  type Execution,
} from './loop';
import {
  addTurn,
  gatherTurn,
  missingFields,
  newSession,
  REQUIRED_FIELDS,
  type Session,
} from './session';
import { registerDefaultTools, library } from './tools';

// One entry point for every front end (issue #15): feed turns, get replies, read the session.
// "yes" while planned confirms the plan; anything else while planned is treated as a change
// of mind that returns to gathering with the message appended.

import type { OnProgress } from './progress';

export type EngineReply = { session: Session; reply: string };

export type Engine = {
  start: () => Session;
  turn: (
    session: Session,
    message: string,
    onProgress?: OnProgress,
  ) => Promise<EngineReply>;
};

export function createEngine(model: LanguageModel): Engine {
  registerDefaultTools();
  registerDefaultVerificationAgents();
  const extract = requirementsExtractor(model);
  return {
    start: () => newSession(crypto.randomUUID()),
    async turn(session, message, onProgress) {
      switch (session.state) {
        case 'gathering': {
          const r = await gatherTurn(session, message, extract);
          if (r.session.state !== 'specified') return r;
          const planned = await planSession(r.session, model, onProgress);
          return {
            session: addTurn(planned.session, 'assistant', planned.reply),
            reply: `${r.reply} ${planned.reply}`,
          };
        }
        case 'planned': {
          if (!/^\s*(yes|y|ok|go|confirm|go ahead|proceed)\b/i.test(message)) {
            const back = addTurn(
              { ...session, state: 'gathering', plan: undefined },
              'user',
              message,
            );
            const reply =
              'Understood. Tell me what to change, and I will revise the specification.';
            return { session: addTurn(back, 'assistant', reply), reply };
          }
          const confirmed = confirmSession(addTurn(session, 'user', message));
          const reply =
            'Plan confirmed. Drafting, rendering, and verifying now.';
          const executed = await executeSession(
            addTurn(confirmed, 'assistant', reply),
            model,
            onProgress,
          );
          const summary = summariseExecution(executed.execution);
          return {
            session: addTurn(executed.session, 'assistant', summary),
            reply: `${reply} ${summary}`,
          };
        }
        default: {
          const reply = `The session is ${session.state}. Start a new session for another part.`;
          return {
            session: addTurn(
              addTurn(session, 'user', message),
              'assistant',
              reply,
            ),
            reply,
          };
        }
      }
    },
  };
}

export function summariseExecution(e: Execution): string {
  const verdicts =
    e.verification?.verdicts
      .map((v) => `${v.agentId}: ${v.result}`)
      .join(', ') ?? 'no verification';
  const skipped = e.verification?.didNotRun.map((d) => d.agentId).join(', ');
  return `${e.message} Design "${e.designName}" (${e.source}, evidence level ${e.evidenceLevel}, risk label ${e.riskLabel}). Verdicts: ${verdicts}.${skipped ? ` Did not run: ${skipped}.` : ''}`;
}

// Plain-text and Markdown renderings of a session for the transcript runner.
export function renderSessionMarkdown(session: Session): string {
  const s = session.specification;
  const lines: string[] = [
    `# Session ${session.id}`,
    '',
    `State: ${session.state}`,
    '',
    '## Transcript',
    '',
  ];
  for (const t of session.transcript)
    lines.push(
      `**${t.role === 'user' ? 'Person' : 'Assistant'}:** ${t.text}`,
      '',
    );
  lines.push('## Specification', '', '| Field | Value |', '| --- | --- |');
  lines.push(`| Purpose | ${s.purpose ?? ''} |`);
  lines.push(
    `| Dimensions | ${s.dimensions.map((d) => `${d.name} ${d.value} ${d.unit}`).join(', ')} |`,
  );
  lines.push(`| Material | ${s.material ?? ''} |`);
  lines.push(
    `| Hardware | ${s.hardware === 'listed' ? s.components.map((c) => c.label).join(', ') : (s.hardware ?? '')} |`,
  );
  lines.push(`| Load | ${s.load ?? ''} |`);
  lines.push(`| Environment | ${s.environment ?? ''} |`);
  lines.push(`| Contact class | ${s.contactClass ?? ''} |`);
  lines.push(`| Requirements | ${s.requirements.join('; ')} |`);
  const missing = missingFields(s).map((f) => f.label);
  lines.push(`| Missing | ${missing.join(', ') || 'none'} |`, '');
  if (session.plan) {
    lines.push(
      '## Plan',
      '',
      `Function: ${session.plan.function}${session.plan.candidateDesignId ? `, design ${session.plan.candidateDesignId}` : ''}. Confirmed: ${session.plan.confirmed ? 'yes' : 'no'}.`,
      '',
      session.plan.reason,
      '',
    );
  }
  const e = session.execution as Execution | undefined;
  if (e) {
    lines.push(
      '## Execution',
      '',
      e.message,
      '',
      '| Attempt | Design | Render ms | Verdicts |',
      '| --- | --- | --- | --- |',
    );
    for (const a of e.attempts)
      lines.push(
        `| ${a.attempt} | ${a.designId} | ${a.renderMs ?? ''} | ${a.verification?.verdicts.map((v) => `${v.agentId} ${v.result}`).join(', ') ?? a.violations.map((v) => v.detail).join('; ')} |`,
      );
    lines.push('', '## Verification', '');
    for (const v of e.verification?.verdicts ?? []) {
      lines.push(`### ${v.agentId}: ${v.result}`, '', v.finding, '');
      if (v.suggestedRevision)
        lines.push(`Suggested revision: ${v.suggestedRevision}`, '');
      for (const ev of v.evidence)
        lines.push(
          `- ${ev.tool}(${JSON.stringify(ev.input)}) -> ${JSON.stringify(ev.output)?.slice(0, 300)}`,
        );
      lines.push('');
    }
    for (const d of e.verification?.didNotRun ?? [])
      lines.push(`- ${d.agentId}: did not run, ${d.reason}`);
    lines.push('');
  }
  return lines.join('\n');
}

export { REQUIRED_FIELDS, library };
