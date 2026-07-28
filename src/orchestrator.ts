import {
  query
} from '@anthropic-ai/claude-agent-sdk';

import type {
  HookCallback,
  PostToolUseHookInput,
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
  ReviewError
} from './utils/error-handler.js';

import {
  ReviewReportJSONSchema,
  ReviewReportSchema
} from './types/index.js';

import type {
  ReviewReport
} from './types/index.js';

type QueryFunction = typeof query;

const DEFAULT_MAX_TURNS = 50;

const ORCHESTRATOR_TOOLS = [
  'Skill',
  'Task'
];

const ALLOWED_TOOLS = [
  'Skill',
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
  onMessage?: (
    message: unknown
  ) => void | Promise<void>;
}

interface PullRequestTarget {
  owner: string;
  repo: string;
  number: number;
}

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

function formatSchemaIssues(
  issues: Array<{
    path: Array<string | number>;
    message: string;
  }>
): string {
  return issues
    .map(issue => {
      const path =
        issue.path.length > 0
          ? issue.path.join('.')
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
  private readonly onMessage?: (
    message: unknown
  ) => void | Promise<void>;

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
    this.onMessage = options.onMessage;
  }

  /**
   * Reviews one pull request using the three required subagents.
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const normalizedOwner = owner.trim();
    const normalizedRepo = repo.trim();

    if (normalizedOwner.length === 0) {
      throw new Error(
        'Repository owner is required.'
      );
    }

    if (normalizedRepo.length === 0) {
      throw new Error(
        'repository name is required.'
      );
    }

    if (
      !Number.isInteger(prNumber) ||
      prNumber <= 0
    ) {
      throw new Error(
        'Pull request number must be a positive integer.'
      );
    }

    const target: PullRequestTarget = {
      owner: normalizedOwner,
      repo: normalizedRepo,
      number: prNumber
    };

    const prompt = buildOrchestratorPrompt(
      target.owner,
      target.repo,
      target.number,
      this.model,
      this.projectRoot
    );

    let javascriptBestPracticesLoaded =
      false;

    const delegatedAgents =
      new Set<string>();

    const abortController =
      new AbortController();

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

    const enforceSkillBeforeDelegation:
      HookCallback = async input => {
        if (
          input.hook_event_name !==
            'PreToolUse'
        ) {
          return {};
        }

        const preToolInput =
          input as PreToolUseHookInput;

        const isDelegation =
          preToolInput.tool_name ===
            'Task' ||
          preToolInput.tool_name ===
            'Agent';

        if (
          isDelegation &&
          !javascriptBestPracticesLoaded
        ) {
          return {
            hookSpecificOutput: {
              hookEventName:
                preToolInput.hook_event_name,
              permissionDecision: 'deny',
              permissionDecisionReason:
                'Invoke the javascript-best-practices Skill and wait for its successful completion before invoking any Task or Agent subagent.'
            }
          };
        }

        return {};
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

        /*
         * The existing Skill hook owns the pre-Skill rejection. Do not record an
         * attempted delegation until the required Skill has completed.
         */
        if (
          !javascriptBestPracticesLoaded
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

        delegatedAgents.add(
          agentName
        );

        return {};
      };

    const recordCompletedRequiredSkill:
      HookCallback = async input => {
        if (
          input.hook_event_name !==
            'PostToolUse'
        ) {
          return {};
        }

        const postToolInput =
          input as PostToolUseHookInput;

        if (
          postToolInput.tool_name !==
            'Skill'
        ) {
          return {};
        }

        const toolInput = isRecord(
          postToolInput.tool_input
        )
          ? postToolInput.tool_input
          : {};

        const completedSkill =
          toolInput.skill ??
          toolInput.name;

        if (
          completedSkill ===
            'javascript-best-practices'
        ) {
          javascriptBestPracticesLoaded =
            true;
        }

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
                enforceSkillBeforeDelegation,
                enforceSingleSpecialistInvocation
              ]
            }
          ],
          PostToolUse: [
            {
              hooks: [
                recordCompletedRequiredSkill
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
}
