import 'dotenv/config';

import {
  execFile
} from 'node:child_process';

import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';

import {
  dirname,
  join
} from 'node:path';

import {
  fileURLToPath
} from 'node:url';

import {
  promisify
} from 'node:util';

import {
  describe,
  expect,
  it
} from 'vitest';

import {
  ReviewReportSchema
} from '../../src/types/index.js';

import type {
  ReviewReport
} from '../../src/types/index.js';

const execFileAsync =
  promisify(execFile);

const repositoryRoot =
  join(
    dirname(
      fileURLToPath(import.meta.url)
    ),
    '..',
    '..'
  );

const compiledCliPath =
  join(
    repositoryRoot,
    'dist',
    'main.js'
  );

const reportsDirectory =
  join(
    repositoryRoot,
    'reports'
  );

const artifactDirectory =
  process.env.PHASE14_ARTIFACT_DIR ??
  '/tmp/claude-code-review-phase-14';

const LIVE =
  process.env.RUN_LIVE_REPORT_GENERATION ===
  '1';

const REPORT_MAX_TURNS =
  80;

const REPORT_MODEL =
  'claude-haiku-4-5-20251001';

const REPORT_MAX_BUDGET_USD =
  1.25;

const REPORT_CLI_TIMEOUT_MS =
  12 * 60 * 1000;

const REPORT_TEST_TIMEOUT_MS =
  30 * 60 * 1000;

const {
  ANTHROPIC_BASE_URL:
    _ignoredAnthropicBaseUrl,

  ...directAnthropicEnvironment
} =
  process.env;

const PR1_TARGET = {
  owner: 'airaamane',
  repo: 'simple-todo-app',
  number: 1,
  title: 'add clean code fixture'
} as const;

const LIVE_TARGETS = [
  {
    owner: 'airaamane',
    repo: 'simple-todo-app',
    number: 2,
    title:
      'Add search functionality for todos'
  },
  {
    owner: 'airaamane',
    repo: 'simple-todo-app',
    number: 3,
    title:
      'Add premium subscription features'
  }
] as const;

function selectLiveTargets(
  startPr:
    string | undefined
): readonly (
  typeof LIVE_TARGETS[number]
)[] {
  if (
    startPr === undefined ||
    startPr === '2'
  ) {
    return LIVE_TARGETS;
  }

  if (startPr === '3') {
    return LIVE_TARGETS.slice(1);
  }

  throw new Error(
    'PHASE14_START_PR must be 2 or 3.'
  );
}

const REQUIRED_TARGETS = [
  PR1_TARGET,
  ...LIVE_TARGETS
] as const;

type ReviewTarget =
  typeof REQUIRED_TARGETS[number];

interface CliExecution {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ValidatedReport {
  report: ReviewReport;

  bytes: {
    markdown: number;
    html: number;
    json: number;
  };
}

function requireEnvironmentVariable(
  name: string
): string {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required for live report generation.`
    );
  }

  return value;
}

function reportBaseName(
  target: ReviewTarget
): string {
  return (
    `${target.owner}-` +
    `${target.repo}-` +
    `pr-${target.number}`
  );
}

function reportPaths(
  target: ReviewTarget
): {
  markdown: string;
  html: string;
  json: string;
} {
  const baseName =
    reportBaseName(target);

  return {
    markdown:
      join(
        reportsDirectory,
        `${baseName}.md`
      ),

    html:
      join(
        reportsDirectory,
        `${baseName}.html`
      ),

    json:
      join(
        reportsDirectory,
        `${baseName}.json`
      )
  };
}

function collectSensitiveValues(
  requiredValues: string[]
): string[] {
  return [
    ...requiredValues,
    process.env.GITHUB_TOKEN,
    process.env.AWS_ACCESS_KEY_ID,
    process.env.AWS_SECRET_ACCESS_KEY,
    process.env.AWS_SESSION_TOKEN
  ].filter(
    (
      value
    ): value is string =>
      value !== undefined &&
      value.length > 0
  );
}

function redactSensitiveValues(
  content: string,
  sensitiveValues: string[]
): string {
  return sensitiveValues.reduce(
    (
      sanitized,
      sensitiveValue
    ) =>
      sanitized
        .split(sensitiveValue)
        .join('<redacted>'),
    content
  );
}

function expectNoSensitiveValues(
  content: string,
  sensitiveValues: string[]
): void {
  for (
    const sensitiveValue
    of sensitiveValues
  ) {
    expect(content).not.toContain(
      sensitiveValue
    );
  }
}

async function writeArtifact(
  fileName: string,
  content: string,
  sensitiveValues: string[]
): Promise<void> {
  await writeFile(
    join(
      artifactDirectory,
      fileName
    ),
    redactSensitiveValues(
      content,
      sensitiveValues
    ),
    'utf8'
  );
}

async function prepareReviewWorkspace(
  target: ReviewTarget
): Promise<string> {
  const workspaceRoot =
    await mkdtemp(
      join(
        artifactDirectory,
        `review-pr-${target.number}-`
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
      `pull/${target.number}/head`
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
      repositoryRoot,
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
      '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'
    ],
    rules: {}
  }
];
`,
    'utf8'
  );

