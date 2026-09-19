import { describe, it, expect } from 'vitest';
import {
  attributeDefinitionSchema,
  designEntrySchema,
  parameterDefinitionSchema,
  planSchema,
  componentRecordSchema,
} from '@shared/schemas/library';

const param = {
  id: 'length',
  variable: 'length',
  attributeId: 'length',
  default: 100,
  min: 60,
  max: 160,
};
const design = {
  id: 'tweezers',
  name: 'Tweezers',
  description: 'x',
  file: 'design.scad',
  source: 'curated',
  licence: 'CC0-1.0',
  attribution: 'demo',
  partClass: 'A',
  riskLabel: 'general',
  evidenceLevel: 'untested',
  parameters: [param],
};

describe('record schemas', () => {
  it('accepts a valid design entry and fills defaults', () => {
    const parsed = designEntrySchema.parse(design);
    expect(parsed.interfaceFeatures).toEqual([]);
    expect(parsed.parameters[0].constraints).toEqual([]);
  });
  it('rejects a missing required field', () => {
    const { licence: _licence, ...noLicence } = design;
    expect(designEntrySchema.safeParse(noLicence).success).toBe(false);
  });
  it('rejects a wrong data type', () => {
    expect(
      parameterDefinitionSchema.safeParse({ ...param, default: '100' }).success,
    ).toBe(false);
  });
  it('rejects an unknown field because records are strict', () => {
    expect(
      designEntrySchema.safeParse({ ...design, colour: 'red' }).success,
    ).toBe(false);
  });
  it('rejects a limit where minimum exceeds maximum', () => {
    expect(
      parameterDefinitionSchema.safeParse({ ...param, min: 200 }).success,
    ).toBe(false);
  });
  it('rejects a default outside its limits', () => {
    expect(
      parameterDefinitionSchema.safeParse({ ...param, default: 10 }).success,
    ).toBe(false);
  });
  it('rejects an attribute definition with an unknown data type', () => {
    expect(
      attributeDefinitionSchema.safeParse({
        id: 'x',
        name: 'x',
        dataType: 'date',
        description: 'x',
      }).success,
    ).toBe(false);
  });
  it('requires a candidate design for adaptation and a brief for generation', () => {
    const base = {
      id: 'plan-1',
      measurementsNeeded: [],
      checkIds: [],
      riskLabel: 'general',
      reason: 'r',
    };
    expect(
      planSchema.safeParse({ ...base, function: 'adaptation' }).success,
    ).toBe(false);
    expect(
      planSchema.safeParse({
        ...base,
        function: 'adaptation',
        candidateDesignId: 'tweezers',
      }).success,
    ).toBe(true);
    expect(
      planSchema.safeParse({ ...base, function: 'generation' }).success,
    ).toBe(false);
    expect(
      planSchema.safeParse({
        ...base,
        function: 'generation',
        generationBrief: 'a clip',
      }).success,
    ).toBe(true);
  });
  it('accepts a component with no geometry source as measurements only', () => {
    const parsed = componentRecordSchema.parse({
      id: 'pipe',
      label: 'Pipe',
      attributes: [],
    });
    expect(parsed.geometrySource).toBeUndefined();
  });
});
