import { z } from 'zod';

// Record schemas for the design library, the component catalogue, and the per-request records.
// Every record is generic: product-specific meaning comes from AttributeDefinitions stored as
// data, so a new part family or hardware type is a data change, not a code change (PRD, Data
// model). All schemas are strict so a misspelt field fails at load time instead of silently
// disappearing.

const id = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase kebab-case id');

export const partClassSchema = z.enum(['A', 'B', 'C']);
export type PartClass = z.infer<typeof partClassSchema>;

export const riskLabelSchema = z.enum(['general', 'needs expert review']);

export const evidenceLevelSchema = z.enum([
  'untested',
  'prototyped',
  'field used',
  'test data published',
  'clinically validated',
]);
export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;

export const attributeDefinitionSchema = z
  .object({
    id,
    name: z.string().min(1),
    dataType: z.enum(['number', 'string', 'boolean']),
    unit: z.string().optional(),
    range: z.object({ min: z.number(), max: z.number() }).optional(),
    options: z.array(z.string()).optional(),
    description: z.string().min(1),
  })
  .strict();
export type AttributeDefinition = z.infer<typeof attributeDefinitionSchema>;

export const attributeValueSchema = z
  .object({
    definitionId: id,
    value: z.union([z.number(), z.string(), z.boolean()]),
    source: z.enum(['user', 'library', 'computed']),
  })
  .strict();
export type AttributeValue = z.infer<typeof attributeValueSchema>;

export const parameterDefinitionSchema = z
  .object({
    id,
    variable: z
      .string()
      .regex(/^[A-Za-z_$][A-Za-z0-9_]*$/, 'OpenSCAD variable name'),
    attributeId: id,
    default: z.number(),
    min: z.number(),
    max: z.number(),
    // Boolean expressions over other parameter ids, evaluated by the parameter limits check.
    constraints: z.array(z.string()).default([]),
  })
  .strict()
  .refine((p) => p.min <= p.max, { message: 'min must not exceed max' })
  .refine((p) => p.default >= p.min && p.default <= p.max, {
    message: 'default must sit inside [min, max]',
  });
export type ParameterDefinition = z.infer<typeof parameterDefinitionSchema>;

export const interfaceFeatureSchema = z
  .object({
    id,
    featureType: z.enum(['hole', 'socket', 'slot', 'face', 'opening', 'edge']),
    attributes: z.array(attributeValueSchema),
    // Position in millimetres relative to the part's origin, when the feature has one.
    position: z.tuple([z.number(), z.number(), z.number()]).optional(),
    // 'plus' means the design dimension must exceed the measured one by the clearance,
    // 'minus' the reverse; 'none' means no clearance applies.
    clearanceRule: z.enum(['plus', 'minus', 'none']).default('none'),
    // The interface feature id on the mating side, when the design declares it.
    matesWith: id.optional(),
  })
  .strict();
export type InterfaceFeature = z.infer<typeof interfaceFeatureSchema>;

export const designEntrySchema = z
  .object({
    id,
    name: z.string().min(1),
    description: z.string().min(1),
    file: z.string().regex(/\.scad$/),
    source: z.enum(['curated', 'generated']),
    licence: z.string().min(1),
    attribution: z.string().min(1),
    partClass: partClassSchema,
    riskLabel: riskLabelSchema,
    evidenceLevel: evidenceLevelSchema,
    parameters: z.array(parameterDefinitionSchema).min(1),
    interfaceFeatures: z.array(interfaceFeatureSchema).default([]),
    attributes: z.array(attributeValueSchema).default([]),
    // Short phrases the library agent matches a request against.
    keywords: z.array(z.string()).default([]),
  })
  .strict();
export type DesignEntry = z.infer<typeof designEntrySchema>;

export const geometrySourceSchema = z
  .object({
    tier: z.literal('nopscadlib'),
    module: z.string().min(1),
    arguments: z.array(z.union([z.number(), z.string()])).default([]),
    licence: z.string().min(1),
    evidenceLevel: evidenceLevelSchema,
  })
  .strict();
export type GeometrySource = z.infer<typeof geometrySourceSchema>;

export const componentRecordSchema = z
  .object({
    id,
    label: z.string().min(1),
    attributes: z.array(attributeValueSchema),
    interfaceFeatures: z.array(interfaceFeatureSchema).default([]),
    // Absent means measurements only: no geometry is modelled for this part.
    geometrySource: geometrySourceSchema.optional(),
    keywords: z.array(z.string()).default([]),
  })
  .strict();
export type ComponentRecord = z.infer<typeof componentRecordSchema>;

