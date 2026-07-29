import { describe, expect, it } from 'vitest';
import { CodeQualityResultJSONSchema, RefactoringSuggestionJSONSchema, ReviewReportJSONSchema, TestCoverageResultJSONSchema } from '../src/types/index.js';
describe('Zod 4 JSON Schema conversion', () => {
  it.each([CodeQualityResultJSONSchema, TestCoverageResultJSONSchema, RefactoringSuggestionJSONSchema, ReviewReportJSONSchema])('generates Draft 7 object schemas', schema => { expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#'); expect(schema.type).toBe('object'); expect(schema.additionalProperties).toBe(false); expect(Object.keys(schema.properties as object)).not.toHaveLength(0); expect(schema.required).toBeInstanceOf(Array); expect(schema).not.toHaveProperty('definitions'); expect(schema).not.toHaveProperty('$defs'); });
  it('represents agentVersions as a string record', () => { const metadata = (ReviewReportJSONSchema.properties as any).metadata; expect(metadata.properties.agentVersions).toEqual({ type: 'object', additionalProperties: { type: 'string' } }); });
  it('requires all ReviewReport properties', () => { expect(ReviewReportJSONSchema.required).toEqual(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata']); });
});