  return workspaceRoot;
}

async function runCompiledCli(
  target: ReviewTarget,
  workspaceRoot: string
): Promise<CliExecution> {
  try {
    const result =
      await execFileAsync(
        process.execPath,
        [
          compiledCliPath,
          target.owner,
          target.repo,
          String(
            target.number
          )
        ],
        {
          cwd:
            repositoryRoot,

          env: {
            ...directAnthropicEnvironment,

            ANTHROPIC_MODEL:
              REPORT_MODEL,

            PROJECT_ROOT:
              workspaceRoot,

            REVIEW_MAX_TURNS:
              String(
                REPORT_MAX_TURNS
              ),

            REVIEW_MAX_BUDGET_USD:
              String(
                REPORT_MAX_BUDGET_USD
              ),

            RUN_LIVE_INTEGRATION:
              '0',

            RUN_LIVE_CLI_INTEGRATION:
              '0',

            RUN_LIVE_REPORT_GENERATION:
              '1'
          },

          encoding:
            'utf8',

          timeout:
            REPORT_CLI_TIMEOUT_MS,

          maxBuffer:
            20 * 1024 * 1024
        }
      );

    return {
      stdout:
        result.stdout,

      stderr:
        result.stderr,

      exitCode: 0
    };
  } catch (
    error
  ) {
    const failure =
      error as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };

    return {
      stdout:
        failure.stdout ?? '',

      stderr:
        failure.stderr ??
        failure.message,

      exitCode:
        typeof failure.code ===
          'number'
          ? failure.code
          : 1
    };
  }
}

async function validateReports(
  target: ReviewTarget,
  sensitiveValues: string[]
): Promise<ValidatedReport> {
  const paths =
    reportPaths(target);

  const [
    markdown,
    html,
    json,
    markdownStats,
    htmlStats,
    jsonStats
  ] =
    await Promise.all([
      readFile(
        paths.markdown,
        'utf8'
      ),

      readFile(
        paths.html,
        'utf8'
      ),

      readFile(
        paths.json,
        'utf8'
      ),

      stat(
        paths.markdown
      ),

      stat(
        paths.html
      ),

      stat(
        paths.json
      )
    ]);

  expect(
    markdownStats.size
  ).toBeGreaterThan(0);

  expect(
    htmlStats.size
  ).toBeGreaterThan(0);

  expect(
    jsonStats.size
  ).toBeGreaterThan(0);

  expectNoSensitiveValues(
    markdown,
    sensitiveValues
  );

  expectNoSensitiveValues(
    html,
    sensitiveValues
  );

  expectNoSensitiveValues(
    json,
    sensitiveValues
  );

  expect(markdown).toContain(
    '# 🔍 Code Review Report'
  );

  expect(markdown).toContain(
    '## Summary'
  );

  expect(html).toContain(
    '<!DOCTYPE html>'
  );

  expect(html).toContain(
    '<title>Code Review Report</title>'
  );

  const report =
    ReviewReportSchema.parse(
      JSON.parse(
        json
      ) as unknown
    );

  expect(
    report.pullRequest
  ).toEqual({
    owner:
      target.owner,

    repo:
      target.repo,

    number:
      target.number
  });

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

  return {
    report,

    bytes: {
      markdown:
        markdownStats.size,

      html:
        htmlStats.size,

      json:
        jsonStats.size
    }
  };
}

