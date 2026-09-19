import type { Parameter } from '../types';
import type { DesignEntry, ParameterDefinition } from '../schemas/library';

// Turns a proposed set of parameter values into the typed override list the OpenSCAD worker
// accepts, or a list of violations. This is the only path from an agent's numbers to the
// renderer: names must be declared in the DesignEntry, values must be finite numbers, and the
// file body is never edited (PRD R7 and the security acceptance of checkpoint 3).

export type OverrideViolation = {
  parameterId?: string;
  name: string;
  reason:
    | 'undeclared'
    | 'not-a-number'
    | 'below-minimum'
    | 'above-maximum'
    | 'constraint';
  detail: string;
};

export type OverrideResult =
  | { ok: true; params: Parameter[]; values: Record<string, number> }
  | { ok: false; violations: OverrideViolation[] };

const VARIABLE_NAME = /^[A-Za-z_$][A-Za-z0-9_]*$/;

export function validateOverrides(
  design: Pick<DesignEntry, 'parameters'>,
  proposed: Record<string, unknown>,
): OverrideResult {
  const byVariable = new Map<string, ParameterDefinition>();
  const byId = new Map<string, ParameterDefinition>();
  for (const p of design.parameters) {
    byVariable.set(p.variable, p);
    byId.set(p.id, p);
  }

  const violations: OverrideViolation[] = [];
  const values: Record<string, number> = {};

  for (const [name, raw] of Object.entries(proposed)) {
    const def = byVariable.get(name) ?? byId.get(name);
    if (!def || !VARIABLE_NAME.test(def.variable)) {
      violations.push({
        name,
        reason: 'undeclared',
        detail: `"${name}" is not a declared parameter`,
      });
      continue;
    }
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      violations.push({
        parameterId: def.id,
        name,
        reason: 'not-a-number',
        detail: `"${name}" must be a finite number, got ${JSON.stringify(raw)}`,
      });
      continue;
    }
    if (value < def.min) {
      violations.push({
        parameterId: def.id,
        name,
        reason: 'below-minimum',
        detail: `"${name}" = ${value} is below the minimum ${def.min}`,
      });
      continue;
    }
    if (value > def.max) {
      violations.push({
        parameterId: def.id,
        name,
        reason: 'above-maximum',
        detail: `"${name}" = ${value} is above the maximum ${def.max}`,
      });
      continue;
    }
    values[def.variable] = value;
  }

  // Constraint expressions compare parameter ids, e.g. "arm-width >= tip-width". Only the
  // six comparison operators are accepted, and both sides must be parameter ids or numbers,
  // so no expression is ever evaluated as code.
  const resolved: Record<string, number> = {};
  for (const p of design.parameters)
    resolved[p.id] = values[p.variable] ?? p.default;
  for (const p of design.parameters) {
    for (const expr of p.constraints ?? []) {
      const verdict = evaluateConstraint(expr, resolved);
      if (verdict === null) {
        violations.push({
          parameterId: p.id,
          name: p.variable,
          reason: 'constraint',
          detail: `constraint "${expr}" could not be evaluated`,
        });
      } else if (!verdict) {
        violations.push({
          parameterId: p.id,
          name: p.variable,
          reason: 'constraint',
          detail: `constraint "${expr}" fails with ${describe(expr, resolved)}`,
        });
      }
    }
  }

  if (violations.length > 0) return { ok: false, violations };
  const params: Parameter[] = Object.entries(values).map(([name, value]) => ({
    name,
    displayName: name,
    value,
    defaultValue: byVariable.get(name)?.default ?? value,
    type: 'number',
  }));
  return { ok: true, params, values };
}

const CONSTRAINT =
  /^\s*([a-z0-9-]+|\d+(?:\.\d+)?)\s*(<=|>=|==|!=|<|>)\s*([a-z0-9-]+|\d+(?:\.\d+)?)\s*$/;

function term(token: string, resolved: Record<string, number>): number | null {
  if (/^\d/.test(token)) return Number(token);
  return token in resolved ? resolved[token] : null;
}

export function evaluateConstraint(
  expr: string,
  resolved: Record<string, number>,
): boolean | null {
  const m = CONSTRAINT.exec(expr);
  if (!m) return null;
  const left = term(m[1], resolved);
  const right = term(m[3], resolved);
  if (left === null || right === null) return null;
  switch (m[2]) {
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return left < right;
    case '>':
      return left > right;
    default:
      return null;
  }
}

function describe(expr: string, resolved: Record<string, number>): string {
  const m = CONSTRAINT.exec(expr);
  if (!m) return expr;
  return `${m[1]} = ${term(m[1], resolved)}, ${m[3]} = ${term(m[3], resolved)}`;
}
