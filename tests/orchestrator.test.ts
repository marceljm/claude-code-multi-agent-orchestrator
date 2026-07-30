import {
  afterEach,
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

import { RateLimiter } from '../src/utils/rate-limiter.js';
import type { StructuredLogger } from '../src/utils/logger.js';

function createNoopLogger(): StructuredLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

type RecordedLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error';

interface RecordedLogEntry {
  level: RecordedLogLevel;
  message: string;
  metadata: Record<string, unknown>;
}

function createRecordingLogger(): {
  logger: StructuredLogger;
  entries: RecordedLogEntry[];
} {
  const entries: RecordedLogEntry[] = [];
  const createMethod = (level: RecordedLogLevel) => (
    message: string,
    metadata: Record<string, unknown> = {}
  ): void => {
    entries.push({ level, message, metadata });
  };

  return {
    logger: {
      debug: vi.fn(createMethod('debug')),
      info: vi.fn(createMethod('info')),
      warn: vi.fn(createMethod('warn')),
      error: vi.fn(createMethod('error'))
    },
    entries
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const MODEL = 'claude-sonnet-4-5-20250929';
const PROJECT_ROOT = '/tmp/code-review-project';

type TestPreToolUseHook = (
  input: unknown,
  toolUseId: string,
  context: {
    signal: AbortSignal;
  }
) => Promise<Record<string, unknown>>;

interface ResilientQueryInput {
  options: {
    abortController: AbortController;
    hooks: {
      PreToolUse: Array<{
        hooks: TestPreToolUseHook[];
      }>;
    };
  };
}

async function invokeSpecialistGuard(
  input: ResilientQueryInput,
  agentName: string,
  toolUseId: string
): Promise<Record<string, unknown>> {
  const guard = input.options.hooks.PreToolUse[0]?.hooks[1];
  expect(guard).toBeDefined();
  return guard!(
    {
      hook_event_name: 'PreToolUse',
      session_id: 'resilience-test',
      cwd: PROJECT_ROOT,
      tool_name: 'Task',
      tool_input: {
        subagent_type: agentName
      }
    },
    toolUseId,
    {
      signal: new AbortController().signal
    }
  );
}

function waitForAbort(
  signal: AbortSignal
): Promise<never> {
  return new Promise(
    (_resolve, reject) => {
      const rejectWithReason =
        () => {
          reject(
            signal.reason ??
              new Error(
                'The SDK attempt was aborted.'
              )
          );
        };

      if (signal.aborted) {
        rejectWithReason();
        return;
      }

      signal.addEventListener(
        'abort',
        rejectWithReason,
        {
          once: true
        }
      );
    }
  );
}

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
    logger: overrides.logger ?? createNoopLogger(),
    ...overrides
  });
}

