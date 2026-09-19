import { z } from 'zod';
import {
  planSchema,
  specificationSchema,
  type Plan,
  type Specification,
} from '@shared/schemas/library';

// The engine's session: the state machine every front end talks to (issue #11). Transitions
// are enforced here in code; no agent output can move a session to a state it has not earned.

export const SESSION_STATES = [
  'gathering',
  'specified',
  'planned',
  'confirmed',
  'executed',
  'reported',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const turnSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string(),
    at: z.string(),
  })
  .strict();
export type Turn = z.infer<typeof turnSchema>;

export const sessionSchema = z
  .object({
    id: z.string().uuid(),
    state: z.enum(SESSION_STATES),
    transcript: z.array(turnSchema).default([]),
    specification: specificationSchema,
    plan: planSchema.optional(),
    // Opaque results from later states (loop outcome, report); typed by their producers.
    execution: z.unknown().optional(),
    report: z.unknown().optional(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;

export function newSession(id: string): Session {
  return sessionSchema.parse({
    id,
    state: 'gathering',
    transcript: [],
    specification: { id: `spec-${id}` },
  });
}

// Which fields a Specification must carry before the session may leave gathering. Kept as
// data so the list can grow without touching the state machine.
export type RequiredField = {
  id: string;
  label: string;
  present: (s: Specification) => boolean;
  ask: string;
};

export const REQUIRED_FIELDS: RequiredField[] = [
  {
    id: 'purpose',
    label: 'purpose',
    present: (s) => !!s.purpose,
    ask: 'What is the part for, and who uses it?',
  },
  {
    id: 'dimensions',
    label: 'dimensions',
    present: (s) => s.dimensions.length > 0 || s.partMeasurements.length > 0,
    ask: 'What are its main dimensions, in millimetres?',
  },
  {
    id: 'material',
    label: 'material',
    present: (s) => !!s.material,
    ask: 'Which filament will it be printed in (PLA, PETG, ABS, TPU, nylon)?',
  },
  {
    id: 'hardware',
    label: 'hardware it must fit',
    present: (s) => s.hardware === 'none' || s.components.length > 0,
    ask: 'Does it have to fit any existing hardware? If so, what are its measurements?',
  },
  {
    id: 'load',
    label: 'load',
    present: (s) => !!s.load,
    ask: 'What load or force will it carry, and how often?',
  },
  {
    id: 'environment',
    label: 'environment',
    present: (s) => !!s.environment,
    ask: 'Where will it live: indoors, outdoors, wet, hot?',
  },
];

export function missingFields(s: Specification): RequiredField[] {
  return REQUIRED_FIELDS.filter((f) => !f.present(s));
}

export function isComplete(s: Specification): boolean {
  return missingFields(s).length === 0;
}

const ORDER: SessionState[] = [...SESSION_STATES];

export class TransitionError extends Error {
  constructor(from: SessionState, to: SessionState, reason: string) {
    super(`cannot move from ${from} to ${to}: ${reason}`);
  }
}

// Advances by exactly one state, checking the precondition for the target state.
export function advance(session: Session, to: SessionState): Session {
  const from = session.state;
  if (ORDER.indexOf(to) !== ORDER.indexOf(from) + 1) {
    throw new TransitionError(from, to, 'states advance one at a time');
  }
  if (to === 'specified' && !isComplete(session.specification)) {
    throw new TransitionError(
      from,
      to,
      `specification is missing ${missingFields(session.specification)
        .map((f) => f.label)
        .join(', ')}`,
    );
  }
  if (to === 'planned' && !session.plan)
    throw new TransitionError(from, to, 'no plan');
  if (to === 'confirmed' && !session.plan?.confirmed)
    throw new TransitionError(from, to, 'plan not confirmed');
  if (to === 'executed' && session.execution === undefined)
    throw new TransitionError(from, to, 'no execution result');
  if (to === 'reported' && session.report === undefined)
    throw new TransitionError(from, to, 'no report');
  return { ...session, state: to };
}

export function addTurn(
  session: Session,
  role: Turn['role'],
  text: string,
  at = new Date(),
): Session {
  return {
    ...session,
    transcript: [...session.transcript, { role, text, at: at.toISOString() }],
  };
}

// One gathering turn: the caller supplies an extractor (the requirements agent in #13, or a
// scripted one in tests) that reads the transcript and returns the updated Specification.
export type Extractor = (
  session: Session,
) => Promise<Specification | { specification: Specification; reply?: string }>;

export type TurnResult = { session: Session; reply: string };

export async function gatherTurn(
  session: Session,
  message: string,
  extract: Extractor,
): Promise<TurnResult> {
  if (session.state !== 'gathering')
    throw new TransitionError(session.state, 'gathering', 'not gathering');
  let next = addTurn(session, 'user', message);
  const extracted = await extract(next);
  const specification = specificationSchema.parse(
    'specification' in extracted ? extracted.specification : extracted,
  );
  const agentReply = 'specification' in extracted ? extracted.reply : undefined;
  next = { ...next, specification };
  const missing = missingFields(specification);
  const lastAssistant = [...next.transcript]
    .reverse()
    .find((t) => t.role === 'assistant')?.text;
  if (specification.scope === 'not-printable') {
    // Not a printed part: stay in gathering and let the agent's reply steer to printable parts.
    // A reply repeated verbatim is replaced, so an insistent person still gets a new sentence.
    const proposed =
      agentReply ??
      'That is not a part a desktop printer can produce as one piece. Which printable component of it do you need?';
    const reply =
      proposed === lastAssistant
        ? `I can only produce components of it, not the whole thing. Name the component you need, for example the parts I listed, and give its rough size.`
        : proposed;
    return { session: addTurn(next, 'assistant', reply), reply };
  }
  if (missing.length === 0) {
    const reply =
      'I have everything needed for a specification. Next I choose a design and propose a plan.';
    next = advance(addTurn(next, 'assistant', reply), 'specified');
    return { session: next, reply };
  }
  const canned = missing
    .slice(0, 2)
    .map((f) => f.ask)
    .join(' ');
  // The agent's reply wins; the template is the fallback; neither is repeated verbatim.
  const proposed = agentReply ?? canned;
  const reply =
    proposed === lastAssistant
      ? `${proposed} If you are unsure, say so and I will propose typical values.`
      : proposed;
  return { session: addTurn(next, 'assistant', reply), reply };
}

export function setPlan(session: Session, plan: Plan): Session {
  if (session.state !== 'specified')
    throw new TransitionError(
      session.state,
      'planned',
      'specification not complete',
    );
  return advance(
    { ...session, plan: planSchema.parse({ ...plan, confirmed: false }) },
    'planned',
  );
}

// The only way a plan becomes confirmed: a person's action relayed by the front end.
export function confirmPlan(session: Session): Session {
  if (session.state !== 'planned' || !session.plan)
    throw new TransitionError(session.state, 'confirmed', 'no plan to confirm');
  return advance(
    { ...session, plan: { ...session.plan, confirmed: true } },
    'confirmed',
  );
}
