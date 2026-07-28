import { describe, expect, it } from 'vitest';

import {
  buildOrchestratorPrompt as directBuildOrchestratorPrompt
} from '../../src/prompts/orchestrator.prompt.js';

import {
  CODE_QUALITY_ANALYZER_PROMPT,
  REFACTORING_SUGGESTER_PROMPT,
  TEST_COVERAGE_ANALYZER_PROMPT,
  buildOrchestratorPrompt
} from '../../src/prompts/index.js';

describe('prompt exports', () => {
  it('exports the Code Quality Analyzer prompt', () => {
    expect(typeof CODE_QUALITY_ANALYZER_PROMPT).toBe('string');
    expect(CODE_QUALITY_ANALYZER_PROMPT.length).toBeGreaterThan(0);
  });

  it('exports the Test Coverage Analyzer prompt', () => {
    expect(typeof TEST_COVERAGE_ANALYZER_PROMPT).toBe('string');
    expect(TEST_COVERAGE_ANALYZER_PROMPT.length).toBeGreaterThan(0);
  });

  it('exports the Refactoring Suggester prompt', () => {
    expect(typeof REFACTORING_SUGGESTER_PROMPT).toBe('string');
    expect(REFACTORING_SUGGESTER_PROMPT.length).toBeGreaterThan(0);
  });

  it('exports three distinct specialized prompt values', () => {
    expect(CODE_QUALITY_ANALYZER_PROMPT).not.toBe(
      TEST_COVERAGE_ANALYZER_PROMPT
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).not.toBe(
      REFACTORING_SUGGESTER_PROMPT
    );
    expect(TEST_COVERAGE_ANALYZER_PROMPT).not.toBe(
      REFACTORING_SUGGESTER_PROMPT
    );
  });

  it('exports the orchestrator prompt builder', () => {
    expect(buildOrchestratorPrompt).toBe(
      directBuildOrchestratorPrompt
    );
  });
});
