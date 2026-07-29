import {
  query
} from '@anthropic-ai/claude-agent-sdk';

import type {
  HookCallback,
  PreToolUseHookInput
} from '@anthropic-ai/claude-agent-sdk';

import {
  codeQualityAnalyzer,
  refactoringSuggester,
  testCoverageAnalyzer
} from './agents/index.js';

import {
  mcpServersConfig
} from './config/mcp.config.js';

import {
  buildOrchestratorPrompt
} from './prompts/index.js';

import {
  ErrorCodes,
  isReviewError,
  ReviewError,
  withRetry,
  withTimeout
} from './utils/error-handler.js';

import {
  globalRateLimiter,
  withRateLimit
} from './utils/rate-limiter.js';

import type {
  RateLimiter
} from './utils/rate-limiter.js';

import {
  getStructuredErrorFields,
  logger as defaultLogger
} from './utils/logger.js';

import type {
  StructuredLogger
} from './utils/logger.js';

import {
  ReviewReportJSONSchema,
  ReviewReportSchema
} from './types/index.js';

import type {
  ReviewReport
} from './types/index.js';

type QueryFunction = typeof query;

const DEFAULT_MAX_TURNS = 50;
const DEFAULT_ESTIMATED_TOKENS_PER_REVIEW = 1000;
const DEFAULT_REVIEW_TIMEOUT_MS = 300000;
const DEFAULT_MAX_PRE_DELEGATION_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

const ORCHESTRATOR_TOOLS = [
  'Task'
];

const ALLOWED_TOOLS = [
  'Task',
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__github__search_code',
  'mcp__eslint__lint-files'
];

const DISALLOWED_TOOLS = [
  'Bash',
  'Write',
  'Edit',
  'WebFetch',
  'WebSearch'
];

const FORBIDDEN_WRITE_CAPABLE_TOOLS =
  new Set([
    'bash',
    'write',
    'edit'
  ]);

const SPECIALIZED_AGENT_NAMES =
  new Set([
    'code-quality-analyzer',
    'test-coverage-analyzer',
    'refactoring-suggester'
  ]);

const REQUIRED_AGENT_VERSION_KEYS = [
  'orchestrator',
  'codeQualityAnalyzer',
  'testCoverageAnalyzer',
  'refactoringSuggester'
] as const;

/**
 * Runtime options for the code-review orchestrator.
 *
 * queryFn is injectable so the orchestration boundary can be tested without
 * invoking Claude or starting MCP servers.
 */
export interface OrchestratorOptions {
  model?: string;
  projectRoot?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  queryFn?: QueryFunction;
  /** Process-level admission controller for complete review executions. */
  rateLimiter?: RateLimiter;
  /** Estimated token reservation charged to the limiter for one review. */
  estimatedTokensPerReview?: number;
  reviewTimeoutMs?: number;
  maxPreDelegationRetries?: number;
  retryDelayMs?: number;
  logger?: StructuredLogger;
  onMessage?: (
    message: unknown
  ) => void | Promise<void>;
}

interface PullRequestTarget {
  owner: string;
  repo: string;
  number: number;
}

interface ReviewAttemptState {
  attemptNumber: number;
  abortController: AbortController;
  specialistDelegationStarted: boolean;
  safetyViolationDetected: boolean;
  sawStreamMessage: boolean;
}

type ReviewAttemptOutcome =
  | { status: 'success'; report: ReviewReport }
  | { status: 'terminal-failure'; error: unknown };

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getDelegatedAgentName(
  toolInput:
    Record<string, unknown>
): string | undefined {
  for (
    const key
    of [
      'subagent_type',
      'agent',
      'name'
    ]
  ) {
    const value =
      toolInput[key];

    if (
      typeof value === 'string' &&
      value.trim().length > 0
    ) {
      return value.trim();
    }
  }

  return undefined;
}

function requireNonEmptyString(
  value: string | undefined,
  variableName: string
): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `${variableName} must be configured with a non-empty value.`
    );
  }

  return value.trim();
}

