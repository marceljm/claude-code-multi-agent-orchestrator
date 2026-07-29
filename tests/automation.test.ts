import {
  readFile
} from 'node:fs/promises';

import {
  dirname,
  join
} from 'node:path';

import {
  fileURLToPath
} from 'node:url';

import {
  describe,
  expect,
  it
} from 'vitest';

const repositoryRoot =
  join(
    dirname(
      fileURLToPath(import.meta.url)
    ),
    '..'
  );

const packageJsonPath =
  join(
    repositoryRoot,
    'package.json'
  );

const workflowPath =
  join(
    repositoryRoot,
    '.github',
    'workflows',
    'ci.yml'
  );

interface PackageJson {
  scripts: Record<string, string>;
}

async function readPackageJson(): Promise<PackageJson> {
  return JSON.parse(
    await readFile(
      packageJsonPath,
      'utf8'
    )
  ) as PackageJson;
}

describe('automated offline test pipeline', () => {
  it('defines the complete, unit, integration, and separately opt-in live test commands', async () => {
    const {
      scripts
    } = await readPackageJson();

    expect(scripts.test).toBe(
      'vitest run'
    );

    expect(scripts['test:unit']).toBe(
      'vitest run --exclude "tests/integration/**"'
    );

    expect(scripts['test:integration']).toBe(
      'vitest run tests/integration'
    );

    expect(scripts['test:live']).toBe(
      'RUN_LIVE_INTEGRATION=1 vitest run tests/integration/orchestrator.smoke.test.ts --reporter=verbose'
    );

    expect(scripts['test:live:cli']).toBe(
      'npm run build && RUN_LIVE_CLI_INTEGRATION=1 vitest run tests/integration/cli.live.test.ts --reporter=verbose'
    );
  });

  it('defines one CI command that builds, then runs unit tests and non-live integration helpers', async () => {
    const {
      scripts
    } = await readPackageJson();

    expect(scripts['test:ci']).toBe(
      'npm run build && npm run test:unit && npm run test:integration'
    );
  });

  it('runs the offline CI command on Node.js 22.23.1 without live-test credentials or network services', async () => {
    const workflow =
      await readFile(
        workflowPath,
        'utf8'
      );

    expect(workflow).toMatch(
      /node-version:\s*22\.23\.1/
    );

    expect(workflow).toMatch(
      /branches:\s*\[main\]/
    );

    expect(workflow).toMatch(
      /contents:\s*read/
    );

    expect(workflow).toMatch(
      /timeout-minutes:\s*10/
    );

    const disabledLiveGates = [
      'RUN_LIVE_INTEGRATION',
      'RUN_LIVE_CLI_INTEGRATION',
      'RUN_LIVE_REPORT_GENERATION',
      'RUN_LIVE_ANTHROPIC_CREDIT_CHECK',
      'RUN_LIVE_ANTHROPIC_STRUCTURED_OUTPUT'
    ];

    for (
      const liveGate
      of disabledLiveGates
    ) {
      expect(
        workflow
      ).toMatch(
        new RegExp(
          `${liveGate}:\\s*["']0["']`
        )
      );
    }

    expect(
      workflow
    ).not.toMatch(
      /RUN_LIVE_[A-Z_]+:\s*["']?1["']?/
    );

    expect(workflow).toMatch(
      /npm ci/
    );

    expect(workflow).toMatch(
      /npm run test:ci/
    );

    expect(workflow).not.toMatch(
      /RUN_LIVE_(?:CLI_)?INTEGRATION\s*=\s*["']?1["']?/
    );

    expect(workflow).not.toMatch(
      /(?:ANTHROPIC|OPENAI|API)_API_KEY|GITHUB_TOKEN|AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)|secrets\.|mcp/i
    );
  });
});
