import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CodeQualityResultJSONSchema, RefactoringSuggestionJSONSchema, ReviewReportJSONSchema, TestCoverageResultJSONSchema } from '../src/types/index.js';
import { toDraft07JsonSchema } from '../src/types/json-schema.js';

type JsonObject = Record<string, unknown>;
function requireObject(value: unknown, description: string): JsonObject {
  expect(value, description).toBeTypeOf('object');
  expect(value, description).not.toBeNull();
  expect(Array.isArray(value), description).toBe(false);
  return value as JsonObject;
}
function requireProperty(schema: JsonObject, propertyName: string): JsonObject {
  const properties = requireObject(schema.properties, `${propertyName} parent properties`);
  return requireObject(properties[propertyName], `property ${propertyName}`);
}

describe('Zod 4 JSON Schema conversion', () => {
  it.each([
    ['code quality', CodeQualityResultJSONSchema],
    ['test coverage', TestCoverageResultJSONSchema],
    ['refactoring', RefactoringSuggestionJSONSchema],
    ['review report', ReviewReportJSONSchema]
  ])('generates a nonempty Draft 7 object schema for %s', (_name, schema) => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(requireObject(schema.properties, 'schema properties')).not.toEqual({});
    expect(schema.required).toBeInstanceOf(Array);
    expect(schema).not.toHaveProperty('definitions');
    expect(schema).not.toHaveProperty('$defs');
  });

  it('keeps native record keywords instead of deleting them globally', () => {
    const dynamicRecord = toDraft07JsonSchema(z.record(z.string(), z.string()));
    expect(dynamicRecord.type).toBe('object');
    expect(dynamicRecord.additionalProperties).toEqual({ type: 'string' });
    expect(dynamicRecord).toHaveProperty('propertyNames');
  });

  it('uses a fixed strict schema for agentVersions', () => {
    const agentVersions = requireProperty(requireProperty(ReviewReportJSONSchema, 'metadata'), 'agentVersions');
    expect(agentVersions).toEqual({
      type: 'object',
      properties: {
        orchestrator: { type: 'string' },
        codeQualityAnalyzer: { type: 'string' },
        testCoverageAnalyzer: { type: 'string' },
        refactoringSuggester: { type: 'string' }
      },
      required: ['orchestrator', 'codeQualityAnalyzer', 'testCoverageAnalyzer', 'refactoringSuggester'],
      additionalProperties: false
    });
  });

  it('does not require propertyNames in the final review schema', () => {
    expect(JSON.stringify(ReviewReportJSONSchema)).not.toContain('"propertyNames"');
  });
});
