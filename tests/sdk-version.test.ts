import {
  readFile
} from 'node:fs/promises';

import {
  describe,
  expect,
  it
} from 'vitest';

interface PackageJson {
  dependencies?: {
    '@anthropic-ai/claude-agent-sdk'?:
      string;
  };
}

describe(
  'Claude Agent SDK version',
  () => {
    it(
      'pins the structured-output fix version',
      async () => {
        const packageJson =
          JSON.parse(
            await readFile(
              new URL(
                '../package.json',
                import.meta.url
              ),
              'utf8'
            )
          ) as PackageJson;

        expect(
          packageJson
            .dependencies
            ?.[
              '@anthropic-ai/claude-agent-sdk'
            ]
        ).toBe(
          '0.2.109'
        );
      }
    );
  }
);
