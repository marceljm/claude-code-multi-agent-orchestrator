import 'dotenv/config';

import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';

import {
  execFile
} from 'node:child_process';

import {
  tmpdir
} from 'node:os';

import {
  join
} from 'node:path';

import {
  promisify
} from 'node:util';

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  CodeReviewOrchestrator
} from '../../src/orchestrator.js';

import {
  ReviewReportSchema
} from '../../src/types/index.js';

import type {
  ReviewReport
} from '../../src/types/index.js';

const execFileAsync = promisify(execFile);

const LIVE =
  process.env.RUN_LIVE_INTEGRATION === '1';

const TARGET = {
  owner: 'airaamane',
  repo: 'simple-todo-app',
  number: 1
} as const;

const REQUIRED_AGENTS = [
  'code-quality-analyzer',
  'test-coverage-analyzer',
  'refactoring-suggester'
] as const;

interface ToolUseRecord {
  id?: string;
  name: string;
  input: Record<string, unknown>;
  parentToolUseId?: string;
  messageIndex?: number;
  messageType?: string;
  nested: boolean;
}

interface ToolUseContext {
  parentToolUseId?: string;
  messageIndex?: number;
  messageType?: string;
  nested: boolean;
}

interface SanitizedToolUseRecord {
  id: string | null;
  name: string;
  messageIndex: number | null;
  messageType: string | null;
  parentToolUseId: string | null;
  nested: boolean;
  inputKeys: string[];
  delegatedAgent: string | null;
  command: string | null;
}

interface DiagnosticState {
  target: typeof TARGET;
  elapsedMs: number;
  messageCount: number;
  toolUseCount: number;
  toolNames: string[];
  githubTools: string[];
  eslintTools: string[];
  invokedAgents: string[];
  skillNames: string[];
  toolUseTrace: SanitizedToolUseRecord[];
  nestedMessageObserved: boolean;
  lastMessageType: string;
  lastMessageSubtype?: string;
  updatedAt: string;
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

function requireEnvironmentVariable(
  variableName: string
): string {
  const value =
    process.env[variableName]?.trim();

  if (!value) {
    throw new Error(
      `${variableName} is required for the live integration test.`
    );
  }

  return value;
}

function collectToolUses(
  value: unknown,
  context: ToolUseContext,
  seen = new Set<unknown>()
): ToolUseRecord[] {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return [];
    }

    seen.add(value);

    return value.flatMap(child =>
      collectToolUses(child, context, seen)
    );
  }

  if (
    !isRecord(value) ||
    seen.has(value)
  ) {
    return [];
  }

  seen.add(value);

  const toolUses: ToolUseRecord[] = [];

  if (
    value.type === 'tool_use' &&
    typeof value.name === 'string'
  ) {
    toolUses.push({
      id:
        typeof value.id === 'string'
          ? value.id
          : undefined,
      name: value.name,
      input: isRecord(value.input)
        ? value.input
        : {},
      parentToolUseId:
        context.parentToolUseId,
      messageIndex:
        context.messageIndex,
      messageType:
        context.messageType,
      nested: context.nested
    });
  }

  for (const child of Object.values(value)) {
    toolUses.push(
      ...collectToolUses(child, context, seen)
    );
  }

  return toolUses;
}

function getAssistantContent(
  message: unknown
): unknown[] {
  if (
    !isRecord(message) ||
    !isRecord(message.message) ||
    !Array.isArray(message.message.content)
  ) {
    return [];
  }

  return message.message.content;
}

function isDelegationTool(
  toolName: string
): boolean {
  return (
    toolName === 'Task' ||
    toolName === 'Agent'
  );
}

function getDelegatedAgentsFromMessage(
  message: unknown
): string[] {
  const delegatedAgents: string[] = [];

  for (
    const block
    of getAssistantContent(message)
  ) {
    if (
      !isRecord(block) ||
      block.type !== 'tool_use' ||
      typeof block.name !== 'string' ||
      !isDelegationTool(block.name)
    ) {
      continue;
    }

    const agentName =
      getSubagentName({
        name: block.name,
        input: isRecord(block.input)
          ? block.input
          : {},
        nested: false
      });

    if (agentName) {
      delegatedAgents.push(agentName);
    }
  }

  return delegatedAgents;
}

