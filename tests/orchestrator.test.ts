import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  codeQualityAnalyzer,
  refactoringSuggester,
  testCoverageAnalyzer
} from '../src/agents/index.js';

import {
  mcpServersConfig
} from '../src/config/mcp.config.js';

import {
  CodeReviewOrchestrator
} from '../src/orchestrator.js';

import type {
  OrchestratorOptions
} from '../src/orchestrator.js';

import {
  ReviewReportJSONSchema
} from '../src/types/index.js';

import type {
  ReviewReport
} from '../src/types/index.js';

const MODEL = 'claude-sonnet-4-5-20250929';
const PROJECT_ROOT = '/tmp/code-review-project';

function createValidReport(): ReviewReport {
  return {
    pullRequest: {
      owner: 'airaamane',
      repo: 'simple-todo-app',
      number: 2
    },
    fileReviews: [
      {
        file: 'src/todos.ts',
        codeQuality: {
          file: 'src/todos.ts',
          issues: [
            {
              line: 12,
              severity: 'high',
              category: 'bug-risk',
              description: 'The changed branch can return an invalid value.',
              suggestion: 'Validate the branch result before returning it.'
            }
          ],
          overallScore: 70,
          summary: 'One significant correctness risk was identified.'
        },
        testCoverage: {
          file: 'src/todos.ts',
          hasTests: true,
          testFiles: ['tests/todos.test.ts'],
          untestedPaths: [
            {
              type: 'branch',
              location: 'src/todos.ts:10-15',
              priority: 'high',
              reasoning: 'The new failure branch has no test.',
              suggestedTest:
                'Provide invalid input and assert that the expected error is returned.'
            }
          ],
          coverageEstimate: 65,
          summary: 'The main path is tested, but the failure branch is not.'
        },
        refactorings: {
          file: 'src/todos.ts',
          suggestions: [
            {
              type: 'extract-function',
              location: 'src/todos.ts:8-18',
              impact: 'medium',
              description: 'Extract the validation branch.',
              before: 'if (!query) { /* validation and response */ }',
              after: 'validateQuery(query);',
              benefits: 'Improves readability and isolated testability.'
            }
          ],
          summary: 'A focused extraction would simplify the changed function.'
        }
      }
    ],
    summary: {
      totalFiles: 1,
      overallScore: 70,
      criticalIssues: 0,
      highPriorityTests: 1,
      refactoringOpportunities: 1
    },
    recommendations: [
      {
        priority: 'high',
        category: 'correctness',
        description: 'Validate the new search branch and add its missing test.',
        files: ['src/todos.ts']
      }
    ],
    metadata: {
      analyzedAt: '2026-07-27T23:00:00.000Z',
      duration: 1200,
      agentVersions: {
        orchestrator: MODEL,
        codeQualityAnalyzer: MODEL,
        testCoverageAnalyzer: MODEL,
        refactoringSuggester: MODEL
      }
    }
  };
}

function createAsyncIterable(
  messages: unknown[]
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    }
  };
}

function createQueryMock(messages: unknown[]) {
  const mock = vi.fn((_input: unknown) =>
    createAsyncIterable(messages)
  );

  return {
    mock,
    queryFn:
      mock as unknown as NonNullable<OrchestratorOptions['queryFn']>
  };
}

function createSuccessfulQueryMock(
  report: ReviewReport = createValidReport()
) {
  return createQueryMock([
    {
      type: 'result',
      subtype: 'success',
      structured_output: report
    }
  ]);
}

function createOrchestrator(
  queryFn: NonNullable<OrchestratorOptions['queryFn']>,
  overrides: Partial<OrchestratorOptions> = {}
): CodeReviewOrchestrator {
  return new CodeReviewOrchestrator({
    model: MODEL,
    projectRoot: PROJECT_ROOT,
    maxTurns: 50,
    queryFn,
    ...overrides
  });
}