function formatSchemaPathSegment(segment: PropertyKey): string {
  if (typeof segment === 'symbol') return segment.description ?? segment.toString();
  return String(segment);
}

function formatSchemaIssues(
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>
): string {
  return issues
    .map(issue => {
      const path =
        issue.path.length > 0
          ? issue.path.map(formatSchemaPathSegment).join('.')
          : '<root>';

      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

function calculateExpectedSummary(
  report: ReviewReport
): ReviewReport['summary'] {
  const totalFiles = report.fileReviews.length;

  const overallScore =
    totalFiles === 0
      ? 100
      : Math.round(
          report.fileReviews.reduce(
            (sum, review) =>
              sum + review.codeQuality.overallScore,
            0
          ) / totalFiles
        );

  const criticalIssues =
    report.fileReviews.reduce(
      (count, review) =>
        count +
        review.codeQuality.issues.filter(
          issue => issue.severity === 'critical'
        ).length,
      0
    );

  const highPriorityTests =
    report.fileReviews.reduce(
      (count, review) =>
        count +
        review.testCoverage.untestedPaths.filter(
          path =>
            path.priority === 'critical' ||
            path.priority === 'high'
        ).length,
      0
    );

  const refactoringOpportunities =
    report.fileReviews.reduce(
      (count, review) =>
        count + review.refactorings.suggestions.length,
      0
    );

  return {
    totalFiles,
    overallScore,
    criticalIssues,
    highPriorityTests,
    refactoringOpportunities
  };
}

function assertTargetMatches(
  report: ReviewReport,
  target: PullRequestTarget
): void {
  if (
    report.pullRequest.owner !== target.owner ||
    report.pullRequest.repo !== target.repo ||
    report.pullRequest.number !== target.number
  ) {
    throw new Error(
      'Structured review output targets a different pull request.'
    );
  }
}

function assertFileReviewsAreConsistent(
  report: ReviewReport
): void {
  const reviewedFiles = new Set<string>();

  for (const review of report.fileReviews) {
    if (reviewedFiles.has(review.file)) {
      throw new Error(
        `Structured review output contains a duplicate file review: ${review.file}.`
      );
    }

    reviewedFiles.add(review.file);

    if (
      review.codeQuality.file !== review.file ||
      review.testCoverage.file !== review.file ||
      review.refactorings.file !== review.file
    ) {
      throw new Error(
        `Structured review output has inconsistent file identifiers for ${review.file}.`
      );
    }
  }

  for (const recommendation of report.recommendations) {
    for (const file of recommendation.files) {
      if (!reviewedFiles.has(file)) {
        throw new Error(
          `Structured review output recommendation references an unreviewed file: ${file}.`
        );
      }
    }
  }
}

function normalizeSummary(
  report: ReviewReport
): void {
  report.summary = calculateExpectedSummary(report);
}

function assertMetadataIsConsistent(
  report: ReviewReport,
  model: string
): void {
  if (
    !Number.isFinite(report.metadata.duration) ||
    report.metadata.duration < 0
  ) {
    throw new Error(
      'Structured review output has an invalid metadata duration.'
    );
  }

  if (
    Number.isNaN(
      Date.parse(report.metadata.analyzedAt)
    )
  ) {
    throw new Error(
      'Structured review output has an invalid analyzedAt timestamp.'
    );
  }

  const versions = report.metadata.agentVersions;
  const actualKeys = Object.keys(versions).sort();
  const expectedKeys = [
    ...REQUIRED_AGENT_VERSION_KEYS
  ].sort();

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key, index) => key !== expectedKeys[index]
    )
  ) {
    throw new Error(
      'Structured review output has inconsistent agent versions.'
    );
  }

  for (const key of REQUIRED_AGENT_VERSION_KEYS) {
    if (versions[key] !== model) {
      throw new Error(
        'Structured review output has inconsistent agent versions.'
      );
    }
  }
}