function hasParallelDelegationBatch(
  messages: unknown[]
): boolean {
  const delegatedAgents =
    new Set<string>();

  let delegationSequenceStarted =
    false;

  for (const message of messages) {
    const messageAgents =
      getDelegatedAgentsFromMessage(
        message
      );

    if (messageAgents.length === 0) {
      if (delegationSequenceStarted) {
        delegatedAgents.clear();
        delegationSequenceStarted =
          false;
      }

      continue;
    }

    delegationSequenceStarted = true;

    for (
      const agentName
      of messageAgents
    ) {
      delegatedAgents.add(agentName);
    }

    if (
      REQUIRED_AGENTS.every(
        agentName =>
          delegatedAgents.has(agentName)
      )
    ) {
      return true;
    }
  }

  return false;
}

describe('parallel delegation detection', () => {
  it('recognizes consecutive Task and Agent delegation events', () => {
    expect(
      hasParallelDelegationBatch([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Task',
                input: {
                  subagent_type:
                    'code-quality-analyzer'
                }
              }
            ]
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Agent',
                input: {
                  agent:
                    'test-coverage-analyzer'
                }
              }
            ]
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Task',
                input: {
                  subagent_type:
                    'refactoring-suggester'
                }
              }
            ]
          }
        }
      ])
    ).toBe(true);
  });

  it('rejects a delegation sequence interrupted by a nested message', () => {
    expect(
      hasParallelDelegationBatch([
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Task',
                input: {
                  subagent_type:
                    'code-quality-analyzer'
                }
              }
            ]
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Task',
                input: {
                  subagent_type:
                    'test-coverage-analyzer'
                }
              }
            ]
          }
        },
        {
          type: 'user',
          parent_tool_use_id: 'task-1',
          message: {
            content: []
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Task',
                input: {
                  subagent_type:
                    'refactoring-suggester'
                }
              }
            ]
          }
        }
      ])
    ).toBe(false);
  });
});