describe('CodeReviewOrchestrator', () => {
  describe('structured lifecycle logging', () => {
    it(
      'uses a 15-minute default review timeout',
      async () => {
        const logging = createRecordingLogger();

        const {
          queryFn
        } = createSuccessfulQueryMock();

        await createOrchestrator(
          queryFn,
          {
            logger: logging.logger
          }
        ).reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        );

        expect(
          logging.entries.find(
            entry =>
              entry.metadata.event ===
              'review.started'
          )
        ).toMatchObject({
          metadata: {
            event:
              'review.started',
            timeoutMs:
              900000
          }
        });
      }
    );

    it(
      'logs the complete successful review lifecycle without source or report bodies',
      async () => {
      const logging = createRecordingLogger();
      const rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000,
        maxConcurrent: 1
      });
      const queryMock = vi.fn((raw: unknown) => {
        const input = raw as ResilientQueryInput;
        return {
          async *[Symbol.asyncIterator]() {
            await invokeSpecialistGuard(input, 'code-quality-analyzer', 'one');
            await invokeSpecialistGuard(input, 'test-coverage-analyzer', 'two');
            await invokeSpecialistGuard(input, 'refactoring-suggester', 'three');
            yield {
              type: 'result',
              subtype: 'success',
              structured_output: createValidReport()
            };
          }
        };
      });

      await createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        { logger: logging.logger, rateLimiter }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);

      expect(logging.entries.map(entry => entry.metadata.event)).toEqual([
        'review.started',
        'review.rate_limit.waiting',
        'review.rate_limit.admitted',
        'review.attempt.started',
        'review.specialist.delegated',
        'review.specialist.delegated',
        'review.specialist.delegated',
        'review.stream.started',
        'review.attempt.completed',
        'review.completed'
      ]);
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.specialist.delegated')
        .map(entry => entry.metadata.agent)).toEqual([
          'code-quality-analyzer',
          'test-coverage-analyzer',
          'refactoring-suggester'
        ]);
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.stream.started'))
        .toHaveLength(1);
      expect(logging.entries.find(entry => entry.metadata.event === 'review.stream.started'))
        .toMatchObject({ metadata: { attempt: 1, messageType: 'result' } });
      expect(logging.entries.find(entry => entry.metadata.event === 'review.completed'))
        .toMatchObject({
          metadata: {
            owner: 'airaamane', repo: 'simple-todo-app', prNumber: 2, model: MODEL,
            totalFiles: 1, overallScore: 70, criticalIssues: 0,
            highPriorityTests: 1, refactoringOpportunities: 1,
            durationMs: expect.any(Number)
          }
        });
      const serializedEntries = JSON.stringify(logging.entries);
      for (const sensitiveText of [
        'structured_output', 'src/todos.ts', 'test-api-key', 'ANTHROPIC_API_KEY',
        'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'tool_input',
        'validateQuery(query)', 'Provide invalid input'
      ]) {
        expect(serializedEntries).not.toContain(sensitiveText);
      }
    });

    it('logs only the first SDK stream message type', async () => {
      const logging = createRecordingLogger();
      const rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000,
        maxConcurrent: 1
      });
      const queryMock = vi.fn(() => createAsyncIterable([
        { type: 'assistant', message: { content: [] } },
        { type: 'user', message: { content: [] } },
        {
          type: 'result',
          subtype: 'success',
          structured_output: createValidReport()
        }
      ]));

      await createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        { logger: logging.logger, rateLimiter }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);

      const streamEntries = logging.entries.filter(
        entry => entry.metadata.event === 'review.stream.started'
      );
      expect(streamEntries).toHaveLength(1);
      expect(streamEntries[0]).toMatchObject({
        level: 'debug',
        metadata: {
          event: 'review.stream.started',
          attempt: 1,
          messageType: 'assistant'
        }
      });
      expect(logging.entries.at(-1)?.metadata.event).toBe('review.completed');
    });

    it('logs safe retry decisions and attempt numbers', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const logging = createRecordingLogger();
      const rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 10000,
        maxConcurrent: 1
      });
      const queryMock = vi.fn()
        .mockImplementationOnce(() => {
          throw new Error(
            'Temporary SDK startup failure. ANTHROPIC_API_KEY=sk-ant-test-secret'
          );
        })
        .mockImplementationOnce(() => createAsyncIterable([
          { type: 'result', subtype: 'success', structured_output: createValidReport() }
        ]));
      const review = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        {
          logger: logging.logger, rateLimiter, maxPreDelegationRetries: 1,
          retryDelayMs: 10, reviewTimeoutMs: 1000
        }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      await vi.runOnlyPendingTimersAsync();
      await expect(review).resolves.toMatchObject({ summary: { totalFiles: 1 } });
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.attempt.started')
        .map(entry => entry.metadata.attempt)).toEqual([1, 2]);
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.attempt.failed'))
        .toHaveLength(1);
      expect(logging.entries.find(entry => entry.metadata.event === 'review.attempt.failed'))
        .toMatchObject({ metadata: {
          event: 'review.attempt.failed', attempt: 1, maxAttempts: 2,
          retryEligible: true, willRetry: true, timedOut: false,
          errorName: 'Error',
          errorMessage: 'Temporary SDK startup failure. ANTHROPIC_API_KEY=[REDACTED]'
        } });
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.rate_limit.waiting'))
        .toHaveLength(1);
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.rate_limit.admitted'))
        .toHaveLength(1);
      expect(logging.entries.at(-1)?.metadata.event).toBe('review.completed');
      expect(
        logging.entries.some(
          entry => entry.metadata.event === 'review.failed'
        )
      ).toBe(false);
      const serializedEntries = JSON.stringify(logging.entries);
      expect(serializedEntries).not.toContain('sk-ant-test-secret');
      expect(serializedEntries).not.toContain(
        'ANTHROPIC_API_KEY=sk-ant-test-secret'
      );
    });
  });
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

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects invalid estimatedTokensPerReview value %s',
      estimatedTokensPerReview => {
        const { queryFn } = createSuccessfulQueryMock();
        expect(() => createOrchestrator(queryFn, { estimatedTokensPerReview })).toThrow('estimatedTokensPerReview');
      }
    );

    it.each([
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ])(
      'rejects invalid reviewTimeoutMs value %s',
      reviewTimeoutMs => {
      const { queryFn } = createSuccessfulQueryMock();
        expect(
          () => createOrchestrator(queryFn, { reviewTimeoutMs })
        ).toThrow('reviewTimeoutMs');
      }
    );

    it.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ])(
      'rejects invalid maxPreDelegationRetries value %s',
      maxPreDelegationRetries => {
      const { queryFn } = createSuccessfulQueryMock();
        expect(
          () => createOrchestrator(queryFn, { maxPreDelegationRetries })
        ).toThrow('maxPreDelegationRetries');
      }
    );

    it.each([
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY
    ])(
      'rejects invalid retryDelayMs value %s',
      retryDelayMs => {
      const { queryFn } = createSuccessfulQueryMock();
        expect(
          () => createOrchestrator(queryFn, { retryDelayMs })
        ).toThrow('retryDelayMs');
      }
    );
  });

  describe('rate-limited review execution', () => {
    it('acquires with the default estimate and releases after success', async () => {
      const { queryFn } = createSuccessfulQueryMock();
      const rateLimiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 5000, maxConcurrent: 2 });
      const acquireSpy = vi.spyOn(rateLimiter, 'acquire');
      const releaseSpy = vi.spyOn(rateLimiter, 'release');
      await createOrchestrator(queryFn, { rateLimiter }).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      expect(acquireSpy).toHaveBeenCalledWith(1000);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(rateLimiter.getStatus()).toMatchObject({ activeRequests: 0, requestsInWindow: 1, tokensInWindow: 1000 });
    });

    it('queues a second review until concurrent capacity is released', async () => {
      let releaseFirst!: () => void;
      const gate = new Promise<void>(resolve => { releaseFirst = resolve; });
      let count = 0;
      const queryMock = vi.fn(() => ({ async *[Symbol.asyncIterator]() { if (++count === 1) await gate; yield { type: 'result', subtype: 'success', structured_output: createValidReport() }; } }));
      const rateLimiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 1000, maxConcurrent: 1 });
      const orchestrator = createOrchestrator(queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>, { rateLimiter, estimatedTokensPerReview: 100 });
      const first = orchestrator.reviewPullRequest('airaamane', 'simple-todo-app', 2);
      await vi.waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1));
      const second = orchestrator.reviewPullRequest('airaamane', 'simple-todo-app', 2);
      await Promise.resolve();
      expect(queryMock).toHaveBeenCalledTimes(1);
      releaseFirst();
      await Promise.all([first, second]);
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(rateLimiter.getStatus()).toMatchObject({ activeRequests: 0, requestsInWindow: 2, tokensInWindow: 200 });
    });

    it('releases the reservation when SDK stream execution fails', async () => {
      const failure = new Error('SDK stream failed.');
      const queryMock = vi.fn(() => ({ async *[Symbol.asyncIterator]() { throw failure; } }));
      const rateLimiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 1000, maxConcurrent: 1 });
      const orchestrator = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        {
          rateLimiter,
          estimatedTokensPerReview: 75,
          maxPreDelegationRetries: 0
        }
      );
      await expect(orchestrator.reviewPullRequest('airaamane', 'simple-todo-app', 2)).rejects.toBe(failure);
      expect(rateLimiter.getStatus()).toMatchObject({ activeRequests: 0, requestsInWindow: 1, tokensInWindow: 75 });
    });

    it('rejects an oversized estimate before invoking the SDK', async () => {
      const { queryFn, mock } = createSuccessfulQueryMock();
      const rateLimiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 100, maxConcurrent: 1 });
      const orchestrator = createOrchestrator(queryFn, { rateLimiter, estimatedTokensPerReview: 101 });
      await expect(orchestrator.reviewPullRequest('airaamane', 'simple-todo-app', 2)).rejects.toMatchObject({ name: 'ReviewError', code: 'RATE_LIMITED' });
      expect(mock).not.toHaveBeenCalled();
      expect(rateLimiter.getStatus()).toMatchObject({ activeRequests: 0, requestsInWindow: 0, tokensInWindow: 0 });
    });
  });

  describe('retry and timeout safety', () => {
    it('uses two retries for three total startup attempts', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 5000,
        maxConcurrent: 1
      });
      const acquireSpy = vi.spyOn(rateLimiter, 'acquire');
      const releaseSpy = vi.spyOn(rateLimiter, 'release');
      let attempts = 0;
      const queryMock = vi.fn(() => {
        attempts += 1;
        if (attempts < 3) throw new Error(`startup ${attempts}`);
        return createAsyncIterable([
          {
            type: 'result',
            subtype: 'success',
            structured_output: createValidReport()
          }
        ]);
      });
      const result = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        {
          rateLimiter,
          retryDelayMs: 1,
          reviewTimeoutMs: 1000
        }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      void result.catch(() => undefined);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(rateLimiter.getStatus().activeRequests).toBe(1);
      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual(createValidReport());
      expect(queryMock).toHaveBeenCalledTimes(3);
      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(rateLimiter.getStatus()).toMatchObject({
        activeRequests: 0,
        requestsInWindow: 1,
        tokensInWindow: 1000
      });
    });

    it('returns RETRY_EXHAUSTED after exactly three startup attempts', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const queryMock = vi.fn(() => { throw new Error('startup'); });
      const result = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        { retryDelayMs: 1 }
      ).reviewPullRequest(
        'airaamane',
        'simple-todo-app',
        2
      );
      void result.catch(() => undefined);
      await vi.runAllTimersAsync();
      await expect(result).rejects.toMatchObject({
        code: 'RETRY_EXHAUSTED',
        metadata: {
          attempts: 3,
          maxRetries: 2
        }
      });
      expect(queryMock).toHaveBeenCalledTimes(3);
    });

    it('aborts and retries a pre-delegation timeout', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const signals: AbortSignal[] = [];
      const queryMock = vi.fn((raw: unknown) => {
        const input = raw as ResilientQueryInput;
        const signal = input.options.abortController.signal;
        signals.push(signal);
        return {
          async *[Symbol.asyncIterator]() {
            await waitForAbort(signal);
          }
        };
      });
      const result = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        {
          maxPreDelegationRetries: 1,
          retryDelayMs: 1,
          reviewTimeoutMs: 5
        }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      void result.catch(() => undefined);
      await vi.runAllTimersAsync();
      await expect(result).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(signals.every(signal => signal.aborted)).toBe(true);
    });

    it('does not retry after a stream message', async () => {
      const failure = new Error('after output');
      const queryMock = vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'assistant' };
          throw failure;
        }
      }));
      await expect(
        createOrchestrator(
          queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>
        ).reviewPullRequest(
          'airaamane',
          'simple-todo-app',
          2
        )
      ).rejects.toBe(failure);
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry after specialist delegation', async () => {
      const failure = new Error('after delegation');
      const queryMock = vi.fn((raw: unknown) => {
        const input = raw as ResilientQueryInput;
        return {
          async *[Symbol.asyncIterator]() {
            await invokeSpecialistGuard(
              input,
              'code-quality-analyzer',
              'id'
            );
            throw failure;
          }
        };
      });
      await expect(
        createOrchestrator(
          queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
          { retryDelayMs: 0 }
        ).reviewPullRequest('airaamane', 'simple-todo-app', 2)
      ).rejects.toBe(failure);
      expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it('aborts but does not retry a timeout after specialist delegation', async () => {
      vi.useFakeTimers();
      const rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 10,
        maxTokensPerMinute: 5000,
        maxConcurrent: 1
      });
      let attemptSignal: AbortSignal | undefined;
      const queryMock = vi.fn((raw: unknown) => {
        const input = raw as ResilientQueryInput;
        attemptSignal = input.options.abortController.signal;
        return {
          async *[Symbol.asyncIterator]() {
            await invokeSpecialistGuard(
              input,
              'code-quality-analyzer',
              'timeout'
            );
            await waitForAbort(
              input.options.abortController.signal
            );
          }
        };
      });
      const result = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        {
          rateLimiter,
          reviewTimeoutMs: 25,
          maxPreDelegationRetries: 2,
          retryDelayMs: 0
        }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      void result.catch(() => undefined);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(25);
      await expect(result).rejects.toMatchObject({
        name: 'ReviewError',
        code: 'AGENT_TIMEOUT',
        metadata: { timeoutMs: 25 }
      });
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(attemptSignal?.aborted).toBe(true);
      expect(rateLimiter.getStatus().activeRequests).toBe(0);
    });

    it('does not retry an unknown-specialist safety violation', async () => {
      vi.useFakeTimers();
      const logging = createRecordingLogger();
      const queryMock = vi.fn((raw: unknown) => {
        const input = raw as ResilientQueryInput;
        const signal = input.options.abortController.signal;
        return {
          async *[Symbol.asyncIterator]() {
            const response = await invokeSpecialistGuard(
              input,
              'unconfigured-analyzer',
              'unknown'
            );
            expect(response).toMatchObject({
              hookSpecificOutput: {
                permissionDecision: 'deny'
              }
            });
            expect(signal.aborted).toBe(true);
            await waitForAbort(signal);
          }
        };
      });
      const result = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        { retryDelayMs: 0, logger: logging.logger }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      void result.catch(() => undefined);
      await expect(result).rejects.toThrow(
        'Unsafe or duplicate specialist delegation detected.'
      );
      expect(queryMock).toHaveBeenCalledTimes(1);
      await vi.runOnlyPendingTimersAsync();
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(logging.entries.filter(entry => entry.metadata.event === 'review.specialist.denied'))
        .toHaveLength(1);
      expect(logging.entries.find(entry => entry.metadata.event === 'review.specialist.denied'))
        .toMatchObject({ metadata: {
          event: 'review.specialist.denied', attempt: 1,
          agent: 'unconfigured-analyzer', reason: 'unknown-specialist'
        } });
      expect(logging.entries.find(entry => entry.metadata.event === 'review.attempt.failed'))
        .toMatchObject({
          metadata: {
            event: 'review.attempt.failed',
            retryEligible: false,
            willRetry: false
          }
        });
      expect(
        logging.entries.filter(
          entry => entry.metadata.event === 'review.failed'
        )
      ).toHaveLength(1);
      const serializedEntries = JSON.stringify(logging.entries);
      for (const sensitiveText of [
        'tool_input', 'structured_output', 'stack', 'ANTHROPIC_API_KEY',
        'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN'
      ]) {
        expect(serializedEntries).not.toContain(sensitiveText);
      }
    });

    it('does not retry a duplicate-specialist safety violation', async () => {
      vi.useFakeTimers();
      const queryMock = vi.fn((raw: unknown) => {
        const input = raw as ResilientQueryInput;
        const signal = input.options.abortController.signal;
        return {
          async *[Symbol.asyncIterator]() {
            const first = await invokeSpecialistGuard(
              input,
              'code-quality-analyzer',
              'first'
            );
            const response = await invokeSpecialistGuard(
              input,
              'code-quality-analyzer',
              'duplicate'
            );
            expect(first).toEqual({});
            expect(response).toMatchObject({
              hookSpecificOutput: {
                permissionDecision: 'deny'
              }
            });
            expect(signal.aborted).toBe(true);
            await waitForAbort(signal);
          }
        };
      });
      const result = createOrchestrator(
        queryMock as unknown as NonNullable<OrchestratorOptions['queryFn']>,
        { retryDelayMs: 0 }
      ).reviewPullRequest('airaamane', 'simple-todo-app', 2);
      void result.catch(() => undefined);
      await expect(result).rejects.toThrow(
        'Unsafe or duplicate specialist delegation detected.'
      );
      expect(queryMock).toHaveBeenCalledTimes(1);
      await vi.runOnlyPendingTimersAsync();
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
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
      const { queryFn, mock } = createQueryMock([
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
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('rejects a stream that ends without a result message', async () => {
      const { queryFn, mock } = createQueryMock([
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
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('rejects an SDK error result', async () => {
      const { queryFn, mock } = createQueryMock([
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
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('rejects structured output that fails ReviewReportSchema', async () => {
      const invalidReport = {
        ...createValidReport(),
        metadata: undefined
      };

      const { queryFn, mock } = createQueryMock([
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
      expect(mock).toHaveBeenCalledTimes(1);
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
