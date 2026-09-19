import { z } from 'zod';

// Seen live with Claude Sonnet 5 on two different agents: when it fills a tool input whose
// first array field is empty or short, it sometimes serialises the whole answer (or just that
// array) into the field as a JSON string. The SDK validates tool output before our code runs,
// so the schema handed to the model tolerates a string there, and `unwrapSerialisedField`
// restores the real answer before the strict parse.

export function tolerantToolSchema<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  field: keyof T & string,
  required: Array<keyof T & string> = [],
) {
  const shape = schema.shape;
  const fieldSchema = shape[field] as z.ZodTypeAny;
  const extension: Record<string, z.ZodTypeAny> = {
    [field]: z.union([fieldSchema, z.string()]).optional(),
  };
  for (const key of required)
    extension[key] = (shape[key] as z.ZodTypeAny).optional();
  return schema.extend(extension);
}

export function unwrapSerialisedField(output: unknown, field: string): unknown {
  if (!output || typeof output !== 'object' || !(field in output))
    return output;
  const inner = (output as Record<string, unknown>)[field];
  if (typeof inner !== 'string') return output;
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return output;
  }
  if (Array.isArray(parsed)) return { ...output, [field]: parsed };
  // A whole answer serialised into the field: it may legitimately omit the field itself.
  if (parsed && typeof parsed === 'object') return parsed;
  return output;
}
