import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  parseCliArguments,
  resolveCliEnvironment,
  runCli
} from '../src/main.js';

import type {
  CliDependencies
} from '../src/main.js';

import type {
  ReviewReport
} from '../src/types/index.js';

import {
  ErrorCodes,
  ReviewError
} from '../src/utils/error-handler.js';
import type { StructuredLogger } from '../src/utils/logger.js';

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

const validEnvironment = {
  ANTHROPIC_API_KEY: 'test-api-key',
  ANTHROPIC_MODEL: 'claude-sonnet-4-5-20250929',
  PROJECT_ROOT: '/tmp/code-review-project'
};

function createDependencies(): {
  dependencies: CliDependencies;
  createOrchestrator: ReturnType<typeof vi.fn>;
  reviewPullRequest: ReturnType<typeof vi.fn>;
  createReportGenerator: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  stdout: ReturnType<typeof vi.fn>;
  stderr: ReturnType<typeof vi.fn>;
  logger: StructuredLogger;
  logEntries: RecordedLogEntry[];
  cleanup: ReturnType<typeof vi.fn>;
} {
  const reviewPullRequest = vi.fn().mockResolvedValue({} as ReviewReport);
  const createOrchestrator = vi.fn(() => ({ reviewPullRequest }));
  const createReportGenerator = vi.fn(() => ({
    generateMarkdownReport: vi.fn(() => '# report'),
    generateHTMLReport: vi.fn(() => '<html></html>'),
    generateJSONReport: vi.fn(() => '{}')
  }));
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const prepareReviewWorkspace = vi.fn().mockResolvedValue({
    projectRoot: '/tmp/prepared-review-workspace',
    cleanup
  });
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const stdout = vi.fn();
  const stderr = vi.fn();
  const logging = createRecordingLogger();

  return {
    dependencies: {
      createOrchestrator,
      createReportGenerator,
      prepareReviewWorkspace,
      mkdir,
      writeFile,
      cwd: () => '/tmp/workspace',
      stdout: { write: stdout },
      stderr: {
        write: stderr
      },
      logger: logging.logger
    },
    createOrchestrator,
    reviewPullRequest,
    createReportGenerator,
    prepareReviewWorkspace,
    mkdir,
    writeFile,
    stdout,
    stderr,
    logger: logging.logger,
    logEntries: logging.entries,
    cleanup
  };
}

describe('parseCliArguments', () => {
  it('requires exactly three arguments and includes the usage string in its error', () => {
    expect(() => parseCliArguments(['owner', 'repo'])).toThrow(
      'Usage: npm run dev -- <owner> <repo> <pr-number>'
    );
  });

  it('trims repository values and parses only positive safe-integer PR numbers', () => {
    expect(parseCliArguments([' owner ', ' repo ', ' 12 '])).toEqual({
      owner: 'owner',
      repo: 'repo',
      prNumber: 12
    });

    for (const value of ['0', '-1', '1.5', '9007199254740992']) {
      expect(() => parseCliArguments(['owner', 'repo', value])).toThrow(
        'positive integer'
      );
    }
  });

  it.each(['../owner', 'owner/repo', '.', '..'])
  ('rejects unsafe owner and repository components: %s', value => {
    expect(() => parseCliArguments([value, 'repo', '1'])).toThrow(
      'unsupported characters'
    );
    expect(() => parseCliArguments(['owner', value, '1'])).toThrow(
      'unsupported characters'
    );
  });
});

