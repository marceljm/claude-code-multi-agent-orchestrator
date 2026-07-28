import {
  mkdir as mkdirFileSystem,
  writeFile as writeFileSystem
} from 'node:fs/promises';

import {
  isAbsolute,
  resolve
} from 'node:path';

import {
  pathToFileURL
} from 'node:url';

import * as dotenv
  from 'dotenv';

import {
  CodeReviewOrchestrator
} from './orchestrator.js';

import {
  ErrorCodes,
  ReviewError,
  formatError
} from './utils/error-handler.js';

import {
  ReportGenerator
} from './utils/report-generator.js';

import type {
  ReviewReport
} from './types/index.js';

const USAGE =
  'Usage: npm run dev -- <owner> <repo> <pr-number>';

const SAFE_REPOSITORY_COMPONENT =
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type AuthenticationMethod =
  | 'anthropic'
  | 'bedrock';

export interface CliTarget {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface ResolvedCliEnvironment {
  authentication:
    AuthenticationMethod;
  model: string;
  projectRoot: string;
  maxTurns?: number;
}

export interface ReportPaths {
  directory: string;
  markdown: string;
  html: string;
  json: string;
}

interface ReviewRunner {
  reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport>;
}

interface ReportRenderer {
  generateMarkdownReport(
    report: ReviewReport
  ): string;

  generateHTMLReport(
    report: ReviewReport
  ): string;

  generateJSONReport(
    report: ReviewReport
  ): string;
}

export interface CliDependencies {
  createOrchestrator(
    options: {
      model: string;
      projectRoot: string;
      maxTurns?: number;
    }
  ): ReviewRunner;

  createReportGenerator():
    ReportRenderer;

  mkdir(
    directory: string
  ): Promise<void>;

  writeFile(
    path: string,
    content: string,
    encoding: 'utf8'
  ): Promise<void>;

  cwd(): string;

  stdout: {
    write(text: string): unknown;
  };

  stderr: {
    write(text: string): unknown;
  };
}

function readEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  const value =
    environment[name];

  if (
    value === undefined ||
    value.trim().length === 0
  ) {
    return undefined;
  }

  return value.trim();
}

function requireEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
): string {
  const value =
    readEnvironmentValue(
      environment,
      name
    );

  if (value === undefined) {
    throw new ReviewError(
      `${name} must be configured.`,
      ErrorCodes.INVALID_CONFIG,
      {
        variableName: name
      }
    );
  }

  return value;
}

function readOptionalPositiveInteger(
  environment: NodeJS.ProcessEnv,
  variableName: string
): number | undefined {
  const rawValue =
    readEnvironmentValue(
      environment,
      variableName
    );

  if (rawValue === undefined) {
    return undefined;
  }

  const value =
    Number(rawValue);

  if (
    !Number.isSafeInteger(
      value
    ) ||
    value <= 0
  ) {
    throw new ReviewError(
      `${variableName} must be a positive safe integer.`,
      ErrorCodes.INVALID_CONFIG,
      {
        variableName,
        value:
          rawValue
      }
    );
  }

  return value;
}

function validateRepositoryComponent(
  value: string,
  name: 'owner' | 'repo'
): void {
  if (
    !SAFE_REPOSITORY_COMPONENT.test(
      value
    ) ||
    value === '.' ||
    value === '..'
  ) {
    throw new ReviewError(
      `The repository ${name} contains unsupported characters.`,
      ErrorCodes.INVALID_CONFIG,
      {
        [name]: value
      }
    );
  }
}

/**
 * Parse and validate one CLI pull-request target.
 */
export function parseCliArguments(
  args: string[]
): CliTarget {
  if (args.length !== 3) {
    throw new ReviewError(
      USAGE,
      ErrorCodes.INVALID_CONFIG,
      {
        usage: USAGE
      }
    );
  }

  const [
    rawOwner,
    rawRepo,
    rawPrNumber
  ] = args;

  const owner =
    rawOwner?.trim() ?? '';

  const repo =
    rawRepo?.trim() ?? '';

  const prNumberText =
    rawPrNumber?.trim() ?? '';

  validateRepositoryComponent(
    owner,
    'owner'
  );

  validateRepositoryComponent(
    repo,
    'repo'
  );

  const prNumber =
    Number(prNumberText);

  if (
    prNumberText.length === 0 ||
    !Number.isSafeInteger(
      prNumber
    ) ||
    prNumber <= 0
  ) {
    throw new ReviewError(
      'The pull-request number must be a positive integer.',
      ErrorCodes.INVALID_CONFIG,
      {
        prNumber:
          prNumberText
      }
    );
  }

  return {
    owner,
    repo,
    prNumber
  };
}

/**
 * Resolve the configured authentication method and required runtime values.
 */
