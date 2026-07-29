import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface DependencyMap { [packageName: string]: string | undefined; }
interface LockPackage { version?: string; dependencies?: DependencyMap; }
interface PackageJson { dependencies?: DependencyMap; }
interface PackageLock { packages?: { [packagePath: string]: LockPackage | undefined; }; }

async function readJsonFile<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8')) as T;
}

describe('dependency compatibility', () => {
  it('pins the direct SDK, MCP, and Zod dependencies', async () => {
    const packageJson = await readJsonFile<PackageJson>('../package.json');
    expect(packageJson.dependencies?.['@anthropic-ai/claude-agent-sdk']).toBe('0.2.109');
    expect(packageJson.dependencies?.['@modelcontextprotocol/sdk']).toBe('1.29.0');
    expect(packageJson.dependencies?.zod).toBe('4.4.3');
    expect(packageJson.dependencies).not.toHaveProperty('zod-to-json-schema');
  });

  it('keeps the lockfile root aligned with package.json', async () => {
    const lock = await readJsonFile<PackageLock>('../package-lock.json');
    const root = lock.packages?.[''];
    expect(root?.dependencies?.['@anthropic-ai/claude-agent-sdk']).toBe('0.2.109');
    expect(root?.dependencies?.['@modelcontextprotocol/sdk']).toBe('1.29.0');
    expect(root?.dependencies?.zod).toBe('4.4.3');
    expect(root?.dependencies).not.toHaveProperty('zod-to-json-schema');
  });

  it('resolves the pinned SDK and Zod versions', async () => {
    const lock = await readJsonFile<PackageLock>('../package-lock.json');
    expect(lock.packages?.['node_modules/@anthropic-ai/claude-agent-sdk']?.version).toBe('0.2.109');
    expect(lock.packages?.['node_modules/zod']?.version).toBe('4.4.3');
  });

  it('preserves the MCP SDK transitive JSON Schema converter', async () => {
    const lock = await readJsonFile<PackageLock>('../package-lock.json');
    const mcp = lock.packages?.['node_modules/@modelcontextprotocol/sdk'];
    const converter = lock.packages?.['node_modules/zod-to-json-schema'];
    expect(mcp?.version).toBe('1.29.0');
    expect(mcp?.dependencies?.['zod-to-json-schema']).toBeTypeOf('string');
    expect(converter?.version).toBeTypeOf('string');
  });
});