describe('resolveCliEnvironment', () => {
  it('accepts direct Anthropic authentication without requiring GitHub credentials', () => {
    expect(resolveCliEnvironment(validEnvironment)).toEqual({
      authentication: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      applicationRoot: '/tmp/code-review-project'
    });
  });

  it('parses an optional positive REVIEW_MAX_TURNS value', () => {
    expect(resolveCliEnvironment({
      ...validEnvironment,
      REVIEW_MAX_TURNS: '120'
    })).toEqual({
      authentication: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      applicationRoot: '/tmp/code-review-project',
      maxTurns: 120
    });
  });

  it('parses an optional positive REVIEW_MAX_BUDGET_USD', () => {
    expect(resolveCliEnvironment({
      ...validEnvironment,
      REVIEW_MAX_BUDGET_USD: '1.25'
    })).toMatchObject({
      authentication: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      applicationRoot: '/tmp/code-review-project',
      maxBudgetUsd: 1.25
    });
  });

  it.each(['0', '-1', 'not-a-number', 'Infinity', 'NaN'])(
    'rejects invalid REVIEW_MAX_BUDGET_USD value %j',
    value => {
      try {
        resolveCliEnvironment({
          ...validEnvironment,
          REVIEW_MAX_BUDGET_USD: value
        });

        throw new Error('Expected budget validation to fail.');
      } catch (error) {
        expect(error).toMatchObject({
          code: ErrorCodes.INVALID_CONFIG,
          metadata: {
            variableName: 'REVIEW_MAX_BUDGET_USD',
            value
          }
        });
      }
    }
  );

  it('accepts Udacity Vocareum authentication', () => {
    expect(resolveCliEnvironment({
      ...validEnvironment,
      ANTHROPIC_BASE_URL: 'https://claude.vocareum.com'
    })).toEqual({
      authentication: 'vocareum',
      model: 'claude-sonnet-4-5-20250929',
      applicationRoot: '/tmp/code-review-project'
    });
  });

  it('accepts a trailing slash in the Vocareum base URL', () => {
    expect(resolveCliEnvironment({
      ...validEnvironment,
      ANTHROPIC_BASE_URL: 'https://claude.vocareum.com/'
    })).toMatchObject({ authentication: 'vocareum' });
  });

  it('rejects unsupported custom Anthropic endpoints without exposing secrets', () => {
    const environment = {
      ...validEnvironment,
      ANTHROPIC_BASE_URL: 'https://unsupported.example.test'
    };

    try {
      resolveCliEnvironment(environment);
      throw new Error('Expected unsupported endpoint validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewError);
      expect(error).toMatchObject({
        code: ErrorCodes.INVALID_CONFIG,
        metadata: { variableName: 'ANTHROPIC_BASE_URL' }
      });
      expect((error as Error).message).toContain('unset for direct Anthropic API access');
      expect((error as Error).message).toContain('https://claude.vocareum.com');
      expect(JSON.stringify(error)).not.toContain('test-api-key');
      expect(JSON.stringify(error)).not.toContain('unsupported.example.test');
    }
  });

  it.each([
    '0',
    '-1',
    '1.5',
    'not-a-number',
    '9007199254740992'
  ])(
    'rejects invalid REVIEW_MAX_TURNS value %j',
    value => {
      try {
        resolveCliEnvironment({
          ...validEnvironment,
          REVIEW_MAX_TURNS: value
        });

        throw new Error(
          'Expected REVIEW_MAX_TURNS validation to fail.'
        );
      } catch (error) {
        expect(error).toMatchObject({
          code: ErrorCodes.INVALID_CONFIG,
          metadata: {
            variableName: 'REVIEW_MAX_TURNS',
            value
          }
        });
      }
    }
  );

  it('requires explicit and complete Bedrock configuration', () => {
    expect(() => resolveCliEnvironment({
      ANTHROPIC_MODEL: 'model',
      PROJECT_ROOT: '/tmp/project',
      AWS_ACCESS_KEY_ID: 'access-key'
    })).toThrow('CLAUDE_CODE_USE_BEDROCK=1');

    expect(() => resolveCliEnvironment({
      ANTHROPIC_MODEL: 'model',
      PROJECT_ROOT: '/tmp/project',
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_ACCESS_KEY_ID: 'access-key'
    })).toThrow('AWS Bedrock authentication is incomplete.');
  });

  it('requires a model and an absolute project root before orchestration', () => {
    expect(() => resolveCliEnvironment({
      ANTHROPIC_API_KEY: 'test-api-key',
      PROJECT_ROOT: '/tmp/project'
    })).toThrow('ANTHROPIC_MODEL must be configured.');

    expect(() => resolveCliEnvironment({
      ANTHROPIC_API_KEY: 'test-api-key',
      ANTHROPIC_MODEL: 'model',
      PROJECT_ROOT: 'relative/project'
    })).toThrow('PROJECT_ROOT must be an absolute path.');
  });
});

describe('runCli', () => {
  it('prepares the workspace before orchestration with the exact boundary', async () => {
    const fixture = createDependencies();
    await expect(runCli(['owner', 'repo', '7'], validEnvironment, fixture.dependencies)).resolves.toBe(0);
    expect(fixture.prepareReviewWorkspace.mock.invocationCallOrder[0]).toBeLessThan(fixture.createOrchestrator.mock.invocationCallOrder[0]);
    expect(fixture.prepareReviewWorkspace).toHaveBeenCalledWith({ applicationRoot: '/tmp/code-review-project', owner: 'owner', repo: 'repo', prNumber: 7, githubToken: undefined });
    expect(fixture.createOrchestrator).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/tmp/prepared-review-workspace' }));
    expect(fixture.createOrchestrator.mock.calls[0]?.[0].projectRoot).not.toBe('/tmp/code-review-project');
  });

  it('passes only the supplied environment token to workspace preparation', async () => {
    const fixture = createDependencies();
    await runCli(['owner', 'repo', '7'], { ...validEnvironment, GITHUB_TOKEN: 'ghp_supplied_environment_token' }, fixture.dependencies);
    expect(fixture.prepareReviewWorkspace).toHaveBeenCalledWith(expect.objectContaining({ githubToken: 'ghp_supplied_environment_token' }));
  });

  it('does not use a global token when a supplied environment omits it', async () => {
    const fixture = createDependencies();
    const original = process.env.GITHUB_TOKEN;
    try {
      process.env.GITHUB_TOKEN = 'ghp_global_environment_token';
      await runCli(['owner', 'repo', '7'], validEnvironment, fixture.dependencies);
      expect(fixture.prepareReviewWorkspace).toHaveBeenCalledWith(expect.objectContaining({ githubToken: undefined }));
    } finally {
      if (original === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = original;
    }
  });
  it.each(['orchestration', 'rendering', 'writing'])('cleans the prepared workspace after %s failure', async failure => {
    const fixture = createDependencies();
    if (failure === 'orchestration') fixture.reviewPullRequest.mockRejectedValue(new Error('review failed'));
    if (failure === 'rendering') fixture.createReportGenerator.mockReturnValue({
      generateMarkdownReport: () => { throw new Error('render failed'); },
      generateHTMLReport: () => '<html></html>', generateJSONReport: () => '{}'
    });
    if (failure === 'writing') fixture.writeFile.mockRejectedValue(new Error('write failed'));
    await expect(runCli(['owner', 'repo', '7'], validEnvironment, fixture.dependencies)).resolves.toBe(1);
    expect(fixture.cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not create an orchestrator when workspace preparation fails', async () => {
    const fixture = createDependencies();
    fixture.prepareReviewWorkspace.mockRejectedValue(new ReviewError('workspace failed', ErrorCodes.WORKSPACE_PREPARATION_FAILED));
    await expect(runCli(['owner', 'repo', '7'], validEnvironment, fixture.dependencies)).resolves.toBe(1);
    expect(fixture.createOrchestrator).not.toHaveBeenCalled();
  });

  it('returns non-zero and sanitizes cleanup-only failures', async () => {
    const fixture = createDependencies();
    fixture.cleanup.mockRejectedValue(new Error('/tmp/untrusted-workspace GITHUB_TOKEN=fake'));
    await expect(runCli(['owner', 'repo', '7'], validEnvironment, fixture.dependencies)).resolves.toBe(1);
    expect(fixture.cleanup).toHaveBeenCalledTimes(1);
    expect(fixture.logEntries.some(entry => entry.metadata.event === 'workspace.cleanup.failed')).toBe(true);
    expect(fixture.logEntries.some(entry => entry.metadata.event === 'cli.completed')).toBe(false);
    expect(JSON.stringify(fixture.logEntries)).not.toContain('/tmp/untrusted-workspace');
    expect(JSON.stringify(fixture.logEntries)).not.toContain('fake');
  });

  it('preserves the primary failure when cleanup also fails', async () => {
    const fixture = createDependencies();
    fixture.reviewPullRequest.mockRejectedValue(new Error('orchestration failed'));
    fixture.cleanup.mockRejectedValue(new Error('/tmp/untrusted-workspace cleanup-secret'));
    await expect(runCli(['owner', 'repo', '7'], validEnvironment, fixture.dependencies)).resolves.toBe(1);
    expect(fixture.stderr).toHaveBeenCalledWith('Error: orchestration failed\n');
    expect(JSON.stringify(fixture.logEntries)).toContain('orchestration failed');
    expect(JSON.stringify(fixture.logEntries)).not.toContain('cleanup-secret');
    expect(fixture.logEntries.some(entry => entry.metadata.event === 'workspace.cleanup.failed')).toBe(true);
  });

  it('prints the Udacity Vocareum authentication label', async () => {
    const fixture = createDependencies();

    await expect(runCli(
      ['owner', 'repo', '7'],
      { ...validEnvironment, ANTHROPIC_BASE_URL: 'https://claude.vocareum.com' },
      fixture.dependencies
    )).resolves.toBe(0);

    expect(fixture.stdout).toHaveBeenCalledWith(
      '🔐 Using Udacity Vocareum authentication\n'
    );
  });

  it('returns one and formats validation errors without creating an orchestrator', async () => {
    const fixture = createDependencies();

    await expect(runCli([], validEnvironment, fixture.dependencies)).resolves.toBe(1);
    expect(fixture.createOrchestrator).not.toHaveBeenCalled();
    expect(fixture.stderr).toHaveBeenCalledWith(
      'Error: [INVALID_CONFIG] Usage: npm run dev -- <owner> <repo> <pr-number>\n'
    );
    expect(fixture.logEntries).toHaveLength(1);
    expect(fixture.logEntries[0]).toMatchObject({
      level: 'error',
      metadata: {
        event: 'cli.failed',
        errorName: 'ReviewError',
        errorCode: 'INVALID_CONFIG',
        durationMs: expect.any(Number)
      }
    });
    expect(fixture.logEntries[0]?.metadata).not.toHaveProperty('owner');
    expect(fixture.logEntries[0]?.metadata).not.toHaveProperty('repo');
    expect(fixture.logEntries[0]?.metadata).not.toHaveProperty('prNumber');
  });

  it('runs a review and writes Markdown, HTML, and JSON reports under reports', async () => {
    const fixture = createDependencies();

    await expect(runCli([' owner ', ' repo ', '7'], validEnvironment, fixture.dependencies))
      .resolves.toBe(0);

    expect(fixture.createOrchestrator).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5-20250929',
      projectRoot: '/tmp/prepared-review-workspace'
    });
    expect(fixture.reviewPullRequest).toHaveBeenCalledWith('owner', 'repo', 7);
    expect(fixture.mkdir).toHaveBeenCalledWith('/tmp/workspace/reports');
    expect(fixture.writeFile).toHaveBeenCalledWith(
      '/tmp/workspace/reports/owner-repo-pr-7.md', '# report', 'utf8'
    );
    expect(fixture.writeFile).toHaveBeenCalledWith(
      '/tmp/workspace/reports/owner-repo-pr-7.html', '<html></html>', 'utf8'
    );
    expect(fixture.writeFile).toHaveBeenCalledWith(
      '/tmp/workspace/reports/owner-repo-pr-7.json', '{}', 'utf8'
    );
    expect(fixture.logEntries.map(entry => entry.metadata.event)).toEqual([
      'cli.started', 'workspace.preparing', 'workspace.ready',
      'reports.started', 'reports.completed', 'workspace.cleaned', 'cli.completed'
    ]);
    expect(fixture.logEntries.find(entry => entry.metadata.event === 'cli.started'))
      .toMatchObject({ metadata: {
        owner: 'owner', repo: 'repo', prNumber: 7,
        authentication: 'anthropic', model: 'claude-sonnet-4-5-20250929'
      } });
    expect(fixture.logEntries.find(entry => entry.metadata.event === 'reports.completed'))
      .toMatchObject({ metadata: {
        formats: ['markdown', 'html', 'json'], durationMs: expect.any(Number)
      } });
    const serializedEntries = JSON.stringify(fixture.logEntries);
    expect(serializedEntries).not.toContain('test-api-key');
    expect(serializedEntries).not.toContain('ANTHROPIC_API_KEY');
    expect(serializedEntries).not.toContain('# report');
    expect(serializedEntries).not.toContain('<html></html>');
  });

  it('logs report-writing failure without logging report bodies or credentials', async () => {
    const fixture = createDependencies();
    fixture.writeFile.mockRejectedValue(new Error(
      'Report storage unavailable. GITHUB_TOKEN=ghp_testsecret'
    ));

    await expect(runCli(
      ['owner', 'repo', '7'], validEnvironment, fixture.dependencies
    )).resolves.toBe(1);

    expect(fixture.logEntries.some(entry => entry.metadata.event === 'reports.started')).toBe(true);
    expect(
      fixture.logEntries.some(
        entry => entry.metadata.event === 'reports.completed'
      )
    ).toBe(false);
    expect(fixture.logEntries.some(entry => entry.metadata.event === 'cli.completed')).toBe(false);
    expect(
      fixture.logEntries.filter(
        entry => entry.metadata.event === 'cli.failed'
      )
    ).toHaveLength(1);
    expect(fixture.logEntries.find(entry => entry.metadata.event === 'cli.failed'))
      .toMatchObject({ metadata: {
        owner: 'owner', repo: 'repo', prNumber: 7,
        errorName: 'Error',
        errorMessage: 'Report storage unavailable. GITHUB_TOKEN=[REDACTED]'
      } });
    const serializedEntries = JSON.stringify(fixture.logEntries);
    expect(serializedEntries).not.toContain('test-api-key');
    expect(serializedEntries).not.toContain('# report');
    expect(serializedEntries).not.toContain('<html></html>');
    expect(serializedEntries).not.toContain('ghp_testsecret');
    expect(serializedEntries).not.toContain('GITHUB_TOKEN=ghp_testsecret');
  });

  it('forwards REVIEW_MAX_TURNS to the orchestrator', async () => {
    const fixture = createDependencies();

    await expect(runCli(
      [
        'airaamane',
        'simple-todo-app',
        '2'
      ],
      {
        ...validEnvironment,
        REVIEW_MAX_TURNS: '120'
      },
      fixture.dependencies
    )).resolves.toBe(0);

    expect(fixture.createOrchestrator).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5-20250929',
      projectRoot: '/tmp/prepared-review-workspace',
      maxTurns: 120
    });

    expect(fixture.reviewPullRequest).toHaveBeenCalledWith(
      'airaamane',
      'simple-todo-app',
      2
    );
  });

  it('forwards the cost and turn limits to the orchestrator', async () => {
    const fixture = createDependencies();

    await expect(runCli(
      ['airaamane', 'simple-todo-app', '2'],
      {
        ...validEnvironment,
        REVIEW_MAX_TURNS: '80',
        REVIEW_MAX_BUDGET_USD: '1.25'
      },
      fixture.dependencies
    )).resolves.toBe(0);

    expect(fixture.createOrchestrator).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5-20250929',
      projectRoot: '/tmp/prepared-review-workspace',
      maxTurns: 80,
      maxBudgetUsd: 1.25
    });
  });
});
