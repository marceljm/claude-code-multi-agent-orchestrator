import { describe, expect, it } from 'vitest';
import { mkdir, readFile, access, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareReviewWorkspace } from '../src/utils/review-workspace.js';
import { ErrorCodes } from '../src/utils/error-handler.js';
import type { GitInvocation } from '../src/utils/review-workspace.js';

describe('prepareReviewWorkspace', () => {
  it('rejects missing or non-directory trusted Claude configuration before Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    const calls: unknown[] = [];
    await expect(prepareReviewWorkspace({ applicationRoot: root, owner: 'o', repo: 'r', prNumber: 1 }, { gitRunner: async invocation => { calls.push(invocation); } })).rejects.toMatchObject({ code: ErrorCodes.INVALID_CONFIG });
    await writeFile(join(root, '.claude'), 'file');
    await expect(prepareReviewWorkspace({ applicationRoot: root, owner: 'o', repo: 'r', prNumber: 1 }, { gitRunner: async invocation => { calls.push(invocation); } })).rejects.toMatchObject({ code: ErrorCodes.INVALID_CONFIG });
    expect(calls).toHaveLength(0);
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
    'eslint.config.mts', 'eslint.config.cts', '.eslintrc', '.eslintrc.js',
    '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml'
  ])('preserves existing ESLint configuration %s', async file => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    await mkdir(join(root, '.claude')); await writeFile(join(root, '.claude', 'trusted'), 'yes');
    const result = await prepareReviewWorkspace({ applicationRoot: root, owner: 'o', repo: 'r', prNumber: 1 }, { gitRunner: async invocation => { if (invocation.args[0] === 'checkout') await writeFile(join(invocation.cwd, file), 'existing'); } });
    expect(await readFile(join(result.projectRoot, file), 'utf8')).toBe('existing');
    if (file === 'eslint.config.mjs') {
      expect(await readFile(join(result.projectRoot, file), 'utf8')).toBe('existing');
    } else {
      await expect(access(join(result.projectRoot, 'eslint.config.mjs'))).rejects.toThrow();
    }
    await result.cleanup(); await rm(root, { recursive: true, force: true });
  });

  it('recognizes package.json eslintConfig', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    await mkdir(join(root, '.claude')); await writeFile(join(root, '.claude', 'trusted'), 'yes');
    const result = await prepareReviewWorkspace({ applicationRoot: root, owner: 'o', repo: 'r', prNumber: 1 }, { gitRunner: async invocation => { if (invocation.args[0] === 'checkout') await writeFile(join(invocation.cwd, 'package.json'), '{"eslintConfig":{}}'); } });
    await expect(access(join(result.projectRoot, 'eslint.config.mjs'))).rejects.toThrow();
    await result.cleanup(); await rm(root, { recursive: true, force: true });
  });

  it('prepares a checkout, trusts .claude, and adds fallback eslint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, '.claude', 'trusted.md'), 'trusted');
    const calls: { args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
    const result = await prepareReviewWorkspace({ applicationRoot: root, owner: 'airaamane', repo: 'simple-todo-app', prNumber: 2 }, { gitRunner: async invocation => {
      calls.push(invocation);
      if (invocation.args[0] === 'checkout') { await mkdir(join(invocation.cwd, '.claude')); await writeFile(join(invocation.cwd, '.claude', 'evil'), 'evil'); }
    }});
    expect(calls.map(call => call.args)).toEqual([
      ['init', '--quiet'], ['remote', 'add', 'origin', 'https://github.com/airaamane/simple-todo-app.git'],
      ['fetch', '--depth=1', 'origin', 'pull/2/head'], ['checkout', '--detach', 'FETCH_HEAD']
    ]);
    expect(new Set(calls.map(call => call.cwd)).size).toBe(1);
    expect(await readFile(join(result.projectRoot, '.claude', 'trusted.md'), 'utf8')).toBe('trusted');
    await expect(access(join(result.projectRoot, '.claude', 'evil'))).rejects.toThrow();
    expect(await readFile(join(result.projectRoot, 'eslint.config.mjs'), 'utf8')).toContain("rules: {}");
    const projectRoot = result.projectRoot;
    await result.cleanup(); await result.cleanup();
    await expect(access(projectRoot)).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });

  it('redacts token from git arguments and cleans failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    await mkdir(join(root, '.claude'));
    const invocations: GitInvocation[] = [];
    await expect(prepareReviewWorkspace({ applicationRoot: root, owner: 'owner', repo: 'repo', prNumber: 7, githubToken: 'ghp_workspace_test_secret' }, { gitRunner: async invocation => { invocations.push(invocation); if (invocation.args[0] === 'fetch') throw new Error('fetch failed'); }})).rejects.toMatchObject({ code: ErrorCodes.WORKSPACE_PREPARATION_FAILED, metadata: { stage: 'fetch', owner: 'owner', repo: 'repo', prNumber: 7 } });
    expect(invocations[2]?.env.GIT_CONFIG_VALUE_0).toContain('basic ');
    expect(JSON.stringify(invocations)).not.toContain('ghp_workspace_test_secret');
    expect(invocations[0]?.env.GIT_CONFIG_COUNT).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it.each(['init', 'remote', 'fetch', 'checkout'] as const)('cleans failed %s stage safely', async stage => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    try {
      await mkdir(join(root, '.claude'));
      const invocations: GitInvocation[] = [];
      const token = 'ghp_workspace_test_secret';
      let failure: unknown;
      try { await prepareReviewWorkspace({ applicationRoot: root, owner: 'owner', repo: 'repo', prNumber: 7, githubToken: token }, { gitRunner: async invocation => {
      invocations.push(invocation);
      if (invocation.args[0] === stage) throw new Error(`unsafe path /tmp/review-secret ${token}`);
      }}); } catch (error) { failure = error; }
      expect(failure).toMatchObject({ code: ErrorCodes.WORKSPACE_PREPARATION_FAILED, metadata: { stage, owner: 'owner', repo: 'repo', prNumber: 7 } });
      const projectRoot = invocations[0]?.cwd;
      expect(projectRoot).toBeDefined();
      await expect(access(projectRoot!)).rejects.toThrow();
      const serialized = JSON.stringify(invocations);
      expect(serialized).not.toContain(token);
      expect(JSON.stringify(failure)).not.toContain('AUTHORIZATION');
      expect(JSON.stringify(failure)).not.toContain('GIT_CONFIG_VALUE_0');
      expect(invocations.every(invocation => invocation.timeout === 120_000 && invocation.maxBuffer === 1024 * 1024)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sanitizes every Git environment and applies auth only to fetch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    await mkdir(join(root, '.claude'));
    const names = ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'] as const;
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const invocations: GitInvocation[] = [];
    let preparedWorkspace: Awaited<ReturnType<typeof prepareReviewWorkspace>> | undefined;
    try {
      for (const name of names) process.env[name] = `secret_${name}`;
      preparedWorkspace = await prepareReviewWorkspace({ applicationRoot: root, owner: 'o', repo: 'r', prNumber: 1, githubToken: 'ghp_workspace_test_secret' }, { gitRunner: async invocation => { invocations.push(invocation); }});
      for (const invocation of invocations) for (const name of names) expect(invocation.env[name]).toBeUndefined();
      for (const invocation of invocations) {
        const isFetch = invocation.args[0] === 'fetch';
        expect(invocation.env.GIT_CONFIG_COUNT).toBe(isFetch ? '1' : undefined);
        expect(invocation.env.GIT_CONFIG_KEY_0).toBe(isFetch ? 'http.https://github.com/.extraheader' : undefined);
        if (isFetch) expect(invocation.env.GIT_CONFIG_VALUE_0).toEqual(expect.any(String));
        else expect(invocation.env.GIT_CONFIG_VALUE_0).toBeUndefined();
        expect(invocation.args.join(' ')).not.toContain('ghp_workspace_test_secret');
      }
    } finally {
      await preparedWorkspace?.cleanup();
      for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retries cleanup after the first removal failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
    try {
      await mkdir(join(root, '.claude'));
      let attempts = 0;
      const removedPaths: string[] = [];
      const result = await prepareReviewWorkspace({ applicationRoot: root, owner: 'o', repo: 'r', prNumber: 1 }, {
        gitRunner: async () => undefined,
        removeDirectory: async path => { removedPaths.push(path); attempts += 1; if (attempts === 1) throw new Error('transient'); await rm(path, { recursive: true, force: true }); }
      });
      const projectRoot = result.projectRoot;
      await expect(result.cleanup()).rejects.toThrow('transient');
      await result.cleanup();
      await result.cleanup();
      expect(attempts).toBe(2);
      expect(removedPaths).toEqual([projectRoot, projectRoot]);
      await expect(access(projectRoot)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
