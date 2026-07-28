import {
  describe,
  expect,
  it
} from 'vitest';

import {
  codeQualityAnalyzer,
  refactoringSuggester,
  testCoverageAnalyzer
} from '../src/agents/index.js';

import {
  CODE_QUALITY_ANALYZER_PROMPT,
  REFACTORING_SUGGESTER_PROMPT,
  TEST_COVERAGE_ANALYZER_PROMPT,
  buildOrchestratorPrompt
} from '../src/prompts/index.js';

const orchestratorPrompt =
  buildOrchestratorPrompt(
    'airaamane',
    'simple-todo-app',
    2,
    'claude-sonnet-4-5-20250929',
    '/tmp/review'
  );

describe(
  'bounded PR-level specialist delegation',
  () => {
    it(
      'requires exactly one invocation of each specialist for the complete pull request',
      () => {
        expect(
          orchestratorPrompt
        ).toContain(
          'Invoke exactly three specialized Task calls total for the complete pull request.'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'Invoke code-quality-analyzer exactly once.'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'Invoke test-coverage-analyzer exactly once.'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'Invoke refactoring-suggester exactly once.'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'Start all three Task calls in one parallel tool-use batch.'
        );
      }
    );

    it(
      'explicitly prohibits per-file and repeated delegation',
      () => {
        expect(
          orchestratorPrompt
        ).toContain(
          'Do not invoke Task or Agent once per file.'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'Do not invoke any specialized agent more than once.'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'After the three specialist results return, do not call Task or Agent again.'
        );

        expect(
          orchestratorPrompt
        ).not.toContain(
          'Start all three Task invocations for a file in parallel.'
        );
      }
    );

    it(
      'requires one ordered result array from each specialist',
      () => {
        expect(
          orchestratorPrompt
        ).toContain(
          'Each specialist must return exactly one JSON array with one result for every changed file'
        );

        expect(
          orchestratorPrompt
        ).toContain(
          'Reject missing, duplicate, unknown, or incorrectly ordered file results.'
        );
      }
    );

    it.each([
      [
        'code quality',
        CODE_QUALITY_ANALYZER_PROMPT,
        'CodeQualityResultSchema'
      ],
      [
        'test coverage',
        TEST_COVERAGE_ANALYZER_PROMPT,
        'TestCoverageResultSchema'
      ],
      [
        'refactoring',
        REFACTORING_SUGGESTER_PROMPT,
        'RefactoringSuggestionSchema'
      ]
    ])(
      'configures the %s specialist for one PR-level result array',
      (
        _name,
        prompt,
        schemaName
      ) => {
        expect(prompt).toContain(
          'all assigned changed files'
        );

        expect(prompt).toContain(
          'Return exactly one JSON array'
        );

        expect(prompt).toContain(
          'exactly one result for every changed file'
        );

        expect(prompt).toContain(
          schemaName
        );
      }
    );

    it(
      'keeps the Skill only where it is required',
      () => {
        expect(
          codeQualityAnalyzer.tools
        ).toContain('Skill');

        expect(
          testCoverageAnalyzer.tools
        ).not.toContain('Skill');

        expect(
          refactoringSuggester.tools
        ).not.toContain('Skill');

        expect(
          TEST_COVERAGE_ANALYZER_PROMPT
        ).not.toContain(
          'Use the Skill tool'
        );

        expect(
          REFACTORING_SUGGESTER_PROMPT
        ).not.toContain(
          'Use the Skill tool'
        );
      }
    );
  }
);
