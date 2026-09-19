import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiUrl } from '@/services/api';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import type { Parameter } from '@shared/types';
import { LibrarySpace } from '@/views/LibrarySpace';
import '@/engine-ui/tokens.css';

// The workspace (issues #17, #20, #21): a sidebar that keeps sessions, the conversation in
// the centre, and a collapsible rail with the specification, plan, result, and preview.
// No account, no database. Every string renders as plain text. Colours come from the role
// tokens in engine-ui/tokens.css; motion uses transforms and opacity only.

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  at: z.string(),
});
const verdictSchema = z.object({
  agentId: z.string(),
  result: z.enum(['pass', 'warn', 'fail']),
  finding: z.string(),
  suggestedRevision: z.string().optional(),
  evidence: z.array(
    z.object({ tool: z.string(), input: z.unknown(), output: z.unknown() }),
  ),
  steps: z.number(),
  ms: z.number(),
});
const sessionSchema = z.object({
  id: z.string(),
  state: z.string(),
  transcript: z.array(turnSchema),
  specification: z
    .object({
      summary: z.string().optional(),
      details: z.string().optional(),
      sizeMm: z
        .object({
          width: z.number().optional(),
          depth: z.number().optional(),
          height: z.number().optional(),
          note: z.string().optional(),
        })
        .optional(),
      sections: z
        .array(
          z.object({
            heading: z.string(),
            content: z.string(),
            status: z.string(),
            source: z.string().optional(),
          }),
        )
        .default([]),
      material: z.string().optional(),
      dimensions: z
        .array(
          z.object({ name: z.string(), value: z.number(), unit: z.string() }),
        )
        .default([]),
    })
    .passthrough(),
  plan: z
    .object({
      function: z.string(),
      candidateDesignId: z.string().optional(),
      reason: z.string(),
      confirmed: z.boolean(),
      riskLabel: z.string(),
    })
    .passthrough()
    .optional(),
  execution: z
    .object({
      ok: z.boolean(),
      designName: z.string(),
      source: z.string(),
      evidenceLevel: z.string(),
      riskLabel: z.string(),
      values: z.record(z.number()),
      scad: z.string().optional(),
      attempts: z.array(z.object({ attempt: z.number() }).passthrough()),
      verification: z
        .object({
          verdicts: z.array(verdictSchema),
          didNotRun: z.array(
            z.object({ agentId: z.string(), reason: z.string() }),
          ),
        })
        .optional(),
      message: z.string(),
    })
    .optional(),
});
type EngineSession = z.infer<typeof sessionSchema>;
const turnResponse = z.object({
  reply: z.string(),
  session: sessionSchema,
  elapsedMs: z.number(),
});
const summarySchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.string(),
  updatedAt: z.string(),
  turns: z.number(),
  ok: z.boolean().optional(),
  pinned: z.boolean().default(false),
  archived: z.boolean().default(false),
});
type SessionSummary = z.infer<typeof summarySchema>;

// The spaces a part is filed into (issue #22). The state machine decides the first three; the
// person decides the archive. The hue is the status colour the space's rows carry.
type SpaceId = 'progress' | 'ready' | 'attention' | 'archived';
const SPACES: Array<{ id: SpaceId; label: string; hue: string }> = [
  { id: 'progress', label: 'In progress', hue: 'var(--accent)' },
  { id: 'ready', label: 'Ready', hue: 'var(--ok)' },
  { id: 'attention', label: 'Needs attention', hue: 'var(--fail)' },
  { id: 'archived', label: 'Archived', hue: 'var(--ink-meta)' },
];

function spaceOf(s: SessionSummary): SpaceId {
  if (s.archived) return 'archived';
  if (s.state !== 'executed' && s.state !== 'reported') return 'progress';
  return s.ok ? 'ready' : 'attention';
}

// Pinned first, then most recent.
function byPinThenDate(a: SessionSummary, b: SessionSummary): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

type Theme = 'light' | 'dark' | 'system';
const THEME_KEY = 'michani-theme';

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t;
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function sizeText(s: EngineSession['specification']): string {
  if (s.sizeMm) {
    const parts = [
      s.sizeMm.width && `${s.sizeMm.width} wide`,
      s.sizeMm.depth && `${s.sizeMm.depth} deep`,
      s.sizeMm.height && `${s.sizeMm.height} high`,
    ].filter(Boolean);
    return `${parts.join(', ')} mm${s.sizeMm.note ? ` (${s.sizeMm.note})` : ''}`;
  }
  return s.dimensions.map((d) => `${d.name} ${d.value} ${d.unit}`).join(', ');
}

