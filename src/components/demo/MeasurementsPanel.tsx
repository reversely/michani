import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  AttributeDefinition,
  Plan,
  Specification,
} from '@shared/schemas/library';

// Lists each required measurement with its unit and the values supplied so far, shows the
// Plan with its function and reason, and offers the one confirm action that sets the
// confirmed flag (PRD R16, R17). Every string renders as plain text: React escapes it, and
// nothing here uses dangerouslySetInnerHTML.

export type MissingMeasurement = {
  attributeId: string;
  name: string;
  unit: string;
  reason: string;
};

type Props = {
  attributes: AttributeDefinition[];
  question?: { question: string; missing: MissingMeasurement[] };
  measurements: Record<string, number>;
  onMeasurementChange: (attributeId: string, value: number | undefined) => void;
  specification?: Specification;
  plan?: Plan;
  onConfirm: () => void;
  confirming: boolean;
};

export function MeasurementsPanel({
  attributes,
  question,
  measurements,
  onMeasurementChange,
  specification,
  plan,
  onConfirm,
  confirming,
}: Props) {
  const unitOf = (id: string) =>
    attributes.find((a) => a.id === id)?.unit ?? '';
  const nameOf = (id: string) =>
    attributes.find((a) => a.id === id)?.name ?? id;
  const needed: MissingMeasurement[] =
    question?.missing ??
    plan?.measurementsNeeded.map((m) => ({
      attributeId: m.attributeId,
      name: nameOf(m.attributeId),
      unit: m.unit,
      reason: '',
    })) ??
    [];

  return (
    <section
      aria-label="Measurements and plan"
      className="flex w-full max-w-3xl flex-col gap-6 rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-4 text-adam-text-primary sm:p-6"
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Measurements</h2>
        {question ? (
          <p className="text-sm">{question.question}</p>
        ) : (
          <p className="text-sm text-adam-neutral-300">
            {needed.length === 0
              ? 'Every measurement the design needs is in the request.'
              : 'The design still needs these values.'}
          </p>
        )}
        {needed.length > 0 && (
          <ul className="flex flex-col gap-3">
            {needed.map((m) => (
              <li
                key={m.attributeId}
                className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
              >
                <Label
                  htmlFor={`measure-${m.attributeId}`}
                  className="sm:w-48 sm:shrink-0"
                >
                  {m.name}
                  {m.unit ? ` (${m.unit})` : ''}
                </Label>
                <Input
                  id={`measure-${m.attributeId}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  className="sm:w-40"
                  value={measurements[m.attributeId] ?? ''}
                  onChange={(e) =>
                    onMeasurementChange(
                      m.attributeId,
                      e.target.value === ''
                        ? undefined
                        : Number(e.target.value),
                    )
                  }
                />
                {m.reason && (
                  <span className="text-xs text-adam-neutral-400">
                    {m.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {specification && (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Specification</h2>
          <ul className="list-disc pl-5 text-sm">
            {specification.requirements.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            {specification.printSettings.map((v) => (
              <div key={v.definitionId} className="contents">
                <dt className="text-adam-neutral-300">
                  {nameOf(v.definitionId)}
                </dt>
                <dd>
                  {String(v.value)}
                  {unitOf(v.definitionId) ? ` ${unitOf(v.definitionId)}` : ''}
                  {v.source === 'computed' ? ' (default)' : ''}
                </dd>
              </div>
            ))}
          </dl>
          {specification.components.length > 0 && (
            <ul className="text-sm">
              {specification.components.map((c) => (
                <li key={c.id}>
                  {c.label}
                  {c.geometrySource
                    ? `, geometry from NopSCADlib ${c.geometrySource.module}`
                    : ', measurements only, no geometry modelled'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {plan && (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Plan</h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-adam-neutral-300">Function</dt>
            <dd>
              {plan.function === 'adaptation'
                ? `Adapt library design "${plan.candidateDesignId}"`
                : `Generate a new design: ${plan.generationBrief}`}
            </dd>
            <dt className="text-adam-neutral-300">Checks that will run</dt>
            <dd>{plan.checkIds.join(', ')}</dd>
            <dt className="text-adam-neutral-300">Risk label</dt>
            <dd>{plan.riskLabel}</dd>
            <dt className="text-adam-neutral-300">Reason</dt>
            <dd>{plan.reason}</dd>
          </dl>
          {plan.confirmed ? (
            <p className="text-sm" role="status">
              Plan confirmed. The loop can draft the part.
            </p>
          ) : (
            <Button
              type="button"
              onClick={onConfirm}
              disabled={confirming || needed.length > 0}
              className="w-full sm:w-auto"
            >
              {confirming ? 'Confirming' : 'Confirm plan'}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
