import { describe, it, expect } from 'vitest';
import {
  validateOverrides,
  evaluateConstraint,
} from '@shared/library/overrides';

const design = {
  parameters: [
    {
      id: 'length',
      variable: 'length',
      attributeId: 'length',
      default: 100,
      min: 60,
      max: 160,
      constraints: [],
    },
    {
      id: 'tip-width',
      variable: 'tip_width',
      attributeId: 'width',
      default: 4,
      min: 2,
      max: 8,
      constraints: [],
    },
    {
      id: 'arm-width',
      variable: 'arm_width',
      attributeId: 'width',
      default: 12,
      min: 8,
      max: 20,
      constraints: ['arm-width >= tip-width'],
    },
  ],
};

describe('override validation', () => {
  it('accepts declared names inside limits and emits typed worker params', () => {
    const r = validateOverrides(design, { length: 90, 'tip-width': 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({ length: 90, tip_width: 3 });
    expect(r.params.map((p) => [p.name, p.value, p.type])).toEqual([
      ['length', 90, 'number'],
      ['tip_width', 3, 'number'],
    ]);
  });
  it('rejects an undeclared name', () => {
    const r = validateOverrides(design, { depth: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.violations[0].reason).toBe('undeclared');
  });
  it('rejects values below the minimum and above the maximum, naming the limit', () => {
    const low = validateOverrides(design, { length: 10 });
    const high = validateOverrides(design, { length: 500 });
    expect(low.ok && high.ok).toBe(false);
    if (low.ok || high.ok) return;
    expect(low.violations[0].detail).toContain('minimum 60');
    expect(high.violations[0].detail).toContain('maximum 160');
  });
  it('rejects NaN, Infinity, strings that are not numbers, and objects', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'abc', { a: 1 }, null, true]) {
      const r = validateOverrides(design, { length: bad });
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.violations[0].reason).toBe('not-a-number');
    }
  });
  it('accepts a numeric string', () => {
    expect(validateOverrides(design, { length: '120' }).ok).toBe(true);
  });
  it('evaluates constraint expressions over parameter ids', () => {
    const fail = validateOverrides(design, { arm_width: 8, tip_width: 8 });
    expect(fail.ok).toBe(true);
    const worse = validateOverrides(design, { arm_width: 8, tip_width: 8.5 });
    expect(worse.ok).toBe(false);
  });
  it('never evaluates a constraint as code', () => {
    expect(evaluateConstraint('process.exit(1)', {})).toBeNull();
    expect(evaluateConstraint('a >= b', { a: 2, b: 1 })).toBe(true);
    expect(evaluateConstraint('a >= 3', { a: 2 })).toBe(false);
    expect(evaluateConstraint('a >= c', { a: 2 })).toBeNull();
  });
});
