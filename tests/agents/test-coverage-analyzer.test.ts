import { describe, expect, it } from 'vitest';

import {
  testCoverageAnalyzer
} from '../../src/agents/test-coverage-analyzer.js';

import {
  TEST_COVERAGE_ANALYZER_PROMPT
} from '../../src/prompts/test-coverage-analyzer.prompt.js';

describe('testCoverageAnalyzer', () => {
  it('uses the specialized test-coverage prompt', () => {
    expect(testCoverageAnalyzer.prompt).toBe(
      TEST_COVERAGE_ANALYZER_PROMPT
    );
  });

  it('inherits the orchestrator model', () => {
    expect(testCoverageAnalyzer.model).toBe('inherit');
  });

  it('has a description that identifies when it should run', () => {
    expect(testCoverageAnalyzer.description).toContain(
      'test coverage'
    );
    for (const text of ['exactly once', 'all assigned changed files', 'one result per file']) expect(testCoverageAnalyzer.description).toContain(text);
  });

  it('has the required read-only analysis and Skill tools', () => {
    expect(testCoverageAnalyzer.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Skill'
    ]);
  });

  it('cannot edit files or execute shell commands', () => {
    expect(testCoverageAnalyzer.tools).not.toContain('Write');
    expect(testCoverageAnalyzer.tools).not.toContain('Edit');
    expect(testCoverageAnalyzer.tools).not.toContain('Bash');
  });
});