describe('CodeReviewOrchestrator', () => {
  describe('constructor', () => {
    it('rejects a missing model', () => {
      const { queryFn } = createSuccessfulQueryMock();

      expect(() =>
        new CodeReviewOrchestrator({
          model: '',
          projectRoot: PROJECT_ROOT,
          queryFn
        })
      ).toThrow('ANTHROPIC_MODEL');
    });

    it('rejects a missing project root', () => {
      const { queryFn } = createSuccessfulQueryMock();

      expect(() =>
        new CodeReviewOrchestrator({
          model: MODEL,
          projectRoot: '',
          queryFn
        })
      ).toThrow('PROJECT_ROOT');
    });

    it.each([0, -1, 1.5])(
      'rejects the invalid maxTurns value %s',
      maxTurns => {
        const { queryFn } = createSuccessfulQueryMock();

        expect(() =>
          new CodeReviewOrchestrator({
            model: MODEL,
            projectRoot: PROJECT_ROOT,
            maxTurns,
            queryFn
          })
        ).toThrow('maxTurns');
      }
    );
  });

  describe('SDK configuration', () => {
    it('forwards the maximum USD budget to the Agent SDK', async () => {
      const { queryFn, mock } = createSuccessfulQueryMock();
      const orchestrator = createOrchestrator(queryFn, {
        maxTurns: 80,
        maxBudgetUsd: 1.25
      });

      await orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      const call = mock.mock.calls[0]?.[0] as {
        options: {
          maxTurns: number;
          maxBudgetUsd: number;
        };
      };

      expect(call.options.maxTurns).toBe(80);
      expect(call.options.maxBudgetUsd).toBe(1.25);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects invalid maxBudgetUsd value %s',
      maxBudgetUsd => {
        const { queryFn } = createSuccessfulQueryMock();

        expect(() => createOrchestrator(queryFn, {
          maxBudgetUsd
        })).toThrow('maxBudgetUsd');
      }
    );

    it('configures the model, MCP servers, agents, tools, skills, and output schema', async () => {
      const { queryFn, mock } = createSuccessfulQueryMock();
      const orchestrator = createOrchestrator(queryFn);

      await orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      expect(mock).toHaveBeenCalledTimes(1);

      const call = mock.mock.calls[0]?.[0] as {
        prompt: string;
        options: {
          model: string;
          cwd: string;
          maxTurns: number;
          permissionMode: string;
          tools: string[];
          settingSources: string[];
          allowedTools: string[];
          disallowedTools: string[];
          mcpServers: unknown;
          agents: Record<string, unknown>;
          outputFormat: unknown;
        };
      };

      expect(call.options.model).toBe(MODEL);
      expect(call.options.cwd).toBe(PROJECT_ROOT);
      expect(call.options.maxTurns).toBe(50);
      expect(call.options.permissionMode).toBe(
        'bypassPermissions'
      );
      expect(call.options.tools).toEqual([
        'Task'
      ]);
      expect(call.options.settingSources).toEqual([
        'project'
      ]);

      expect(call.options.allowedTools).toEqual([
        'Task',
        'mcp__github__get_pull_request',
        'mcp__github__get_pull_request_files',
        'mcp__github__get_file_contents',
        'mcp__github__search_code',
        'mcp__eslint__lint-files'
      ]);
      expect(call.options.disallowedTools).toEqual([
        'Bash',
        'Write',
        'Edit',
        'WebFetch',
        'WebSearch'
      ]);

      expect(call.options.mcpServers).toBe(
        mcpServersConfig
      );

      expect(Object.keys(call.options.agents)).toEqual([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester'
      ]);

      expect(
        call.options.agents['code-quality-analyzer']
      ).toBe(codeQualityAnalyzer);

      expect(
        call.options.agents['test-coverage-analyzer']
      ).toBe(testCoverageAnalyzer);

      expect(
        call.options.agents['refactoring-suggester']
      ).toBe(refactoringSuggester);

      expect(call.options.outputFormat).toEqual({
        type: 'json_schema',
        schema: ReviewReportJSONSchema
      });
    });

    it(
      'allows each specialist once and denies duplicate delegation',
      async () => {
        const {
          queryFn,
          mock
        } =
          createSuccessfulQueryMock();

        const orchestrator =
          createOrchestrator(
            queryFn
          );

        await orchestrator
          .reviewPullRequest(
            'airaamane',
            'simple-todo-app',
            2
          );

        type TestHook = (
          input: unknown,
          toolUseId: string,
          context: {
            signal:
              AbortSignal;
          }
        ) =>
          Promise<
            Record<string, unknown>
          >;

        const call =
          mock.mock.calls[0]?.[0] as {
            options: {
              abortController: AbortController;
              hooks: {
                PreToolUse:
                  Array<{
                    hooks:
                      TestHook[];
                  }>;

                PostToolUse:
                  Array<{
                    hooks:
                      TestHook[];
                  }>;
              };
            };
          };

        expect(call.options.abortController.signal.aborted).toBe(false);

        const duplicateGuard =
          call.options
            .hooks
            .PreToolUse[0]
            ?.hooks[1];

        expect(
          duplicateGuard
        ).toBeDefined();

        expect(
          call.options.hooks
        ).not.toHaveProperty(
          'PostToolUse'
        );

        const context = {
          signal:
            new AbortController()
              .signal
        };

        const first =
          await duplicateGuard!(
            {
              hook_event_name:
                'PreToolUse',

              session_id:
                'test-session',

              cwd:
                PROJECT_ROOT,

              tool_name:
                'Task',

              tool_input: {
                subagent_type:
                  'code-quality-analyzer'
              }
            },
            'first-code-quality',
            context
          );

        expect(first).toEqual({});

        const duplicate =
          await duplicateGuard!(
            {
              hook_event_name:
                'PreToolUse',

              session_id:
                'test-session',

              cwd:
                PROJECT_ROOT,

              tool_name:
                'Task',

              tool_input: {
                subagent_type:
                  'code-quality-analyzer'
              }
            },
            'duplicate-code-quality',
            context
          );

        expect(
          duplicate
        ).toMatchObject({
          hookSpecificOutput: {
            hookEventName:
              'PreToolUse',

            permissionDecision:
              'deny'
          }
        });

        expect(call.options.abortController.signal.aborted).toBe(true);

        for (
          const agentName
          of [
            'test-coverage-analyzer',
            'refactoring-suggester'
          ]
        ) {
          await expect(
            duplicateGuard!(
              {
                hook_event_name:
                  'PreToolUse',

                session_id:
                  'test-session',

                cwd:
                  PROJECT_ROOT,

                tool_name:
                  'Task',

                tool_input: {
                  subagent_type:
                    agentName
                }
              },
              `first-${agentName}`,
              context
            )
          ).resolves.toEqual({});
        }
      }
    );
    it.each([
      'Bash',
      'bash',
      'BASH',
      'bAsH',
      'Write',
      'write',
      'WRITE',
      'Edit',
      'edit',
      'EDIT'
    ])(
      'denies the write-capable tool name %s case-insensitively',
      async toolName => {
        const {
          queryFn,
          mock
        } = createSuccessfulQueryMock();

        const orchestrator =
          createOrchestrator(queryFn);

        await orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        );

        type TestHook = (
          input: unknown,
          toolUseId: string,
          context: {
            signal: AbortSignal;
          }
        ) => Promise<Record<string, unknown>>;

        const call = mock.mock.calls[0]?.[0] as {
          options: {
            hooks: {
              PreToolUse: Array<{
                hooks: TestHook[];
              }>;
            };
          };
        };

        const hooks =
          call.options.hooks.PreToolUse[0]?.hooks;

        expect(hooks).toBeDefined();

        const context = {
          signal:
            new AbortController().signal
        };

        const results = await Promise.all(
          hooks!.map(hook =>
            hook(
              {
                hook_event_name: 'PreToolUse',
                session_id: 'test-session',
                cwd: PROJECT_ROOT,
                tool_name: toolName,
                tool_input: {
                  command: 'redacted'
                }
              },
              `forbidden-${toolName}`,
              context
            )
          )
        );

        expect(
          results.some(result => {
            const output =
              result.hookSpecificOutput;

            return (
              typeof output === 'object' &&
              output !== null &&
              'permissionDecision' in output &&
              output.permissionDecision === 'deny'
            );
          })
        ).toBe(true);
      }
    );

    it.each([
      'Task',
      'Agent',
      'Read',
      'Grep',
      'Glob',
      'mcp__github__get_pull_request',
      'mcp__eslint__lint-files'
    ])(
      'does not deny the permitted analysis tool %s through the write-tool guard',
      async toolName => {
        const {
          queryFn,
          mock
        } = createSuccessfulQueryMock();

        const orchestrator =
          createOrchestrator(queryFn);

        await orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        );

        type TestHook = (
          input: unknown,
          toolUseId: string,
          context: {
            signal: AbortSignal;
          }
        ) => Promise<Record<string, unknown>>;

        const call = mock.mock.calls[0]?.[0] as {
          options: {
            hooks: {
              PreToolUse: Array<{
                hooks: TestHook[];
              }>;
            };
          };
        };

        const hooks =
          call.options.hooks.PreToolUse[0]?.hooks;

        expect(hooks).toBeDefined();

        const result = await hooks![0]!(
          {
            hook_event_name: 'PreToolUse',
            session_id: 'test-session',
            cwd: PROJECT_ROOT,
            tool_name: toolName,
            tool_input: {}
          },
          `permitted-${toolName}`,
          {
            signal:
              new AbortController().signal
          }
        );

        expect(result).toEqual({});
      }
    );

    it('builds the prompt for the requested pull request and configured model', async () => {
      const { queryFn, mock } = createSuccessfulQueryMock();
      const orchestrator = createOrchestrator(queryFn);

      await orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      const call = mock.mock.calls[0]?.[0] as {
        prompt: string;
      };

      expect(call.prompt).toContain(
        '"owner": "airaamane"'
      );
      expect(call.prompt).toContain(
        '"repo": "simple-todo-app"'
      );
      expect(call.prompt).toContain('"number": 2');
      expect(call.prompt).toContain(MODEL);
    });
  });

  describe('input validation', () => {
    it.each([
      {
        owner: '',
        repo: 'repository',
        prNumber: 1,
        expected: 'owner'
      },
      {
        owner: 'owner',
        repo: '',
        prNumber: 1,
        expected: 'repository'
      },
      {
        owner: 'owner',
        repo: 'repository',
        prNumber: 0,
        expected: 'positive integer'
      },
      {
        owner: 'owner',
        repo: 'repository',
        prNumber: 1.5,
        expected: 'positive integer'
      }
    ])(
      'rejects invalid review input: $expected',
      async ({
        owner,
        repo,
        prNumber,
        expected
      }) => {
        const { queryFn, mock } =
          createSuccessfulQueryMock();

        const orchestrator =
          createOrchestrator(queryFn);

        await expect(
          orchestrator.reviewPullRequest(
            owner,
            repo,
            prNumber
          )
        ).rejects.toThrow(expected);

        expect(mock).not.toHaveBeenCalled();
      }
    );
  });

  describe('result processing', () => {
    it('returns a successful structured report after Zod validation', async () => {
      const report = createValidReport();
      const { queryFn } =
        createSuccessfulQueryMock(report);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).resolves.toEqual(report);
    });

    it('rejects a success result without structured output', async () => {
      const { queryFn } = createQueryMock([
        {
          type: 'result',
          subtype: 'success'
        }
      ]);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'success without structured output'
      );
    });

    it('rejects a stream that ends without a result message', async () => {
      const { queryFn } = createQueryMock([
        {
          type: 'assistant',
          message: {
            content: []
          }
        }
      ]);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'ended without a result message'
      );
    });

    it('rejects an SDK error result', async () => {
      const { queryFn } = createQueryMock([
        {
          type: 'result',
          subtype: 'error_max_turns'
        }
      ]);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow('error_max_turns');
    });

    it('rejects structured output that fails ReviewReportSchema', async () => {
      const invalidReport = {
        ...createValidReport(),
        metadata: undefined
      };

      const { queryFn } = createQueryMock([
        {
          type: 'result',
          subtype: 'success',
          structured_output: invalidReport
        }
      ]);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'ReviewReportSchema validation failed'
      );
    });

    it('formats nested Zod 4 issue paths', async () => {
      const invalidReport = createValidReport();
      invalidReport.fileReviews[0]!.codeQuality.overallScore = 101;
      const { queryFn } = createQueryMock([{ type: 'result', subtype: 'success', structured_output: invalidReport }]);
      const orchestrator = createOrchestrator(queryFn);
      await expect(orchestrator.reviewPullRequest('airaamane', 'simple-todo-app', 2)).rejects.toThrow('fileReviews.0.codeQuality.overallScore');
    });

    it('propagates query transport failures', async () => {
      const mock = vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          throw new Error('transport failed');
        }
      }));

      const queryFn =
        mock as unknown as NonNullable<
          OrchestratorOptions['queryFn']
        >;

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow('transport failed');
    });
  });

  describe('semantic report validation', () => {
    it('rejects a report for a different pull request', async () => {
      const report = createValidReport();
      report.pullRequest.number = 3;

      const { queryFn } =
        createSuccessfulQueryMock(report);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'different pull request'
      );
    });

    it('rejects inconsistent nested file names', async () => {
      const report = createValidReport();

      report.fileReviews[0]!.codeQuality.file =
        'src/other.ts';

      const { queryFn } =
        createSuccessfulQueryMock(report);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'inconsistent file identifiers'
      );
    });

    it('corrects inconsistent summary metrics deterministically', async () => {
      const report = createValidReport();
      report.summary = {
        totalFiles: 999,
        overallScore: 1,
        criticalIssues: 999,
        highPriorityTests: 999,
        refactoringOpportunities: 999
      };

      const { queryFn } =
        createSuccessfulQueryMock(report);

      const orchestrator =
        createOrchestrator(queryFn);

      const result = await orchestrator.reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );

      expect(result.summary).toEqual({
        totalFiles: 1,
        overallScore: 70,
        criticalIssues: 0,
        highPriorityTests: 1,
        refactoringOpportunities: 1
      });
    });

    it('rejects incorrect inherited agent versions', async () => {
      const report = createValidReport();

      report.metadata.agentVersions.codeQualityAnalyzer =
        'another-model';

      const { queryFn } =
        createSuccessfulQueryMock(report);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'inconsistent agent versions'
      );
    });

    it('rejects recommendations that reference unreviewed files', async () => {
      const report = createValidReport();

      report.recommendations[0]!.files = [
        'src/not-reviewed.ts'
      ];

      const { queryFn } =
        createSuccessfulQueryMock(report);

      const orchestrator =
        createOrchestrator(queryFn);

      await expect(
        orchestrator.reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toThrow(
        'unreviewed file'
      );
    });
  });
});
