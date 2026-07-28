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
  ErrorCodes
} from '../src/utils/error-handler.js';

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
} {
  const reviewPullRequest = vi.fn().mockResolvedValue({} as ReviewReport);
  const createOrchestrator = vi.fn(() => ({ reviewPullRequest }));
  const createReportGenerator = vi.fn(() => ({
    generateMarkdownReport: vi.fn(() => '# report'),
    generateHTMLReport: vi.fn(() => '<html></html>'),
    generateJSONReport: vi.fn(() => '{}')
  }));
  const mkdir = vi.fn().mockResolvedValue(undefined);
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const stdout = vi.fn();
  const stderr = vi.fn();

  return {
    dependencies: {
      createOrchestrator,
      createReportGenerator,
      mkdir,
      writeFile,
      cwd: () => '/tmp/workspace',
      stdout: { write: stdout },
      stderr: { write: stderr }
    },
    createOrchestrator,
    reviewPullRequest,
    createReportGenerator,
    mkdir,
    writeFile,
    stdout,
    stderr
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
      projectRoot: '/tmp/code-review-project'
    });
  });

  it('parses an optional positive REVIEW_MAX_TURNS value', () => {
    expect(resolveCliEnvironment({
      ...validEnvironment,
      REVIEW_MAX_TURNS: '120'
    })).toEqual({
      authentication: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      projectRoot: '/tmp/code-review-project',
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
      projectRoot: '/tmp/code-review-project',
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

  it('rejects ANTHROPIC_BASE_URL for direct Anthropic authentication', () => {
    expect(() => resolveCliEnvironment({
      ...validEnvironment,
      ANTHROPIC_BASE_URL: 'https://gateway.example.test'
    })).toThrow('ANTHROPIC_BASE_URL must be unset');
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
  it('returns one and formats validation errors without creating an orchestrator', async () => {
    const fixture = createDependencies();

    await expect(runCli([], validEnvironment, fixture.dependencies)).resolves.toBe(1);
    expect(fixture.createOrchestrator).not.toHaveBeenCalled();
    expect(fixture.stderr).toHaveBeenCalledWith(
      'Error: [INVALID_CONFIG] Usage: npm run dev -- <owner> <repo> <pr-number>\n'
    );
  });

  it('runs a review and writes Markdown, HTML, and JSON reports under reports', async () => {
    const fixture = createDependencies();

    await expect(runCli([' owner ', ' repo ', '7'], validEnvironment, fixture.dependencies))
      .resolves.toBe(0);

    expect(fixture.createOrchestrator).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-5-20250929',
      projectRoot: '/tmp/code-review-project'
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
      projectRoot: '/tmp/code-review-project',
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
      projectRoot: '/tmp/code-review-project',
      maxTurns: 80,
      maxBudgetUsd: 1.25
    });
  });
});