export function resolveCliEnvironment(
  environment: NodeJS.ProcessEnv
): ResolvedCliEnvironment {
  const model =
    requireEnvironmentValue(
      environment,
      'ANTHROPIC_MODEL'
    );

  const projectRoot =
    requireEnvironmentValue(
      environment,
      'PROJECT_ROOT'
    );

  if (!isAbsolute(projectRoot)) {
    throw new ReviewError(
      'PROJECT_ROOT must be an absolute path.',
      ErrorCodes.INVALID_CONFIG,
      {
        variableName:
          'PROJECT_ROOT',
        projectRoot
      }
    );
  }

  const maxTurns =
    readOptionalPositiveInteger(
      environment,
      'REVIEW_MAX_TURNS'
    );

  const optionalReviewSettings =
    maxTurns === undefined
      ? {}
      : {
        maxTurns
      };

  const useBedrock =
    readEnvironmentValue(
      environment,
      'CLAUDE_CODE_USE_BEDROCK'
    ) === '1';

  if (useBedrock) {
    const requiredAwsVariables = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION'
    ];

    const missingVariables =
      requiredAwsVariables.filter(
        name =>
          readEnvironmentValue(
            environment,
            name
          ) === undefined
      );

    if (
      missingVariables.length > 0
    ) {
      throw new ReviewError(
        'AWS Bedrock authentication is incomplete.',
        ErrorCodes.INVALID_CONFIG,
        {
          missingVariables
        }
      );
    }

    return {
      authentication:
        'bedrock',
      model,
      projectRoot,
      ...optionalReviewSettings
    };
  }

  const anthropicApiKey =
    readEnvironmentValue(
      environment,
      'ANTHROPIC_API_KEY'
    );

  if (
    anthropicApiKey !== undefined
  ) {
    return {
      authentication:
        'anthropic',
      model,
      projectRoot,
      ...optionalReviewSettings
    };
  }

  const awsVariablesPresent = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION'
  ].some(
    name =>
      readEnvironmentValue(
        environment,
        name
      ) !== undefined
  );

  if (awsVariablesPresent) {
    throw new ReviewError(
      'Set CLAUDE_CODE_USE_BEDROCK=1 when using AWS Bedrock authentication.',
      ErrorCodes.INVALID_CONFIG,
      {
        variableName:
          'CLAUDE_CODE_USE_BEDROCK'
      }
    );
  }

  throw new ReviewError(
    'Configure ANTHROPIC_API_KEY or enable AWS Bedrock authentication.',
    ErrorCodes.MISSING_API_KEY,
    {
      authenticationOptions: [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_USE_BEDROCK=1'
      ]
    }
  );
}

/**
 * Create deterministic output paths for the three required report formats.
 */
export function buildReportPaths(
  cwd: string,
  target: CliTarget
): ReportPaths {
  const directory =
    resolve(
      cwd,
      'reports'
    );

  const baseName =
    `${target.owner}-${target.repo}-pr-${target.prNumber}`;

  return {
    directory,

    markdown:
      resolve(
        directory,
        `${baseName}.md`
      ),

    html:
      resolve(
        directory,
        `${baseName}.html`
      ),

    json:
      resolve(
        directory,
        `${baseName}.json`
      )
  };
}

const defaultDependencies:
  CliDependencies = {
    createOrchestrator(
      options
    ) {
      return new CodeReviewOrchestrator(
        options
      );
    },

    createReportGenerator() {
      return new ReportGenerator();
    },

    async mkdir(directory) {
      await mkdirFileSystem(
        directory,
        {
          recursive: true
        }
      );
    },

    async writeFile(
      path,
      content,
      encoding
    ) {
      await writeFileSystem(
        path,
        content,
        encoding
      );
    },

    cwd:
      () => process.cwd(),

    stdout:
      process.stdout,

    stderr:
      process.stderr
  };

/**
 * Execute one CLI review.
 *
 * Returns a process exit code instead of terminating the process directly,
 * which keeps the CLI deterministic and unit-testable.
 */
export async function runCli(
  args:
    string[] =
      process.argv.slice(2),

  environment:
    NodeJS.ProcessEnv =
      process.env,

  dependencies:
    CliDependencies =
      defaultDependencies
): Promise<number> {
  try {
    const target =
      parseCliArguments(args);

    const runtime =
      resolveCliEnvironment(
        environment
      );

    const authenticationLabel =
      runtime.authentication ===
        'bedrock'
        ? 'AWS Bedrock'
        : 'Anthropic API';

    dependencies.stdout.write(
      `🔐 Using ${authenticationLabel} authentication\n`
    );

    dependencies.stdout.write(
      `Reviewing ${target.owner}/${target.repo}#${target.prNumber}...\n`
    );

    const orchestratorOptions = {
      model:
        runtime.model,

      projectRoot:
        runtime.projectRoot,

      ...(
        runtime.maxTurns ===
          undefined
          ? {}
          : {
            maxTurns:
              runtime.maxTurns
          }
      )
    };

    const orchestrator =
      dependencies
        .createOrchestrator(
          orchestratorOptions
        );

    const report =
      await orchestrator
        .reviewPullRequest(
          target.owner,
          target.repo,
          target.prNumber
        );

    const generator =
      dependencies
        .createReportGenerator();

    const paths =
      buildReportPaths(
        dependencies.cwd(),
        target
      );

    const markdown =
      generator
        .generateMarkdownReport(
          report
        );

    const html =
      generator
        .generateHTMLReport(
          report
        );

    const json =
      generator
        .generateJSONReport(
          report
        );

    await dependencies.mkdir(
      paths.directory
    );

    await Promise.all([
      dependencies.writeFile(
        paths.markdown,
        markdown,
        'utf8'
      ),

      dependencies.writeFile(
        paths.html,
        html,
        'utf8'
      ),

      dependencies.writeFile(
        paths.json,
        json,
        'utf8'
      )
    ]);

    dependencies.stdout.write(
      `Reports written:\n- ${paths.markdown}\n- ${paths.html}\n- ${paths.json}\n`
    );

    return 0;
  } catch (error) {
    dependencies.stderr.write(
      `Error: ${formatError(error)}\n`
    );

    return 1;
  }
}

function isDirectExecution():
  boolean {
  const entryPath =
    process.argv[1];

  if (entryPath === undefined) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      resolve(entryPath)
    ).href
  );
}

if (isDirectExecution()) {
  dotenv.config();

  void runCli().then(
    exitCode => {
      process.exitCode =
        exitCode;
    }
  );
}
