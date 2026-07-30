import {
  describe,
  expect,
  it
} from 'vitest';

import {
  readFile
} from 'node:fs/promises';

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

const architectureDecisionUrl =
  new URL(
    '../docs/architecture/0001-pr-level-specialist-batching.md',
    import.meta.url
  );

const readmeUrl =
  new URL(
    '../README.md',
    import.meta.url
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
      'gives every specialist read-only Skill access',
      () => {
        expect(
          codeQualityAnalyzer.tools
        ).toContain('Skill');

        expect(
          testCoverageAnalyzer.tools
        ).toContain('Skill');

        expect(
          refactoringSuggester.tools
        ).toContain('Skill');

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

    it(
      'records PR-level batching as the accepted architecture decision',
      async () => {
        const decision =
          await readFile(
            architectureDecisionUrl,
            'utf8'
          );

        expect(decision).toContain('# ADR 0001: Preserve PR-level specialist batching');
        expect(decision).toContain('Status: Accepted');
        expect(decision).toContain('The implementation uses exactly three specialist Task calls for the complete pull request.');
        expect(decision).toContain('The literal per-file Task fan-out alternative is rejected.');
        expect(decision).toContain('3 × F');
        expect(decision).toContain('intentional deviation from the literal invocation topology');
        expect(decision).toContain('Every changed file still receives all three required analyses.');
        expect(decision).toContain('Revisit this decision');
      }
    );

    it(
      'treats the public per-file requirement as an analytical coverage invariant',
      () => {
        expect(orchestratorPrompt).toContain('Treat the requirement that all three analyses cover every changed file as an output-coverage invariant.');
        expect(orchestratorPrompt).toContain('It does not authorize separate Task calls for each file.');
        expect(orchestratorPrompt).toContain('Each of the three PR-level specialists must return one result for every changed file.');
        expect(orchestratorPrompt).toContain('Invoke exactly three specialized Task calls total for the complete pull request.');
        expect(orchestratorPrompt).toContain('Do not invoke Task or Agent once per file.');
      }
    );

    it(
      'documents the specification interpretation and links the architecture decision',
      async () => {
        const readme =
          await readFile(
            readmeUrl,
            'utf8'
          );

        expect(readme).toContain('### Delegation topology decision');
        expect(readme).toContain('three PR-level Task calls');
        expect(readme).toContain('one result for every changed file');
        expect(readme).toContain('3 × changed-file-count');
        expect(readme).toContain('intentional deviation from the specification’s literal per-file invocation topology');
        expect(readme).toContain('docs/architecture/0001-pr-level-specialist-batching.md');
      }
    );
  }
);