function getStringInput(
  toolUse: ToolUseRecord,
  keys: string[]
): string | undefined {
  if (!isRecord(toolUse.input)) {
    return undefined;
  }

  for (const key of keys) {
    const value = toolUse.input[key];

    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function getSubagentName(
  toolUse: ToolUseRecord
): string | undefined {
  if (!isDelegationTool(toolUse.name)) {
    return undefined;
  }

  return getStringInput(
    toolUse,
    [
      'subagent_type',
      'agent',
      'name'
    ]
  );
}

function getSkillName(
  toolUse: ToolUseRecord
): string | undefined {
  if (toolUse.name !== 'Skill') {
    return undefined;
  }

  return getStringInput(
    toolUse,
    [
      'skill',
      'name'
    ]
  );
}

function getMessageType(
  message: unknown
): string {
  if (
    isRecord(message) &&
    typeof message.type === 'string'
  ) {
    return message.type;
  }

  return 'unknown';
}

function getMessageSubtype(
  message: unknown
): string | undefined {
  if (
    isRecord(message) &&
    typeof message.subtype === 'string'
  ) {
    return message.subtype;
  }

  return undefined;
}

function isNestedMessage(
  message: unknown
): boolean {
  return (
    isRecord(message) &&
    typeof message.parent_tool_use_id === 'string'
  );
}

function getParentToolUseId(
  message: unknown
): string | undefined {
  if (
    isRecord(message) &&
    typeof message.parent_tool_use_id === 'string'
  ) {
    return message.parent_tool_use_id;
  }

  return undefined;
}

function sanitizeCommand(
  value: unknown
): string | null {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return null;
  }

  const command = value.trim();

  const suspiciousPatterns = [
    /ANTHROPIC_API_KEY/i,
    /GITHUB_TOKEN/i,
    /Authorization/i,
    /Bearer\s+/i,
    /sk-ant-/i,
    /ghp_/i,
    /github_pat_/i,
    /[A-Za-z0-9+/]{40,}={0,2}/
  ];

  if (
    suspiciousPatterns.some(
      pattern => pattern.test(command)
    )
  ) {
    return '<redacted>';
  }

  return command.length > 500
    ? `${command.slice(0, 500)}…`
    : command;
}

function createSanitizedToolUseRecord(
  toolUse: ToolUseRecord
): SanitizedToolUseRecord {
  return {
    id: toolUse.id ?? null,
    name: toolUse.name,
    messageIndex:
      toolUse.messageIndex ?? null,
    messageType:
      toolUse.messageType ?? null,
    parentToolUseId:
      toolUse.parentToolUseId ?? null,
    nested: toolUse.nested,
    inputKeys: Object.keys(toolUse.input).sort(),
    delegatedAgent:
      getSubagentName(toolUse) ?? null,
    command: sanitizeCommand(
      toolUse.input.command
    )
  };
}

function uniqueSorted(
  values: string[]
): string[] {
  return [
    ...new Set(values)
  ].sort();
}

function formatSanitizedToolUse(
  toolUse: ToolUseRecord
): string {
  const subagentName =
    getSubagentName(toolUse);

  if (subagentName) {
    return `${toolUse.name}(${subagentName})`;
  }

  const skillName =
    getSkillName(toolUse);

  if (skillName) {
    return `${toolUse.name}(${skillName})`;
  }

  return toolUse.name;
}

describe('sanitized tool-use diagnostics', () => {
  it.each([
    undefined,
    null,
    1,
    '',
    '   '
  ])(
    'returns null for a non-command value',
    value => {
      expect(sanitizeCommand(value)).toBeNull();
    }
  );

  it.each([
    'echo $ANTHROPIC_API_KEY',
    'echo $GITHUB_TOKEN',
    'echo sk-ant-secret',
    'echo ghp_secret',
    'echo github_pat_secret'
  ])(
    'redacts a suspicious command',
    command => {
      expect(sanitizeCommand(command)).toBe(
        '<redacted>'
      );
    }
  );

  it('preserves a harmless read-only command', () => {
    expect(
      sanitizeCommand('git diff --stat')
    ).toBe('git diff --stat');
  });

  it('preserves sanitized nested tool-use provenance', () => {
    const message = {
      type: 'assistant',
      parent_tool_use_id: 'task-1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'bash-1',
            name: 'bash',
            input: {
              command: 'git diff --stat',
              cwd: '/tmp/review'
            }
          }
        ]
      }
    };

    const records = collectToolUses(
      message,
      {
        parentToolUseId:
          getParentToolUseId(message),
        messageIndex: 7,
        messageType: getMessageType(message),
        nested: isNestedMessage(message)
      }
    );

    expect(
      records.map(
        createSanitizedToolUseRecord
      )
    ).toEqual([
      {
        id: 'bash-1',
        name: 'bash',
        parentToolUseId: 'task-1',
        messageIndex: 7,
        messageType: 'assistant',
        nested: true,
        inputKeys: [
          'command',
          'cwd'
        ],
        delegatedAgent: null,
        command: 'git diff --stat'
      }
    ]);
  });
});

function errorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function prepareReviewWorkspace(
  applicationRoot: string
): Promise<string> {
  const workspaceRoot = await mkdtemp(
    join(
      tmpdir(),
      'claude-code-review-phase-8-pr-'
    )
  );

  await execFileAsync(
    'git',
    [
      'init',
      workspaceRoot
    ]
  );

  await execFileAsync(
    'git',
    [
      '-C',
      workspaceRoot,
      'remote',
      'add',
      'origin',
      'https://github.com/airaamane/simple-todo-app.git'
    ]
  );

  await execFileAsync(
    'git',
    [
      '-C',
      workspaceRoot,
      'fetch',
      '--depth=1',
      'origin',
      'pull/1/head'
    ]
  );

  await execFileAsync(
    'git',
    [
      '-C',
      workspaceRoot,
      'checkout',
      '--detach',
      'FETCH_HEAD'
    ]
  );

  await cp(
    join(
      applicationRoot,
      '.claude'
    ),
    join(
      workspaceRoot,
      '.claude'
    ),
    {
      recursive: true
    }
  );

  await writeFile(
    join(
      workspaceRoot,
      'eslint.config.mjs'
    ),
    `export default [
  {
    files: [
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.jsx',
      '**/*.ts',
      '**/*.mts',
      '**/*.cts',
      '**/*.tsx'
    ],
    rules: {}
  }
];
`,
    'utf8'
  );

  return workspaceRoot;
}

