import { describe, expect, it } from 'vitest';

import {
  codeQualityAnalyzer as directCodeQualityAnalyzer
} from '../../src/agents/code-quality-analyzer.js';

import {
  refactoringSuggester as directRefactoringSuggester
} from '../../src/agents/refactoring-suggester.js';

import {
  testCoverageAnalyzer as directTestCoverageAnalyzer
} from '../../src/agents/test-coverage-analyzer.js';

import {
  codeQualityAnalyzer,
  refactoringSuggester,
  testCoverageAnalyzer
} from '../../src/agents/index.js';

describe('subagent exports', () => {
  it('exports the Code Quality Analyzer definition', () => {
    expect(codeQualityAnalyzer).toBe(
      directCodeQualityAnalyzer
    );
  });

  it('exports the Test Coverage Analyzer definition', () => {
    expect(testCoverageAnalyzer).toBe(
      directTestCoverageAnalyzer
    );
  });

  it('exports the Refactoring Suggester definition', () => {
    expect(refactoringSuggester).toBe(
      directRefactoringSuggester
    );
  });

  it('exports three distinct agent definitions', () => {
    expect(codeQualityAnalyzer).not.toBe(
      testCoverageAnalyzer
    );
    expect(codeQualityAnalyzer).not.toBe(
      refactoringSuggester
    );
    expect(testCoverageAnalyzer).not.toBe(
      refactoringSuggester
    );
  });
});
