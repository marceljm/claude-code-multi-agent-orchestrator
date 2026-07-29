import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

/** Convert a Zod 4 schema to Draft 7 JSON Schema for the Agent SDK. */
export function toDraft07JsonSchema(schema: z.ZodType): JsonSchema {
  const result = z.toJSONSchema(schema, { target: 'draft-07' }) as JsonSchema;
  const strip = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(strip); return; }
    const object = value as Record<string, unknown>;
    delete object.propertyNames;
    Object.values(object).forEach(strip);
  };
  strip(result);
  return result;
}
