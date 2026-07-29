import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

/**
 * Convert a Zod 4 schema to the Draft 7 JSON Schema expected by the
 * Claude Agent SDK structured-output interface.
 *
 * Do not silently remove or rewrite schema keywords here. Callers must model
 * unsupported structures explicitly in their source Zod schemas.
 */
export function toDraft07JsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: 'draft-07' }) as JsonSchema;
}
