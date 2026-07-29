import {
  access,
  readFile
} from 'node:fs/promises';

import {
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
    fileURLToPath(
      new URL(
        '..',
        import.meta.url
      )
    )
  );

const reportsDirectory =
  join(
    repositoryRoot,
    'reports'
  );

const requiredReportNames = [
  'airaamane-simple-todo-app-pr-1.md',
  'airaamane-simple-todo-app-pr-1.html',
  'airaamane-simple-todo-app-pr-1.json',
  'airaamane-simple-todo-app-pr-2.md',
  'airaamane-simple-todo-app-pr-2.html',
  'airaamane-simple-todo-app-pr-2.json',
  'airaamane-simple-todo-app-pr-3.md',
  'airaamane-simple-todo-app-pr-3.html',
  'airaamane-simple-todo-app-pr-3.json'
] as const;

describe('required submission reports', () => {
  it.each(requiredReportNames)(
    'includes a non-empty %s report',
    async (reportName) => {
      const reportPath =
        join(
          reportsDirectory,
          reportName
        );

      await expect(
        access(reportPath)
      ).resolves.toBeUndefined();

      const content = await readFile(reportPath, 'utf8');
      expect(content.trim()).not.toBe('');
      expect(content).not.toMatch(/[ \t]+$/m);
    }
  );
});