describe(
  'required report generation contract',
  () => {
    it(
      'defines PRs 1, 2, and 3',
      () => {
        expect(
          REQUIRED_TARGETS.map(
            target =>
              target.number
          )
        ).toEqual([
          1,
          2,
          3
        ]);
      }
    );

    it(
      'generates only PRs 2 and 3',
      () => {
        expect(
          LIVE_TARGETS.map(
            target =>
              target.number
          )
        ).toEqual([
          2,
          3
        ]);
      }
    );

    it('uses the direct Haiku cost contract', () => {
      expect(REPORT_MODEL).toBe('claude-haiku-4-5-20251001');
      expect(REPORT_MAX_TURNS).toBe(80);
      expect(REPORT_MAX_BUDGET_USD).toBe(1.25);
      expect(REPORT_CLI_TIMEOUT_MS).toBe(12 * 60 * 1000);
      expect(REPORT_TEST_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });

    it(
      'selects both live targets by default',
      () => {
        expect(
          selectLiveTargets(
            undefined
          ).map(
            target =>
              target.number
          )
        ).toEqual([
          2,
          3
        ]);
      }
    );

    it(
      'can resume from PR 3 without selecting PR 2',
      () => {
        expect(
          selectLiveTargets(
            '3'
          ).map(
            target =>
              target.number
          )
        ).toEqual([
          3
        ]);
      }
    );

    it(
      'accepts an explicit start at PR 2',
      () => {
        expect(
          selectLiveTargets(
            '2'
          ).map(
            target =>
              target.number
          )
        ).toEqual([
          2,
          3
        ]);
      }
    );

    it.each([
      '',
      '1',
      '4',
      '2,3',
      'not-a-number'
    ])(
      'rejects invalid PHASE14_START_PR value %j',
      value => {
        expect(
          () =>
            selectLiveTargets(
              value
            )
        ).toThrow(
          'PHASE14_START_PR must be 2 or 3.'
        );
      }
    );

    it('uses direct Anthropic child settings and required timeouts', async () => {
        const source =
          await readFile(
            fileURLToPath(
              import.meta.url
            ),
            'utf8'
          );

        expect(source).toContain('ANTHROPIC_BASE_URL:\n    _ignoredAnthropicBaseUrl');
        expect(source).toContain('...directAnthropicEnvironment');
        expect(source).toContain('REPORT_MODEL');
        expect(source).toContain('REPORT_MAX_BUDGET_USD');
        expect(source).toContain('timeout:\n            REPORT_CLI_TIMEOUT_MS');
        expect(source).toContain('REPORT_TEST_TIMEOUT_MS');
      }
    );

    it(
      'uses deterministic report filenames',
      () => {
        expect(
          REQUIRED_TARGETS.flatMap(
            target => {
              const baseName =
                reportBaseName(
                  target
                );

              return [
                `${baseName}.md`,
                `${baseName}.html`,
                `${baseName}.json`
              ];
            }
          )
        ).toEqual([
          'airaamane-simple-todo-app-pr-1.md',
          'airaamane-simple-todo-app-pr-1.html',
          'airaamane-simple-todo-app-pr-1.json',
          'airaamane-simple-todo-app-pr-2.md',
          'airaamane-simple-todo-app-pr-2.html',
          'airaamane-simple-todo-app-pr-2.json',
          'airaamane-simple-todo-app-pr-3.md',
          'airaamane-simple-todo-app-pr-3.html',
          'airaamane-simple-todo-app-pr-3.json'
        ]);
      }
    );
  }
);

describe.skipIf(!LIVE)(
  'live required report generation',
  () => {
    it(
      'generates PR 2 and PR 3 sequentially',
      async () => {
        const selectedTargets =
          selectLiveTargets(
            process.env
              .PHASE14_START_PR
          );

        const apiKey =
          requireEnvironmentVariable(
            'ANTHROPIC_API_KEY'
          );

        const sensitiveValues =
          collectSensitiveValues([
            apiKey
          ]);

        await mkdir(
          artifactDirectory,
          {
            recursive: true
          }
        );

        await mkdir(
          reportsDirectory,
          {
            recursive: true
          }
        );

        await stat(
          compiledCliPath
        );

        /*
         * PR #1 must already have been copied from the successful Phase 13
         * artifacts. It is validated but never regenerated here.
         */
        const pr1 =
          await validateReports(
            PR1_TARGET,
            sensitiveValues
          );

        const summaries:
          Array<
            Record<string, unknown>
          > = [
            {
              target:
                PR1_TARGET,

              reusedFrom:
                'Phase 13',

              totalFiles:
                pr1.report.summary
                  .totalFiles,

              overallScore:
                pr1.report.summary
                  .overallScore,

              bytes:
                pr1.bytes
            }
          ];

        if (
          selectedTargets[0]?.number ===
            3
        ) {
          const pr2 =
            await validateReports(
              LIVE_TARGETS[0],
              sensitiveValues
            );

          summaries.push({
            target:
              LIVE_TARGETS[0],

            reusedFrom:
              'earlier Phase 14 run',

            totalFiles:
              pr2.report.summary
                .totalFiles,

            overallScore:
              pr2.report.summary
                .overallScore,

            bytes:
              pr2.bytes
          });
        }

        await writeArtifact(
          'live-test-status.txt',
          'running\n',
          sensitiveValues
        );

        try {
          /*
           * Deliberately sequential. Do not replace with Promise.all.
           */
          for (
            const target
            of selectedTargets
          ) {
            let workspaceRoot:
              string | undefined;

            try {
              workspaceRoot =
                await prepareReviewWorkspace(
                  target
                );

              const execution =
                await runCompiledCli(
                  target,
                  workspaceRoot
                );

              await Promise.all([
                writeArtifact(
                  `pr-${target.number}-cli-stdout.log`,
                  execution.stdout,
                  sensitiveValues
                ),

                writeArtifact(
                  `pr-${target.number}-cli-stderr.log`,
                  execution.stderr,
                  sensitiveValues
                ),

                writeArtifact(
                  `pr-${target.number}-cli-status.txt`,
                  `${execution.exitCode}\n`,
                  sensitiveValues
                )
              ]);

              expect(
                execution.exitCode
              ).toBe(0);

              expect(
                execution.stderr
              ).toBe('');

              expectNoSensitiveValues(
                execution.stdout,
                sensitiveValues
              );

              expectNoSensitiveValues(
                execution.stderr,
                sensitiveValues
              );

              expect(
                execution.stdout
              ).toContain(
                `Reviewing ${target.owner}/${target.repo}#${target.number}...`
              );

              expect(
                execution.stdout
              ).toContain(
                'Reports written:'
              );

              const validated =
                await validateReports(
                  target,
                  sensitiveValues
                );

              summaries.push({
                target,

                generated:
                  true,

                totalFiles:
                  validated.report
                    .summary
                    .totalFiles,

                overallScore:
                  validated.report
                    .summary
                    .overallScore,

                bytes:
                  validated.bytes
              });
            } finally {
              if (
                workspaceRoot !==
                  undefined
              ) {
                await rm(
                  workspaceRoot,
                  {
                    recursive: true,
                    force: true
                  }
                );
              }
            }
          }

          for (
            const target
            of REQUIRED_TARGETS
          ) {
            await validateReports(
              target,
              sensitiveValues
            );
          }

          await writeArtifact(
            'phase14-summary.json',
            JSON.stringify(
              {
                model:
                  REPORT_MODEL,
                maxTurns:
                  REPORT_MAX_TURNS,
                maxBudgetUsdPerReview:
                  REPORT_MAX_BUDGET_USD,
                maximumCombinedBudgetUsd:
                  REPORT_MAX_BUDGET_USD *
                  selectedTargets.length,
                startPr:
                  process.env
                    .PHASE14_START_PR ??
                  '2',
                targets:
                  summaries,

                completedAt:
                  new Date()
                    .toISOString()
              },
              null,
              2
            ),
            sensitiveValues
          );

          await writeArtifact(
            'live-test-status.txt',
            'passed\n',
            sensitiveValues
          );
        } catch (
          error
        ) {
          await writeArtifact(
            'phase14-error.json',
            JSON.stringify(
              {
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),

                completedTargets:
                  summaries
              },
              null,
              2
            ),
            sensitiveValues
          );

          await writeArtifact(
            'live-test-status.txt',
            'failed\n',
            sensitiveValues
          );

          throw error;
        }
      },
      REPORT_TEST_TIMEOUT_MS
    );
  }
);
