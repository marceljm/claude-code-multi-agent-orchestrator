import 'dotenv/config';

import {
  execFile
} from 'node:child_process';

import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';

import {
  tmpdir
} from 'node:os';

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
import { resolveCliEnvironment } from '../../src/main.js';

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

const artifactDirectory =
  process.env.PHASE13_ARTIFACT_DIR ??
  '/tmp/claude-code-review-phase-13';

const LIVE =
  process.env.RUN_LIVE_CLI_INTEGRATION === '1';

const TARGET = {
  owner: 'airaamane',
  repo: 'simple-todo-app',
  number: 1
} as const;

interface CliExecution {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function requireEnvironmentVariable(
  variableName: string
): string {
  const value =
    process.env[variableName]?.trim();

  if (!value) {
    throw new Error(
      `${variableName} is required for the live CLI integration test.`
    );
  }

  return value;
}

function redactSensitiveValues(
  value: string,
  sensitiveValues: string[]
): string {
  return sensitiveValues.reduce(
    (sanitized, sensitiveValue) =>
      sensitiveValue.length > 0
        ? sanitized.split(sensitiveValue).join('<redacted>')
        : sanitized,
    value
  );
}

function displayAuthenticationLabel(authentication: string): string {
  return authentication === 'vocareum'
    ? 'Udacity Vocareum'
    : authentication === 'bedrock'
      ? 'AWS Bedrock'
      : 'Anthropic API';
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

async function runCompiledCli(
  cliWorkingDirectory: string,
  environment: NodeJS.ProcessEnv
): Promise<CliExecution> {
  try {
    const result =
      await execFileAsync(
        process.execPath,
        [
          compiledCliPath,
          TARGET.owner,
          TARGET.repo,
          String(TARGET.number)
        ],
        {
          cwd: cliWorkingDirectory,
          env: {
            ...environment,
            PROJECT_ROOT: repositoryRoot
          },
          timeout: 10 * 60 * 1000,
          maxBuffer: 1024 * 1024
        }
      );

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    const failure =
      error as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };

    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message,
      exitCode:
        typeof failure.code === 'number'
          ? failure.code
          : 1
    };
  }
}