function readView(): 'home' | 'part' | 'library' {
  if (typeof window === 'undefined') return 'home';
  const q = new URLSearchParams(window.location.search);
  if (q.get('view') === 'library') return 'library';
  return q.get('part') ? 'part' : 'home';
}

function readPart(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const id = new URLSearchParams(window.location.search).get('part');
  return id && z.string().uuid().safeParse(id).success ? id : undefined;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATE_LABEL: Record<string, string> = {
  gathering: 'gathering',
  specified: 'specified',
  planned: 'plan ready',
  confirmed: 'running',
  executed: 'done',
  reported: 'done',
};

export function EngineView() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    resolveTheme(readTheme()),
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [session, setSession] = useState<EngineSession>();
  const [draft, setDraft] = useState('');
  const [detailsDraft, setDetailsDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [elapsed, setElapsed] = useState<number>();
  const [railOpen, setRailOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  // The view and the open part live in the address bar too, so a space or a part can be
  // reopened or linked to: ?view=library, ?part=<id>.
  const [view, setView] = useState<'home' | 'part' | 'library'>(() =>
    readView(),
  );
  const [space, setSpace] = useState<SpaceId>('progress');
  const [renaming, setRenaming] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setResolved(resolveTheme(theme));
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage may be unavailable; the choice then lasts for the page only.
    }
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(resolveTheme('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const refreshSessions = useCallback(async () => {
    try {
      const r = await fetch(apiUrl('engine/sessions'));
      const data = (await r.json()) as { sessions: unknown[] };
      setSessions(data.sessions.map((s) => summarySchema.parse(s)));
    } catch {
      // The list is a convenience; a failed fetch leaves it as it was.
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = '';
    if (view === 'library') url.searchParams.set('view', 'library');
    if (view === 'part' && session) url.searchParams.set('part', sessionId);
    window.history.replaceState(null, '', url);
  }, [view, session, sessionId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [session?.transcript.length, busy]);

  const openSession = useCallback(async (id: string) => {
    setError(undefined);
    setNavOpen(false);
    try {
      const r = await fetch(
        apiUrl(`engine/session?id=${encodeURIComponent(id)}`),
      );
      const data = (await r.json()) as { session: unknown };
      setSession(sessionSchema.parse(data.session));
      setSessionId(id);
      setView('part');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const id = readPart();
    if (id) void openSession(id);
  }, [openSession]);

  const newSession = useCallback(() => {
    setSession(undefined);
    setSessionId(crypto.randomUUID());
    setDraft('');
    setError(undefined);
    setElapsed(undefined);
    setNavOpen(false);
    setView('part');
  }, []);

  // Files a part: pin, rename, or archive. The list refreshes from the server so the row
  // moves to its new space with the saved values, never with optimistic ones.
  const file = useCallback(
    async (
      id: string,
      workspace: { pinned?: boolean; title?: string; archived?: boolean },
    ) => {
      setError(undefined);
      try {
        const r = await fetch(apiUrl('engine/session'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, workspace }),
        });
        if (!r.ok) throw new Error('The change could not be saved');
        await refreshSessions();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshSessions],
  );

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || busy) return;
      setBusy(true);
      setError(undefined);
      setDraft('');
      setSession(
        (s) =>
          s && {
            ...s,
            transcript: [
              ...s.transcript,
              { role: 'user', text, at: new Date().toISOString() },
            ],
          },
      );
      try {
        const response = await fetch(apiUrl('engine/turn'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message: text }),
        });
        const data: unknown = await response.json();
        if (!response.ok) {
          const d = data as { error?: string; message?: string };
          throw new Error(
            d.message
              ? `The assistant's answer could not be used (${d.message.slice(0, 200)}). Send your message again.`
              : `The turn failed (${d.error ?? response.status}). Send your message again.`,
          );
        }
        const r = turnResponse.parse(data);
        setSession(r.session);
        setElapsed(r.elapsedMs);
        void refreshSessions();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId, refreshSessions],
  );

  const spec = session?.specification;
  const exec = session?.execution;
  const params: Parameter[] | undefined = exec?.ok
    ? Object.entries(exec.values).map(([name, value]) => ({
        name,
        displayName: name,
        value,
        defaultValue: value,
        type: 'number' as const,
      }))
    : undefined;

  const bySpace = SPACES.reduce<Record<SpaceId, SessionSummary[]>>(
    (acc, sp) => {
      acc[sp.id] = sessions
        .filter((s) => spaceOf(s) === sp.id)
        .sort(byPinThenDate);
      return acc;
    },
    { progress: [], ready: [], attention: [], archived: [] },
  );
  const inSpace = bySpace[space];
  const current = sessions.find((s) => s.id === sessionId);

  const surface = {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
  } as const;
  const card = {
    background: 'var(--field)',
    border: '1px solid var(--line)',
  } as const;

  return (
    <div
      className="ws flex min-h-full w-full flex-col lg:h-full lg:flex-row"
      data-theme={resolved}
      style={{ background: 'var(--field)', color: 'var(--ink)' }}
    >
      <button
        type="button"
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
        className="ws-press fixed left-3 top-3 z-30 rounded-md px-3 py-2 text-sm lg:hidden"
        style={{ ...surface, boxShadow: 'var(--shadow)' }}
        onClick={() => setNavOpen((v) => !v)}
      >
        Menu
      </button>
      <nav
        aria-label="Workspace"
        className={`ws-move fixed inset-y-0 left-0 z-20 flex w-72 shrink-0 flex-col gap-4 overflow-y-auto p-4 lg:static lg:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--line)',
        }}
      >
        <div className="flex items-center justify-between pt-10 lg:pt-0">
          <p className="text-base font-semibold">michani</p>
          <span
            className="rounded-full px-2 py-0.5 text-xs"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            engine
          </span>
        </div>
        <button
          type="button"
          onClick={newSession}
          className="ws-press rounded-md px-3 py-2 text-left text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          New part
        </button>
        <ul className="flex flex-col gap-0.5 text-sm" aria-label="Spaces">
          <li>
            <button
              type="button"
              onClick={() => {
                setView('home');
                setNavOpen(false);
              }}
              aria-current={view === 'home' ? 'page' : undefined}
              className="ws-press flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left"
              style={{
                background:
                  view === 'home' ? 'var(--surface-2)' : 'transparent',
                color: 'var(--ink)',
              }}
            >
              Home
            </button>
          </li>
          {SPACES.map((sp) => (
            <li key={sp.id}>
              <button
                type="button"
                onClick={() => setSpace(sp.id)}
                aria-pressed={space === sp.id}
                className="ws-press flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left"
                style={{
                  background:
                    space === sp.id ? 'var(--surface-2)' : 'transparent',
                  color: 'var(--ink)',
                }}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: sp.hue }}
                  />
                  {sp.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--ink-meta)' }}>
                  {bySpace[sp.id].length}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div
          className="flex flex-1 flex-col gap-1 border-t pt-3 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          {inSpace.length === 0 && (
            <p className="px-3" style={{ color: 'var(--ink-meta)' }}>
              {space === 'progress'
                ? 'No part in progress'
                : `Nothing in ${SPACES.find((sp) => sp.id === space)!.label.toLowerCase()}`}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {inSpace.map((s) => {
              const open = s.id === sessionId && view === 'part';
              return (
                <li key={s.id} className="ws-enter">
                  {renaming === s.id ? (
                    <input
                      autoFocus
                      aria-label="Part name"
                      defaultValue={s.title}
                      maxLength={80}
                      className="w-full rounded-md px-3 py-2 text-sm outline-none"
                      style={{
                        background: 'var(--surface-2)',
                        color: 'var(--ink)',
                        border: '1px solid var(--accent)',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setRenaming(undefined);
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      onBlur={(e) => {
                        const title = e.currentTarget.value.trim();
                        setRenaming(undefined);
                        if (title && title !== s.title)
                          void file(s.id, { title });
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void openSession(s.id)}
                      aria-current={open ? 'true' : undefined}
                      className="ws-press w-full rounded-md px-3 py-2 text-left"
                      style={{
                        background: open ? 'var(--accent-soft)' : 'transparent',
                        color: 'var(--ink)',
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="block flex-1 truncate">
                          {s.title || 'Untitled part'}
                        </span>
                        {s.pinned && (
                          <span
                            className="rounded px-1 text-[10px] uppercase tracking-wide"
                            style={{
                              background: 'var(--surface-2)',
                              color: 'var(--ink-meta)',
                            }}
                          >
                            pinned
                          </span>
                        )}
                      </span>
                      <span
                        className="block text-xs"
                        style={{ color: 'var(--ink-meta)' }}
                      >
                        {STATE_LABEL[s.state] ?? s.state},{' '}
                        {dayLabel(s.updatedAt)}
                      </span>
                    </button>
                  )}
                  {open && renaming !== s.id && (
                    <div
                      className="ws-enter flex gap-1 px-2 pb-1 pt-0.5 text-xs"
                      aria-label="Part actions"
                    >
                      {(
                        [
                          [s.pinned ? 'Unpin' : 'Pin', { pinned: !s.pinned }],
                          ['Rename', undefined],
                          [
                            s.archived ? 'Restore' : 'Archive',
                            { archived: !s.archived },
                          ],
                        ] as Array<
                          [
                            string,
                            (
                              | { pinned?: boolean; archived?: boolean }
                              | undefined
                            ),
                          ]
                        >
                      ).map(([label, patch]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() =>
                            patch ? void file(s.id, patch) : setRenaming(s.id)
                          }
                          className="ws-press rounded px-2 py-1"
                          style={{
                            background: 'var(--surface-2)',
                            color: 'var(--ink-dim)',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div
          className="flex flex-col gap-2 border-t pt-3 text-sm"
          style={{ borderColor: 'var(--line)' }}
        >
          <button
            type="button"
            onClick={() => {
              setView('library');
              setNavOpen(false);
            }}
            aria-current={view === 'library' ? 'page' : undefined}
            className="ws-press rounded-md px-3 py-2 text-left"
            style={{
              background:
                view === 'library' ? 'var(--surface-2)' : 'transparent',
              color: 'var(--ink-dim)',
            }}
          >
            Library
          </button>
          <div className="flex items-center justify-between px-3 py-1">
            <span style={{ color: 'var(--ink-dim)' }}>Theme</span>
            <div
              role="group"
              aria-label="Theme"
              className="flex gap-1 rounded-md p-0.5"
              style={{ background: 'var(--surface-2)' }}
            >
              {(['light', 'system', 'dark'] as Theme[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={theme === t}
                  onClick={() => setTheme(t)}
                  className="ws-press rounded px-2 py-1 text-xs"
                  style={{
                    background: theme === t ? 'var(--surface)' : 'transparent',
                    color: theme === t ? 'var(--ink)' : 'var(--ink-meta)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-10 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      {view === 'library' ? (
        <LibrarySpace />
      ) : view === 'home' ? (
        <main
          aria-label="Overview"
          className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-14 lg:px-8 lg:pt-6"
        >
          <div className="ws-enter flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">Workspace</h1>
              <p className="text-sm" style={{ color: 'var(--ink-meta)' }}>
                {sessions.length} part{sessions.length === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={newSession}
              className="ws-press rounded-md px-3 py-2 text-sm font-medium"
              style={{
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
              }}
            >
              New part
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SPACES.map((sp, i) => (
              <section
                key={sp.id}
                aria-label={sp.label}
                className="ws-enter flex flex-col gap-2 rounded-lg p-4 text-sm"
                style={{
                  ...surface,
                  borderTop: `3px solid ${sp.hue}`,
                  animationDelay: `${i * 40}ms`,
                }}
              >
                <div className="flex items-baseline justify-between">
                  <h2 className="font-semibold">{sp.label}</h2>
                  <span className="text-2xl font-semibold tabular-nums">
                    {bySpace[sp.id].length}
                  </span>
                </div>
                {bySpace[sp.id].length === 0 ? (
                  <p style={{ color: 'var(--ink-meta)' }}>
                    {sp.id === 'progress'
                      ? 'Describe a part to start one'
                      : 'Nothing here yet'}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {bySpace[sp.id].slice(0, 3).map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => void openSession(s.id)}
                          className="ws-press w-full rounded-md px-2 py-1.5 text-left"
                          style={{ background: 'var(--field)' }}
                        >
                          <span className="block truncate">
                            {s.title || 'Untitled part'}
                          </span>
                          <span
                            className="block text-xs"
                            style={{ color: 'var(--ink-meta)' }}
                          >
                            {STATE_LABEL[s.state] ?? s.state},{' '}
                            {dayLabel(s.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {bySpace[sp.id].length > 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSpace(sp.id);
                      setNavOpen(true);
                    }}
                    className="ws-press self-start rounded px-2 py-1 text-xs"
                    style={{ color: 'var(--accent)' }}
                  >
                    All {bySpace[sp.id].length}
                  </button>
                )}
              </section>
            ))}
          </div>
          {error && (
            <p
              role="alert"
              className="ws-enter text-sm"
              style={{ color: 'var(--fail)' }}
            >
              {error}
            </p>
          )}
        </main>
      ) : (
        <>
          <section
            aria-label="Conversation"
            className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0"
            style={{ background: 'var(--field)' }}
          >
            <header
              className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">
                  {current?.title || spec?.summary || 'New part'}
                </h1>
                <p className="text-xs" style={{ color: 'var(--ink-meta)' }}>
                  {session
                    ? (STATE_LABEL[session.state] ?? session.state)
                    : 'new session'}
                  {elapsed !== undefined
                    ? `, last turn ${(elapsed / 1000).toFixed(1)} s`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                aria-pressed={railOpen}
                onClick={() => setRailOpen((v) => !v)}
                className="ws-press shrink-0 rounded-md px-3 py-1.5 text-sm"
                style={{ ...surface, color: 'var(--ink-dim)' }}
              >
                {railOpen ? 'Hide details' : 'Show details'}
              </button>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4 text-sm lg:px-6">
              {!session && (
                <p
                  className="ws-enter max-w-xl"
                  style={{ color: 'var(--ink-dim)' }}
                >
                  Describe the part you need, in your own words. The assistant
                  reasons over it, looks up references, states its assumptions,
                  proposes a plan, and after you confirm it drafts, renders, and
                  verifies the part.
                </p>
              )}
              {session?.transcript.map((t, i) => (
                <p
                  key={`${i}-${t.at}`}
                  className={`ws-enter max-w-[42rem] rounded-lg px-3 py-2 ${t.role === 'user' ? 'self-end' : 'self-start'}`}
                  style={{
                    background:
                      t.role === 'user'
                        ? 'var(--bubble-person)'
                        : 'var(--bubble-assistant)',
                    border:
                      t.role === 'user'
                        ? '1px solid transparent'
                        : '1px solid var(--line)',
                  }}
                >
                  {t.text}
                </p>
              ))}
              {busy && (
                <p
                  className="ws-enter self-start px-3 py-2"
                  style={{ color: 'var(--ink-meta)' }}
                >
                  Working
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="ws-enter"
                  style={{ color: 'var(--fail)' }}
                >
                  {error}
                </p>
              )}
              <div ref={endRef} />
            </div>
            <form
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-end lg:px-6"
              style={{
                borderTop: '1px solid var(--line)',
                background: 'var(--surface)',
              }}
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <label htmlFor="engine-message" className="sr-only">
                Message
              </label>
              <textarea
                id="engine-message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                className="min-h-[3rem] flex-1 resize-y rounded-md px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                }}
                placeholder={
                  session?.state === 'planned'
                    ? 'Type yes to confirm the plan, or say what to change'
                    : 'Describe the part'
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <div className="flex gap-2">
                {session?.state === 'planned' && !busy && (
                  <button
                    type="button"
                    onClick={() => void send('yes')}
                    className="ws-press rounded-md px-3 py-2 text-sm"
                    style={{
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                    }}
                  >
                    Confirm plan
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy || draft.trim().length === 0}
                  className="ws-press rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--accent-ink)',
                  }}
                >
                  Send
                </button>
              </div>
            </form>
          </section>

          <aside
            aria-label="Specification and results"
            aria-hidden={!railOpen}
            className={`ws-move flex-col gap-4 overflow-y-auto ${railOpen ? 'flex w-full shrink-0 p-4 lg:w-[26rem]' : 'hidden w-0 p-0 opacity-0'}`}
            style={{
              background: 'var(--surface)',
              borderTop: '1px solid var(--line)',
            }}
          >
            <section className="rounded-lg p-4 text-sm" style={card}>
              <h2 className="mb-2 font-semibold">Specification</h2>
              {spec?.summary && <p className="mb-2">{spec.summary}</p>}
              <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1">
                <dt style={{ color: 'var(--ink-meta)' }}>Size</dt>
                <dd
                  style={{
                    color:
                      spec && sizeText(spec) ? 'var(--ink)' : 'var(--ink-meta)',
                  }}
                >
                  {spec && sizeText(spec) ? sizeText(spec) : 'not yet known'}
                </dd>
                <dt style={{ color: 'var(--ink-meta)' }}>Material</dt>
                <dd
                  style={{
                    color: spec?.material ? 'var(--ink)' : 'var(--ink-meta)',
                  }}
                >
                  {spec?.material ?? 'not yet known'}
                </dd>
              </dl>
              <label
                htmlFor="engine-details"
                className="mt-3 block"
                style={{ color: 'var(--ink-meta)' }}
              >
                Details, in your words
              </label>
              <textarea
                id="engine-details"
                value={detailsDraft ?? spec?.details ?? ''}
                onChange={(e) => setDetailsDraft(e.target.value)}
                onBlur={() => {
                  if (
                    detailsDraft !== undefined &&
                    detailsDraft.trim() &&
                    detailsDraft !== spec?.details
                  )
                    void send(`Details: ${detailsDraft.trim()}`);
                  setDetailsDraft(undefined);
                }}
                rows={3}
                className="mt-1 w-full resize-y rounded-md px-3 py-2 text-sm outline-none"
                style={{
                  background: 'var(--surface-2)',
                  color: 'var(--ink)',
                  border: '1px solid var(--line)',
                }}
                placeholder="A style reference, colours per part, how it is used"
              />
              {spec && spec.sections.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {spec.sections.map((sec, i) => (
                    <li key={i} className="ws-enter">
                      <p>
                        <span className="font-medium">{sec.heading}</span>{' '}
                        <span
                          className="rounded px-1.5 py-0.5 text-xs"
                          style={{
                            background: 'var(--surface-2)',
                            color: 'var(--ink-meta)',
                          }}
                        >
                          {sec.status}
                        </span>
                      </p>
                      <p style={{ color: 'var(--ink-dim)' }}>{sec.content}</p>
                      {sec.source && (
                        <p
                          className="text-xs"
                          style={{ color: 'var(--ink-meta)' }}
                        >
                          {sec.source}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {session?.plan && (
              <section className="ws-enter rounded-lg p-4 text-sm" style={card}>
                <h2 className="mb-2 font-semibold">
                  Plan{session.plan.confirmed ? ' (confirmed)' : ''}
                </h2>
                <p>
                  {session.plan.function === 'adaptation'
                    ? `Adapt library design "${session.plan.candidateDesignId}".`
                    : 'Generate a new design.'}{' '}
                  Risk label: {session.plan.riskLabel}.
                </p>
                <p style={{ color: 'var(--ink-dim)' }}>{session.plan.reason}</p>
              </section>
            )}

            {exec && (
              <section className="ws-enter rounded-lg p-4 text-sm" style={card}>
                <h2 className="mb-2 font-semibold">Result</h2>
                <p>{exec.message}</p>
                <p style={{ color: 'var(--ink-dim)' }}>
                  {exec.designName} ({exec.source}, evidence level{' '}
                  {exec.evidenceLevel}, risk label {exec.riskLabel}),{' '}
                  {exec.attempts.length} attempt
                  {exec.attempts.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-2 flex flex-col gap-2">
                  {exec.verification?.verdicts.map((v) => (
                    <li key={v.agentId}>
                      <p>
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                          style={{
                            background:
                              v.result === 'fail'
                                ? 'var(--fail)'
                                : v.result === 'warn'
                                  ? 'var(--warn)'
                                  : 'var(--ok)',
                          }}
                          aria-hidden
                        />
                        {v.agentId}: {v.result}. {v.finding}
                        {v.suggestedRevision
                          ? ` Suggested revision: ${v.suggestedRevision}`
                          : ''}
                      </p>
                      <details
                        className="text-xs"
                        style={{ color: 'var(--ink-meta)' }}
                      >
                        <summary>
                          {v.evidence.length} tool call
                          {v.evidence.length === 1 ? '' : 's'} in {v.steps}{' '}
                          steps
                        </summary>
                        <ul className="list-disc pl-5">
                          {v.evidence.map((ev, i) => (
                            <li key={i}>
                              {ev.tool}:{' '}
                              {JSON.stringify(ev.output)?.slice(0, 240)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                  {exec.verification?.didNotRun.map((d) => (
                    <li key={d.agentId} style={{ color: 'var(--ink-meta)' }}>
                      {d.agentId}: did not run, {d.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {exec?.ok && exec.scad && params && (
              <section className="ws-enter rounded-lg p-2" style={card}>
                <div className="h-[340px] w-full overflow-hidden rounded-md">
                  <OpenSCADPreview
                    scadCode={exec.scad}
                    params={params}
                    color="#c8541f"
                  />
                </div>
              </section>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