// A measured dimension of the part itself, keyed by the design's parameter id because two
// parameters can share one attribute (tweezers have a tip width and a bridge width).
export const partMeasurementSchema = z
  .object({
    parameterId: id,
    value: z.number(),
    source: z.enum(['user', 'library', 'computed']),
  })
  .strict();
export type PartMeasurement = z.infer<typeof partMeasurementSchema>;

export const materialSchema = z
  .object({
    id,
    name: z.string().min(1),
    defaultClearanceMm: z.number(),
    minWallMm: z.number(),
    waterContact: z.boolean(),
    foodContact: z.boolean(),
    outdoor: z.boolean(),
    maxServiceTempC: z.number(),
    notes: z.string(),
  })
  .strict();
export type Material = z.infer<typeof materialSchema>;

// A dimension the person stated before any design was chosen, in the person's own words.
export const statedDimensionSchema = z
  .object({
    name: z.string().min(1),
    value: z.number(),
    unit: z.string().min(1),
  })
  .strict();

export const contactClassSchema = z.enum([
  'none',
  'skin',
  'food',
  'drinking-water',
  'medical',
]);

// The Specification fills in across conversational turns. The fields below `requirements`
// are optional in the record so a partial one can be stored; the engine's completeness
// check (src/engine/session.ts) decides which must be present before a plan exists.
// A section the requirements agent adds while reasoning over the request: what it stated,
// assumed, or found. Sections are context for planning and drafting; only size and material
// gate the session (src/engine/session.ts).
export const specificationSectionSchema = z
  .object({
    heading: z.string().min(1),
    content: z.string().min(1),
    status: z.enum(['stated', 'assumed', 'researched']),
    source: z.string().optional(),
  })
  .strict();
export type SpecificationSection = z.infer<typeof specificationSectionSchema>;

export const sizeMmSchema = z
  .object({
    width: z.number().positive().optional(),
    depth: z.number().positive().optional(),
    height: z.number().positive().optional(),
    note: z.string().optional(),
  })
  .strict();

export const specificationSchema = z
  .object({
    id,
    // One sentence naming the part.
    summary: z.string().optional(),
    // The person's detailed description in their own words: a style reference, colours per
    // component, anything the structured parts cannot hold. Editable on the screen.
    details: z.string().optional(),
    sizeMm: sizeMmSchema.optional(),
    sections: z.array(specificationSectionSchema).default([]),
    requirements: z.array(z.string().min(1)).default([]),
    purpose: z.string().min(1).optional(),
    dimensions: z.array(statedDimensionSchema).default([]),
    material: id.optional(),
    load: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    contactClass: contactClassSchema.optional(),
    hardware: z.enum(['none', 'listed']).optional(),
    // Whether the thing asked for is a printed part at all: a whole ladder is not, its rung
    // caps are. Set by the requirements agent; not-printable keeps the session gathering.
    scope: z.enum(['printable', 'not-printable', 'unclear']).optional(),
    components: z.array(componentRecordSchema).default([]),
    partMeasurements: z.array(partMeasurementSchema).default([]),
    printSettings: z.array(attributeValueSchema).default([]),
  })
  .strict();
export type Specification = z.infer<typeof specificationSchema>;

export const planSchema = z
  .object({
    id,
    function: z.enum(['adaptation', 'generation']),
    candidateDesignId: id.optional(),
    generationBrief: z.string().optional(),
    measurementsNeeded: z.array(
      z.object({ parameterId: id, attributeId: id, unit: z.string() }).strict(),
    ),
    checkIds: z.array(id),
    riskLabel: riskLabelSchema,
    reason: z.string().min(1),
    confirmed: z.boolean().default(false),
  })
  .strict()
  .refine(
    (p) =>
      p.function === 'adaptation' ? !!p.candidateDesignId : !!p.generationBrief,
    {
      message:
        'adaptation needs candidateDesignId; generation needs generationBrief',
    },
  );
export type Plan = z.infer<typeof planSchema>;

export const checkDefinitionSchema = z
  .object({
    id,
    name: z.string().min(1),
    partClasses: z.array(partClassSchema).min(1),
    inputs: z.array(
      z.enum(['parameters', 'design', 'specification', 'mesh', 'buildVolume']),
    ),
  })
  .strict();
export type CheckDefinition = z.infer<typeof checkDefinitionSchema>;

export const checkResultSchema = z
  .object({
    checkId: id,
    result: z.enum(['pass', 'warn', 'fail']),
    finding: z.string().min(1),
    suggestedRevision: z.string().optional(),
    inputsUsed: z.record(z.unknown()),
  })
  .strict();
export type CheckResult = z.infer<typeof checkResultSchema>;