describe.skipIf(!LIVE)(
  'live CodeReviewOrchestrator smoke test',
  () => {
    it(
      'completes the read-only multi-agent review flow',
      async () => {
        const apiKey =
          requireEnvironmentVariable(
            'ANTHROPIC_API_KEY'
          );

        const baseUrl =
          requireEnvironmentVariable(
            'ANTHROPIC_BASE_URL'
          );

        const model =
          requireEnvironmentVariable(
            'ANTHROPIC_MODEL'
          );

        const applicationRoot =
          requireEnvironmentVariable(
            'PROJECT_ROOT'
          );

        /*
         * Validate credential presence without printing credential values.
         */
        expect(apiKey.length).toBeGreaterThan(0);
        expect(baseUrl.length).toBeGreaterThan(0);

        const artifactDirectory =
          process.env.PHASE8_ARTIFACT_DIR ??
          '/tmp/claude-code-review-phase-8';

        await mkdir(
          artifactDirectory,
          {
            recursive: true
          }
        );

        const tracePath =
          join(
            artifactDirectory,
            'smoke-trace.log'
          );

        const progressPath =
          join(
            artifactDirectory,
            'smoke-progress.json'
          );

        const errorPath =
          join(
            artifactDirectory,
            'smoke-error.json'
          );

        const summaryPath =
          join(
            artifactDirectory,
            'smoke-summary.json'
          );

        const reportPath =
          join(
            artifactDirectory,
            'smoke-report.json'
          );

        await writeFile(
          tracePath,
          '',
          'utf8'
        );

        const startedAt = Date.now();
        const messages: unknown[] = [];
        const observedToolUses: ToolUseRecord[] = [];

        let lastMessageType = 'not-started';
        let lastMessageSubtype:
          string | undefined;

        const buildDiagnosticState =
          (): DiagnosticState => {
            const toolNames =
              observedToolUses.map(
                toolUse => toolUse.name
              );

            const invokedAgents =
              observedToolUses
                .map(getSubagentName)
                .filter(
                  (name): name is string =>
                    name !== undefined
                );

            const skillNames =
              observedToolUses
                .map(getSkillName)
                .filter(
                  (name): name is string =>
                    name !== undefined
                );

            return {
              target: TARGET,
              elapsedMs:
                Date.now() - startedAt,
              messageCount:
                messages.length,
              toolUseCount:
                observedToolUses.length,
              toolNames:
                uniqueSorted(toolNames),
              githubTools:
                uniqueSorted(
                  toolNames.filter(name =>
                    name.startsWith(
                      'mcp__github__'
                    )
                  )
                ),
              eslintTools:
                uniqueSorted(
                  toolNames.filter(name =>
                    name.startsWith(
                      'mcp__eslint__'
                    )
                  )
                ),
              invokedAgents:
                uniqueSorted(invokedAgents),
              skillNames:
                uniqueSorted(skillNames),
              toolUseTrace:
                observedToolUses.map(
                  createSanitizedToolUseRecord
                ),
              nestedMessageObserved:
                messages.some(
                  isNestedMessage
                ),
              lastMessageType,
              lastMessageSubtype,
              updatedAt:
                new Date().toISOString()
            };
          };

        const persistProgress =
          async (): Promise<void> => {
            await writeFile(
              progressPath,
              JSON.stringify(
                buildDiagnosticState(),
                null,
                2
              ),
              'utf8'
            );
          };

        await persistProgress();

        const heartbeat =
          setInterval(() => {
            const elapsedSeconds =
              Math.round(
                (
                  Date.now() -
                  startedAt
                ) / 1000
              );

            const line =
              `[phase8 +${elapsedSeconds}s] ` +
              `heartbeat messages=${messages.length} ` +
              `tools=${observedToolUses.length} ` +
              `last=${lastMessageType}` +
              (
                lastMessageSubtype
                  ? `/${lastMessageSubtype}`
                  : ''
              );

            console.log(line);

            void appendFile(
              tracePath,
              `${line}\n`,
              'utf8'
            );
          }, 30_000);

        heartbeat.unref();

        let report:
          ReviewReport | undefined;
        let reviewWorkspaceRoot:
          string | undefined;

        try {
          reviewWorkspaceRoot =
            await prepareReviewWorkspace(
              applicationRoot
            );

          console.log(
            `[phase8] Starting ${TARGET.owner}/${TARGET.repo}#${TARGET.number} with model ${model}`
          );

          const orchestrator =
            new CodeReviewOrchestrator({
              model,
              projectRoot: reviewWorkspaceRoot,
              maxTurns: 80,
              onMessage: async message => {
                messages.push(message);

                lastMessageType =
                  getMessageType(message);

                lastMessageSubtype =
                  getMessageSubtype(message);

                const messageToolUses =
                  collectToolUses(
                    message,
                    {
                      parentToolUseId:
                        getParentToolUseId(message),
                      messageIndex:
                        messages.length - 1,
                      messageType:
                        lastMessageType,
                      nested:
                        isNestedMessage(message)
                    }
                  );

                observedToolUses.push(
                  ...messageToolUses
                );

                const elapsedSeconds =
                  (
                    (
                      Date.now() -
                      startedAt
                    ) / 1000
                  ).toFixed(1);

                const tools =
                  messageToolUses
                    .map(
                      formatSanitizedToolUse
                    )
                    .join(', ');

                const nested =
                  isNestedMessage(message)
                    ? ' nested=yes'
                    : '';

                const line =
                  `[phase8 +${elapsedSeconds}s] ` +
                  `message=${lastMessageType}` +
                  (
                    lastMessageSubtype
                      ? `/${lastMessageSubtype}`
                      : ''
                  ) +
                  nested +
                  (
                    tools.length > 0
                      ? ` tools=${tools}`
                      : ''
                  );

                console.log(line);

                await appendFile(
                  tracePath,
                  `${line}\n`,
                  'utf8'
                );

                await persistProgress();
              }
            });

          report =
            await orchestrator.reviewPullRequest(
              TARGET.owner,
              TARGET.repo,
              TARGET.number
            );

          const toolNames =
            observedToolUses.map(
              toolUse => toolUse.name
            );
          const skillNames =
            observedToolUses
              .map(getSkillName)
              .filter(
                (name): name is string =>
                  name !== undefined
              );
          const requiredSkillIndex =
            observedToolUses.findIndex(
              toolUse =>
                getSkillName(toolUse) ===
                  'javascript-best-practices'
            );
          const firstDelegationIndex =
            observedToolUses.findIndex(
              toolUse =>
                getSubagentName(toolUse) !==
                  undefined
            );

          expect(
            toolNames.some(name =>
              name.startsWith(
                'mcp__github__'
              )
            )
          ).toBe(true);

          expect(
            toolNames.some(name =>
              name.startsWith(
                'mcp__eslint__'
              )
            ),
            `Expected ESLint MCP usage. Observed tools: ${toolNames.join(', ')}`
          ).toBe(true);

          expect(
            requiredSkillIndex,
            'javascript-best-practices must be invoked before delegation'
          ).toBeGreaterThanOrEqual(0);

          expect(
            firstDelegationIndex,
            'At least one subagent delegation must be observed'
          ).toBeGreaterThanOrEqual(0);

          expect(
            requiredSkillIndex,
            'javascript-best-practices must be invoked before the first subagent'
          ).toBeLessThan(
            firstDelegationIndex
          );

          const delegationUses =
            observedToolUses.filter(
              toolUse =>
                isDelegationTool(
                  toolUse.name
                )
            );

          for (
            const agentName
            of REQUIRED_AGENTS
          ) {
            expect(
              delegationUses.some(
                toolUse =>
                  getSubagentName(
                    toolUse
                  ) === agentName
              )
            ).toBe(true);
          }

          const parallelDelegationBatch =
            hasParallelDelegationBatch(messages);

          expect(
            parallelDelegationBatch
          ).toBe(true);

          expect(
            skillNames,
            `Expected javascript-best-practices. Observed skills: ${skillNames.join(', ')}`
          ).toContain(
            'javascript-best-practices'
          );

          expect(
            messages.some(
              isNestedMessage
            )
          ).toBe(true);

          expect(
            report.pullRequest
          ).toEqual(TARGET);

          expect(
            report.fileReviews.length
          ).toBeGreaterThan(0);

          expect(
            report.summary.totalFiles
          ).toBe(
            report.fileReviews.length
          );

          for (
            const fileReview
            of report.fileReviews
          ) {
            expect(
              fileReview.file.length
            ).toBeGreaterThan(0);

            expect(
              fileReview.codeQuality.file
            ).toBe(fileReview.file);

            expect(
              fileReview.testCoverage.file
            ).toBe(fileReview.file);

            expect(
              fileReview.refactorings.file
            ).toBe(fileReview.file);

            expect(
              fileReview.codeQuality
                .summary.length
            ).toBeGreaterThan(0);

            expect(
              fileReview.testCoverage
                .summary.length
            ).toBeGreaterThan(0);

            expect(
              fileReview.refactorings
                .summary.length
            ).toBeGreaterThan(0);
          }

          expect(
            ReviewReportSchema
              .safeParse(report)
              .success
          ).toBe(true);

          const forbiddenToolNames =
            new Set([
              'bash',
              'write',
              'edit'
            ]);

          const forbiddenToolUses =
            observedToolUses.filter(
              toolUse =>
                forbiddenToolNames.has(
                  toolUse.name
                    .trim()
                    .toLowerCase()
                )
            );

          expect(
            forbiddenToolUses,
            `Observed forbidden write-capable tools: ${forbiddenToolUses
              .map(toolUse => toolUse.name)
              .join(', ')}`
          ).toEqual([]);

          expect(
            toolNames.some(name =>
              /^mcp__github__.*(?:create|update|delete|comment|write|push|merge|review)/i.test(
                name
              )
            )
          ).toBe(false);

          const diagnosticState =
            buildDiagnosticState();

          await writeFile(
            summaryPath,
            JSON.stringify(
              {
                ...diagnosticState,
                model,
                totalFiles:
                  report.summary.totalFiles,
                overallScore:
                  report.summary.overallScore
              },
              null,
              2
            ),
            'utf8'
          );

          await writeFile(
            reportPath,
            JSON.stringify(
              report,
              null,
              2
            ),
            'utf8'
          );

          console.log(
            `[phase8] Review completed in ${diagnosticState.elapsedMs}ms`
          );
        } catch (error) {
          await writeFile(
            errorPath,
            JSON.stringify(
              {
                error:
                  errorMessage(error),
                diagnostics:
                  buildDiagnosticState()
              },
              null,
              2
            ),
            'utf8'
          );

          throw error;
        } finally {
          clearInterval(heartbeat);
          await persistProgress();

          if (reviewWorkspaceRoot) {
            await rm(
              reviewWorkspaceRoot,
              {
                recursive: true,
                force: true
              }
            );
          }
        }
      },
      10 * 60 * 1000
    );
  }
);