function assertSemanticConsistency(
  report: ReviewReport,
  target: PullRequestTarget,
  model: string
): void {
  assertTargetMatches(report, target);
  assertFileReviewsAreConsistent(report);
  normalizeSummary(report);
  assertMetadataIsConsistent(report, model);
}

/**
 * Main Code Review Orchestrator.
 *
 * Coordinates the GitHub and ESLint MCP servers, invokes the three specialized
 * subagents, and validates the final structured report.
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly projectRoot: string;
  private readonly maxTurns: number;
  private readonly maxBudgetUsd?: number;
  private readonly queryFn: QueryFunction;
  private readonly rateLimiter: RateLimiter;
  private readonly estimatedTokensPerReview: number;
  private readonly reviewTimeoutMs: number;
  private readonly maxPreDelegationRetries: number;
  private readonly retryDelayMs: number;
  private readonly onMessage?: (
    message: unknown
  ) => void | Promise<void>;
  private readonly logger: StructuredLogger;

  constructor(
    options: OrchestratorOptions = {}
  ) {
    this.model = requireNonEmptyString(
      options.model ??
        process.env.ANTHROPIC_MODEL,
      'ANTHROPIC_MODEL'
    );

    this.projectRoot = requireNonEmptyString(
      options.projectRoot ??
        process.env.PROJECT_ROOT,
      'PROJECT_ROOT'
    );

    this.maxTurns =
      options.maxTurns ?? DEFAULT_MAX_TURNS;

    if (
      !Number.isInteger(this.maxTurns) ||
      this.maxTurns <= 0
    ) {
      throw new Error(
        'maxTurns must be a positive integer.'
      );
    }

    if (
      options.maxBudgetUsd !== undefined &&
      (
        !Number.isFinite(options.maxBudgetUsd) ||
        options.maxBudgetUsd <= 0
      )
    ) {
      throw new ReviewError(
        'maxBudgetUsd must be a positive finite number.',
        ErrorCodes.INVALID_CONFIG,
        {
          maxBudgetUsd: options.maxBudgetUsd
        }
      );
    }

    this.maxBudgetUsd = options.maxBudgetUsd;

    this.queryFn = options.queryFn ?? query;
    this.logger = options.logger ?? defaultLogger;
    this.rateLimiter = options.rateLimiter ?? globalRateLimiter;
    this.estimatedTokensPerReview =
      options.estimatedTokensPerReview ??
      DEFAULT_ESTIMATED_TOKENS_PER_REVIEW;
    if (
      !Number.isInteger(this.estimatedTokensPerReview) ||
      this.estimatedTokensPerReview <= 0
    ) {
      throw new ReviewError(
        'estimatedTokensPerReview must be a positive integer.',
        ErrorCodes.INVALID_CONFIG,
        {
          estimatedTokensPerReview:
            this.estimatedTokensPerReview
        }
      );
    }
    this.reviewTimeoutMs =
      options.reviewTimeoutMs ??
      DEFAULT_REVIEW_TIMEOUT_MS;
    if (
      !Number.isInteger(this.reviewTimeoutMs) ||
      this.reviewTimeoutMs <= 0
    ) {
      throw new ReviewError(
        'reviewTimeoutMs must be a positive integer.',
        ErrorCodes.INVALID_CONFIG,
        {
          reviewTimeoutMs: this.reviewTimeoutMs
        }
      );
    }
    this.maxPreDelegationRetries =
      options.maxPreDelegationRetries ??
      DEFAULT_MAX_PRE_DELEGATION_RETRIES;
    if (
      !Number.isInteger(this.maxPreDelegationRetries) ||
      this.maxPreDelegationRetries < 0
    ) {
      throw new ReviewError(
        'maxPreDelegationRetries must be a non-negative integer.',
        ErrorCodes.INVALID_CONFIG,
        {
          maxPreDelegationRetries:
            this.maxPreDelegationRetries
        }
      );
    }
    this.retryDelayMs =
      options.retryDelayMs ??
      DEFAULT_RETRY_DELAY_MS;
    if (
      !Number.isFinite(this.retryDelayMs) ||
      this.retryDelayMs < 0
    ) {
      throw new ReviewError(
        'retryDelayMs must be a non-negative finite number.',
        ErrorCodes.INVALID_CONFIG,
        {
          retryDelayMs: this.retryDelayMs
        }
      );
    }
    this.onMessage = options.onMessage;
  }

  /**
   * Reviews one pull request using the three required subagents.
   */
  private async executeReview(
    target: PullRequestTarget,
    attemptState: ReviewAttemptState
  ): Promise<ReviewReport> {
    const abortController =
      attemptState.abortController;
    const prompt = buildOrchestratorPrompt(
      target.owner,
      target.repo,
      target.number,
      this.model,
      this.projectRoot
    );

    const delegatedAgents =
      new Set<string>();

    const denyWriteCapableTools:
      HookCallback = async input => {
        if (
          input.hook_event_name !==
            'PreToolUse'
        ) {
          return {};
        }

        const preToolInput =
          input as PreToolUseHookInput;

        const normalizedToolName =
          preToolInput.tool_name
            .trim()
            .toLowerCase();

        if (
          !FORBIDDEN_WRITE_CAPABLE_TOOLS.has(
            normalizedToolName
          )
        ) {
          return {};
        }

        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              `The ${preToolInput.tool_name} tool is prohibited because this pull-request review must remain read-only.`
          }
        };
      };

    const enforceSingleSpecialistInvocation:
      HookCallback = async input => {
        if (
          input.hook_event_name !==
            'PreToolUse'
        ) {
          return {};
        }

        const preToolInput =
          input as PreToolUseHookInput;

        const normalizedToolName =
          preToolInput.tool_name
            .trim()
            .toLowerCase();

        if (
          normalizedToolName !==
            'task' &&
          normalizedToolName !==
            'agent'
        ) {
          return {};
        }

        const toolInput =
          isRecord(
            preToolInput.tool_input
          )
            ? preToolInput.tool_input
            : {};

        const agentName =
          getDelegatedAgentName(
            toolInput
          );

        if (
          agentName === undefined ||
          !SPECIALIZED_AGENT_NAMES.has(
            agentName
          )
        ) {
          attemptState.safetyViolationDetected = true;
          this.logger.warn('Specialist delegation denied', {
            event: 'review.specialist.denied',
            ...this.getReviewLogContext(target),
            attempt: attemptState.attemptNumber,
            agent: agentName ?? null,
            reason: 'unknown-specialist'
          });
          abortController.abort(
            new Error(
              'Unsafe or duplicate specialist delegation detected.'
            )
          );

          return {
            hookSpecificOutput: {
              hookEventName:
                'PreToolUse',

              permissionDecision:
                'deny',

              permissionDecisionReason:
                'Only the three configured code-review specialists may be delegated.'
            }
          };
        }

        if (
          delegatedAgents.has(
            agentName
          )
        ) {
          attemptState.safetyViolationDetected = true;
          this.logger.warn('Specialist delegation denied', {
            event: 'review.specialist.denied',
            ...this.getReviewLogContext(target),
            attempt: attemptState.attemptNumber,
            agent: agentName,
            reason: 'duplicate-specialist'
          });
          abortController.abort(
            new Error(
              'Unsafe or duplicate specialist delegation detected.'
            )
          );

          return {
            hookSpecificOutput: {
              hookEventName:
                'PreToolUse',

              permissionDecision:
                'deny',

              permissionDecisionReason:
                `${agentName} has already been invoked. Do not retry or invoke a specialist more than once.`
            }
          };
        }

        attemptState.specialistDelegationStarted = true;
        this.logger.info('Specialist delegated', {
          event: 'review.specialist.delegated',
          ...this.getReviewLogContext(target),
          attempt: attemptState.attemptNumber,
          agent: agentName
        });
        delegatedAgents.add(
          agentName
        );

        return {};
      };

    const messageStream = this.queryFn({
      prompt,
      options: {
        model: this.model,
        cwd: this.projectRoot,
        maxTurns: this.maxTurns,
        abortController,

        ...(
          this.maxBudgetUsd === undefined
            ? {}
            : {
              maxBudgetUsd:
                this.maxBudgetUsd
            }
        ),

        /*
         * Required by the course rubric for unattended execution.
         * The prompt and explicitly allowed MCP tools constrain this review to
         * analysis operations.
         */
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,

        /*
         * Restrict built-in tool availability to orchestration delegation.
         * MCP tools remain available through the configured servers below.
         */
        tools: [
          ...ORCHESTRATOR_TOOLS
        ],

        /*
         * Load the repository's .claude/skills/ directory.
         */
        settingSources: [
          'project'
        ],

        allowedTools: [
          ...ALLOWED_TOOLS
        ],

        disallowedTools: [
          ...DISALLOWED_TOOLS
        ],

        hooks: {
          PreToolUse: [
            {
              hooks: [
                denyWriteCapableTools,
                enforceSingleSpecialistInvocation
              ]
            }
          ]
        },

        mcpServers: mcpServersConfig,

        agents: {
          'code-quality-analyzer':
            codeQualityAnalyzer,
          'test-coverage-analyzer':
            testCoverageAnalyzer,
          'refactoring-suggester':
            refactoringSuggester
        },

        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema
        }
      }
    });

    let sawResultMessage = false;
    let structuredOutput: unknown;

    for await (const message of messageStream) {
      if (!attemptState.sawStreamMessage) {
        this.logger.debug('Agent SDK stream started', {
          event: 'review.stream.started',
          ...this.getReviewLogContext(target),
          attempt: attemptState.attemptNumber,
          messageType: message.type
        });
      }
      attemptState.sawStreamMessage = true;
      if (this.onMessage) {
        await this.onMessage(message);
      }

      if (message.type !== 'result') {
        continue;
      }

      sawResultMessage = true;

      if (message.subtype !== 'success') {
        throw new Error(
          `Claude Agent SDK review failed with result subtype: ${message.subtype}.`
        );
      }

      if (
        !('structured_output' in message) ||
        message.structured_output === undefined
      ) {
        throw new Error(
          'Claude Agent SDK returned success without structured output.'
        );
      }

      structuredOutput =
        message.structured_output;
    }

    if (!sawResultMessage) {
      throw new Error(
        'Claude Agent SDK stream ended without a result message.'
      );
    }

    const parsed =
      ReviewReportSchema.safeParse(
        structuredOutput
      );

    if (!parsed.success) {
      throw new Error(
        `ReviewReportSchema validation failed: ${formatSchemaIssues(
          parsed.error.issues
        )}`
      );
    }

    assertSemanticConsistency(
      parsed.data,
      target,
      this.model
    );

    return parsed.data;
  }

  private async executeReviewAttempt(
    target: PullRequestTarget,
    attemptNumber: number
  ): Promise<ReviewAttemptOutcome> {
    const attemptStartedAt = Date.now();
    const maxAttempts = this.maxPreDelegationRetries + 1;
    const attemptState: ReviewAttemptState = {
      attemptNumber,
      abortController:
        new AbortController(),
      specialistDelegationStarted:
        false,
      safetyViolationDetected:
        false,
      sawStreamMessage:
        false
    };
    this.logger.info('Review attempt started', {
      event: 'review.attempt.started',
      ...this.getReviewLogContext(target),
      attempt: attemptNumber,
      maxAttempts,
      timeoutMs: this.reviewTimeoutMs
    });
    try {
      const report = await withTimeout(
        () => this.executeReview(target, attemptState),
        this.reviewTimeoutMs,
        `Pull-request review timed out after ${this.reviewTimeoutMs}ms.`
      );
      this.logger.info('Review attempt completed', {
        event: 'review.attempt.completed',
        ...this.getReviewLogContext(target),
        attempt: attemptNumber,
        maxAttempts,
        durationMs: Date.now() - attemptStartedAt
      });
      return {
        status: 'success',
        report
      };
    } catch (error) {
      if (
        isReviewError(error) &&
        error.code === ErrorCodes.AGENT_TIMEOUT &&
        !attemptState.abortController.signal.aborted
      ) {
        attemptState.abortController.abort(
          error
        );
      }
      const mayRetry =
        !attemptState.specialistDelegationStarted &&
        !attemptState.safetyViolationDetected &&
        !attemptState.sawStreamMessage;
      const timedOut = isReviewError(error) && error.code === ErrorCodes.AGENT_TIMEOUT;
      const willRetry = mayRetry && attemptNumber < maxAttempts;
      this.logger.warn('Review attempt failed', {
        event: 'review.attempt.failed',
        ...this.getReviewLogContext(target),
        attempt: attemptNumber,
        maxAttempts,
        durationMs: Date.now() - attemptStartedAt,
        retryEligible: mayRetry,
        willRetry,
        timedOut,
        ...getStructuredErrorFields(error)
      });
      if (mayRetry) {
        throw error;
      }
      return {
        status: 'terminal-failure',
        error
      };
    }
  }

  private async executeReviewWithResilience(
    target: PullRequestTarget
  ): Promise<ReviewReport> {
    let attemptNumber = 0;
    const executeAttempt = () => {
      attemptNumber += 1;
      return this.executeReviewAttempt(target, attemptNumber);
    };
    const outcome =
      this.maxPreDelegationRetries === 0
        ? await executeAttempt()
        : await withRetry(
          executeAttempt,
          this.maxPreDelegationRetries,
          this.retryDelayMs
        );
    if (outcome.status === 'terminal-failure') {
      throw outcome.error;
    }
    return outcome.report;
  }

  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const normalizedOwner = owner.trim();
    const normalizedRepo = repo.trim();
    if (normalizedOwner.length === 0) throw new Error('Repository owner is required.');
    if (normalizedRepo.length === 0) throw new Error('repository name is required.');
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error('Pull request number must be a positive integer.');
    }
    const target: PullRequestTarget = { owner: normalizedOwner, repo: normalizedRepo, number: prNumber };
    const reviewStartedAt = Date.now();
    const context = this.getReviewLogContext(target);
    this.logger.info('Code review started', {
      event: 'review.started', ...context,
      estimatedTokens: this.estimatedTokensPerReview,
      timeoutMs: this.reviewTimeoutMs,
      maxAttempts: this.maxPreDelegationRetries + 1
    });
    const rateLimitWaitStartedAt = Date.now();
    this.logger.debug('Waiting for review rate-limit admission', {
      event: 'review.rate_limit.waiting', ...context,
      estimatedTokens: this.estimatedTokensPerReview
    });
    try {
      const report = await withRateLimit(this.rateLimiter, async () => {
        this.logger.debug('Review admitted by rate limiter', {
          event: 'review.rate_limit.admitted', ...context,
          waitDurationMs: Date.now() - rateLimitWaitStartedAt
        });
        return this.executeReviewWithResilience(target);
      }, this.estimatedTokensPerReview);
      this.logger.info('Code review completed', {
        event: 'review.completed', ...context,
        durationMs: Date.now() - reviewStartedAt,
        totalFiles: report.summary.totalFiles,
        overallScore: report.summary.overallScore,
        criticalIssues: report.summary.criticalIssues,
        highPriorityTests: report.summary.highPriorityTests,
        refactoringOpportunities: report.summary.refactoringOpportunities
      });
      return report;
    } catch (error) {
      this.logger.error('Code review failed', {
        event: 'review.failed', ...context,
        durationMs: Date.now() - reviewStartedAt,
        ...getStructuredErrorFields(error)
      });
      throw error;
    }
  }

  private getReviewLogContext(
    target: PullRequestTarget
  ): {
    owner: string;
    repo: string;
    prNumber: number;
    model: string;
  } {
    return {
      owner: target.owner,
      repo: target.repo,
      prNumber: target.number,
      model: this.model
    };
  }
}
