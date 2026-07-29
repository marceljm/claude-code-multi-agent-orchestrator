import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ErrorCodes, ReviewError } from './error-handler.js';

const execFile = promisify(execFileCallback);
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 1024 * 1024;
const ESLINT_FILES = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts', '.eslintrc',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml',
  '.eslintrc.yaml'
];
const ALLOWED_ENVIRONMENT_KEYS = [
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY',
  'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'
];
const FALLBACK_ESLINT = `export default [
  {
    files: [
      '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'
    ],
    rules: {}
  }
];
`;

export type WorkspacePreparationStage =
  | 'init' | 'remote' | 'fetch' | 'checkout' | 'trusted-config' | 'eslint-config';

export interface GitInvocation {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
}

export type GitRunner = (invocation: GitInvocation) => Promise<void>;

export interface PrepareReviewWorkspaceOptions {
  applicationRoot: string;
  owner: string;
  repo: string;
  prNumber: number;
  githubToken?: string;
}

export interface ReviewWorkspaceDependencies {
  gitRunner?: GitRunner;
  removeDirectory?: (path: string) => Promise<void>;
}

export interface PreparedReviewWorkspace {
  projectRoot: string;
  cleanup(): Promise<void>;
}

function gitEnvironment(token?: string, includeAuth = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: '0' };
  for (const key of ALLOWED_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (includeAuth && token !== undefined) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`;
  }
  return env;
}

async function defaultGitRunner(invocation: GitInvocation): Promise<void> {
  await execFile('git', invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    timeout: invocation.timeout,
    maxBuffer: invocation.maxBuffer
  });
}

function workspaceError(stage: WorkspacePreparationStage, options: PrepareReviewWorkspaceOptions): ReviewError {
  return new ReviewError(`Review workspace ${stage} failed.`, ErrorCodes.WORKSPACE_PREPARATION_FAILED, {
    stage, owner: options.owner, repo: options.repo, prNumber: options.prNumber
  });
}

export async function prepareReviewWorkspace(options: PrepareReviewWorkspaceOptions, dependencies: ReviewWorkspaceDependencies = {}): Promise<PreparedReviewWorkspace> {
  const trustedClaude = join(options.applicationRoot, '.claude');
  try {
    if (!(await stat(trustedClaude)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ReviewError('Trusted .claude configuration is missing.', ErrorCodes.INVALID_CONFIG);
  }

  let projectRoot: string | undefined;
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (!cleaned && projectRoot !== undefined) {
      await (dependencies.removeDirectory ?? (async path => { await rm(path, { recursive: true, force: true }); }))(projectRoot);
      cleaned = true;
    }
  };
  const runner = dependencies.gitRunner ?? defaultGitRunner;
  let activeStage: WorkspacePreparationStage = 'init';
  try {
    try { projectRoot = await mkdtemp(join(tmpdir(), 'claude-code-review-')); }
    catch { throw workspaceError('init', options); }
    const run = async (stage: WorkspacePreparationStage, args: string[], auth = false) => {
      activeStage = stage;
      try {
        await runner({ args, cwd: projectRoot!, env: gitEnvironment(options.githubToken, auth), timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
      } catch { throw workspaceError(stage, options); }
    };
    await run('init', ['init', '--quiet']);
    await run('remote', ['remote', 'add', 'origin', `https://github.com/${options.owner}/${options.repo}.git`]);
    await run('fetch', ['fetch', '--depth=1', 'origin', `pull/${options.prNumber}/head`], true);
    await run('checkout', ['checkout', '--detach', 'FETCH_HEAD']);
    activeStage = 'trusted-config';
    try {
      await rm(join(projectRoot, '.claude'), { recursive: true, force: true });
      await cp(trustedClaude, join(projectRoot, '.claude'), { recursive: true });
    } catch { throw workspaceError('trusted-config', options); }
    activeStage = 'eslint-config';
    let hasEslint = false;
    try {
      const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { eslintConfig?: unknown };
      hasEslint = packageJson.eslintConfig !== undefined;
    } catch { /* package.json absent or invalid */ }
    if (!hasEslint) {
      for (const file of ESLINT_FILES) {
        try { await stat(join(projectRoot, file)); hasEslint = true; break; } catch { /* absent */ }
      }
    }
    if (!hasEslint) {
      try { await writeFile(join(projectRoot, 'eslint.config.mjs'), FALLBACK_ESLINT, 'utf8'); }
      catch { throw workspaceError('eslint-config', options); }
    }
    return { projectRoot, cleanup };
  } catch (error) {
    try { await cleanup(); } catch { /* preserve the safe primary error */ }
    if (error instanceof ReviewError) throw error;
    throw workspaceError(activeStage, options);
  }
}