describe.skipIf(!LIVE)(
  'live compiled CLI integration test',
  () => {
    it(
      'reviews the target pull request and persists all report formats',
      async () => {
        const configuredEnvironment = {
          ...process.env,
          PROJECT_ROOT: repositoryRoot
        };
        const runtime = resolveCliEnvironment(configuredEnvironment);
        const model = requireEnvironmentVariable('ANTHROPIC_MODEL');
        const credentialValues = [
          configuredEnvironment.ANTHROPIC_API_KEY,
          configuredEnvironment.ANTHROPIC_AUTH_TOKEN,
          configuredEnvironment.GITHUB_TOKEN,
          configuredEnvironment.GITHUB_PERSONAL_ACCESS_TOKEN,
          configuredEnvironment.AWS_ACCESS_KEY_ID,
          configuredEnvironment.AWS_SECRET_ACCESS_KEY,
          configuredEnvironment.AWS_SESSION_TOKEN
        ];

        const sensitiveValues = credentialValues.filter((value): value is string => Boolean(value?.trim()));

        await mkdir(
          artifactDirectory,
          {
            recursive: true
          }
        );

        await writeArtifact(
          'live-test-status.txt',
          'running\n',
          sensitiveValues
        );

        let cliWorkingDirectory:
          string | undefined;

        try {
          cliWorkingDirectory =
            await mkdtemp(
              join(
                artifactDirectory,
                'cli-'
              )
            );

          const execution =
            await runCompiledCli(
              cliWorkingDirectory,
              {
                ...process.env,
                ...configuredEnvironment,
                ANTHROPIC_MODEL: model
              }
            );

          await Promise.all([
            writeArtifact(
              'cli-stdout.log',
              execution.stdout,
              sensitiveValues
            ),
            writeArtifact(
              'cli-stderr.log',
              execution.stderr,
              sensitiveValues
            ),
            writeArtifact(
              'cli-status.txt',
              `${execution.exitCode}\n`,
              sensitiveValues
            )
          ]);

          const executionDiagnostic = redactSensitiveValues(
            [
              `Compiled CLI exit code: ${execution.exitCode}`,
              '--- stdout ---',
              execution.stdout,
              '--- stderr ---',
              execution.stderr
            ].join('\n'),
            sensitiveValues
          );
          expect(execution.exitCode, executionDiagnostic).toBe(0);
          expect(execution.stderr).toBe('');
          expect(execution.stdout).toContain(
            `🔐 Using ${displayAuthenticationLabel(runtime.authentication)} authentication`
          );
          expect(execution.stdout).toContain(
            `Reviewing ${TARGET.owner}/${TARGET.repo}#${TARGET.number}...`
          );
          expect(execution.stdout).toContain(
            'Reports written:'
          );

          const reportDirectory =
            join(
              cliWorkingDirectory,
              'reports'
            );

          const [
            markdown,
            html,
            json
          ] = await Promise.all([
            readFile(
              join(reportDirectory, `${TARGET.owner}-${TARGET.repo}-pr-${TARGET.number}.md`),
              'utf8'
            ),
            readFile(
              join(reportDirectory, `${TARGET.owner}-${TARGET.repo}-pr-${TARGET.number}.html`),
              'utf8'
            ),
            readFile(
              join(reportDirectory, `${TARGET.owner}-${TARGET.repo}-pr-${TARGET.number}.json`),
              'utf8'
            )
          ]);

          const report =
            ReviewReportSchema.parse(
              JSON.parse(json) as unknown
            );

          expect(markdown.length).toBeGreaterThan(0);
          expect(html.length).toBeGreaterThan(0);
          expect(json.length).toBeGreaterThan(0);
          expect(report.pullRequest).toEqual(TARGET);
          expect(report.fileReviews.length).toBeGreaterThan(0);
          expect(report.summary.totalFiles).toBe(report.fileReviews.length);

          for (
            const fileReview
            of report.fileReviews
          ) {
            expect(fileReview.codeQuality.summary.length).toBeGreaterThan(0);
            expect(fileReview.testCoverage.summary.length).toBeGreaterThan(0);
            expect(fileReview.refactorings.summary.length).toBeGreaterThan(0);
          }

          for (
            const output
            of [
              execution.stdout,
              execution.stderr,
              markdown,
              html,
              json
            ]
          ) {
            for (
              const sensitiveValue
              of sensitiveValues
            ) {
              expect(output).not.toContain(sensitiveValue);
            }
          }

          await Promise.all([
            writeArtifact('cli-report.md', markdown, sensitiveValues),
            writeArtifact('cli-report.html', html, sensitiveValues),
            writeArtifact('cli-report.json', json, sensitiveValues),
            writeArtifact(
              'cli-summary.json',
              JSON.stringify(
                {
                  target: TARGET,
                  totalFiles: report.summary.totalFiles,
                  overallScore: report.summary.overallScore
                },
                null,
                2
              ),
              sensitiveValues
            )
          ]);

          await writeArtifact(
            'live-test-status.txt',
            'passed\n',
            sensitiveValues
          );
        } catch (error) {
          await appendFile(
            join(
              artifactDirectory,
              'live-test-status.txt'
            ),
            redactSensitiveValues(
              `failed: ${error instanceof Error ? error.message : String(error)}\n`,
              sensitiveValues
            ),
            'utf8'
          );

          throw error;
        } finally {
          await Promise.all([
            cliWorkingDirectory
              ? rm(
                cliWorkingDirectory,
                {
                  recursive: true,
                  force: true
                }
              )
              : Promise.resolve()
          ]);
        }
      },
      10 * 60 * 1000
    );
  }
);
