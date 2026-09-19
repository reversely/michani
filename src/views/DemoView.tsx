import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { apiJson } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MeasurementsPanel } from '@/components/demo/MeasurementsPanel';
import {
  attributeDefinitionSchema,
  planSchema,
  specificationSchema,
  type AttributeDefinition,
  type Plan,
  type Specification,
} from '@shared/schemas/library';

// The demo route: one request, the requirements step, the measurements and plan panel, and
// the confirm action. Later checkpoints add the library, drafting, render, and report steps
// to this same page.

const libraryResponse = z.object({
  attributes: z.array(attributeDefinitionSchema),
});

const requirementsResponse = z.object({
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('question'),
      question: z.string(),
      missing: z.array(
        z.object({
          attributeId: z.string(),
          name: z.string(),
          unit: z.string(),
          reason: z.string(),
        }),
      ),
    }),
    z.object({
      kind: z.literal('specification'),
      specification: specificationSchema,
      plan: planSchema,
    }),
  ]),
  elapsedMs: z.number(),
});

const confirmResponse = z.object({ plan: planSchema });

export function DemoView() {
  const { user } = useAuth();
  const [attributes, setAttributes] = useState<AttributeDefinition[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [measurements, setMeasurements] = useState<Record<string, number>>({});
  const [question, setQuestion] = useState<
    z.infer<typeof requirementsResponse>['result'] & { kind: 'question' }
  >();
  const [specification, setSpecification] = useState<Specification>();
  const [plan, setPlan] = useState<Plan>();
  const [busy, setBusy] = useState<'requirements' | 'confirm' | null>(null);
  const [error, setError] = useState<string>();
  const [elapsedMs, setElapsedMs] = useState<number>();

  useEffect(() => {
    apiJson('library', {})
      .then((data) => setAttributes(libraryResponse.parse(data).attributes))
      .catch((e) => setError(String(e)));
  }, []);

  const ensureConversation = useCallback(async () => {
    if (conversationId) return conversationId;
    if (!user) throw new Error('sign in required');
    const id = crypto.randomUUID();
    const { error: insertError } = await supabase.from('conversations').insert([
      {
        id,
        user_id: user.id,
        title: 'Demo: printed part',
        type: 'parametric',
        settings: { model: 'anthropic/claude-sonnet-5', demo: {} },
      },
    ]);
    if (insertError) throw insertError;
    setConversationId(id);
    return id;
  }, [conversationId, user]);

  const runRequirements = useCallback(async () => {
    setBusy('requirements');
    setError(undefined);
    try {
      const id = await ensureConversation();
      // Parse here rather than through apiJson's schema parameter: the record schemas carry
      // defaults, and the explicit parse yields their output type with the defaults applied.
      const r = requirementsResponse.parse(
        await apiJson('demo/requirements', {
          method: 'POST',
          body: JSON.stringify({ conversationId: id, request, measurements }),
        }),
      );
      setElapsedMs(r.elapsedMs);
      if (r.result.kind === 'question') {
        setQuestion(r.result);
        setSpecification(undefined);
        setPlan(undefined);
      } else {
        setQuestion(undefined);
        setSpecification(r.result.specification);
        setPlan(r.result.plan);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [ensureConversation, request, measurements]);

  const confirmPlan = useCallback(async () => {
    if (!conversationId) return;
    setBusy('confirm');
    setError(undefined);
    try {
      const r = confirmResponse.parse(
        await apiJson('demo/confirm-plan', {
          method: 'POST',
          body: JSON.stringify({ conversationId }),
        }),
      );
      setPlan(r.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [conversationId]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 text-adam-text-primary sm:px-6">
      <h1 className="text-xl font-semibold">Printed part from a request</h1>
      <p className="text-sm text-adam-neutral-300">
        Describe the part and the hardware it must fit, with measurements in
        millimetres. The requirements step returns a specification and a plan,
        or asks for any measurement the design still needs.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void runRequirements();
        }}
      >
        <label htmlFor="demo-request" className="text-sm font-medium">
          Request
        </label>
        <Textarea
          id="demo-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={4}
          placeholder="Tweezers 120 mm long with a 3 mm tip, 2 mm thick arms, 12 mm gap, 14 mm wide at the bridge."
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="submit"
            disabled={busy !== null || request.trim().length === 0}
            className="w-full sm:w-auto"
          >
            {busy === 'requirements'
              ? 'Running requirements step'
              : question
                ? 'Send measurements'
                : 'Run requirements step'}
          </Button>
          {elapsedMs !== undefined && (
            <span className="text-xs text-adam-neutral-400">
              Requirements step took {(elapsedMs / 1000).toFixed(1)} s
            </span>
          )}
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {(question || specification || plan) && (
        <MeasurementsPanel
          attributes={attributes}
          question={question}
          measurements={measurements}
          onMeasurementChange={(id, value) =>
            setMeasurements((m) => {
              const next = { ...m };
              if (value === undefined || Number.isNaN(value)) delete next[id];
              else next[id] = value;
              return next;
            })
          }
          specification={specification}
          plan={plan}
          onConfirm={() => void confirmPlan()}
          confirming={busy === 'confirm'}
        />
      )}
    </main>
  );
}
