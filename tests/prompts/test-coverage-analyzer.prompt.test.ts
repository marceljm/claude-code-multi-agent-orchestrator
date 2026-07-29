import { describe, expect, it } from 'vitest';

import {
  TEST_COVERAGE_ANALYZER_PROMPT
} from '../../src/prompts/test-coverage-analyzer.prompt.js';

describe('TEST_COVERAGE_ANALYZER_PROMPT', () => {
  it('defines the test-coverage agent role and responsibilities', () => {
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(
      'Test Coverage Analyzer'
    );
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('test gaps');
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('assertions');
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('edge cases');
  });

  it('instructs the agent to compare production and test code', () => {
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(
      'Compare the changed production code'
    );
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(
      'existing test files'
    );
  });

  it('uses supplied evidence and read-only tools for missing context', () => {
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toMatch(/primary\s+input/);
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('Do not re-read every assigned file');
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('specific missing context item');
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toMatch(/Do\s+not invoke another agent/);
  });

  it('documents every required output field', () => {
    for (const field of [
      'file',
      'hasTests',
      'testFiles',
      'untestedPaths',
      'type',
      'location',
      'priority',
      'reasoning',
      'suggestedTest',
      'coverageEstimate',
      'summary'
    ]) {
      expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(field);
    }
  });

  it('documents the allowed path types and priorities', () => {
    for (const value of [
      'function',
      'class',
      'branch',
      'edge-case',
      'critical',
      'high',
      'medium',
      'low'
    ]) {
      expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(value);
    }
  });

  it('requires JSON-only structured output', () => {
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(
      'Return exactly one JSON array'
    );
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toMatch(/not wrap the array in Markdown/i);
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain(
      'TestCoverageResultSchema'
    );
    expect(TEST_COVERAGE_ANALYZER_PROMPT).toContain('same order as the bundle');
  });
});
