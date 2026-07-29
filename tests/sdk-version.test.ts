import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')); }
describe('dependency compatibility', () => {
  it('pins SDK and Zod and removes the obsolete converter', async () => { const pkg = await readJson('../package.json'); const obsolete = 'zod-' + 'to-json-schema'; expect(pkg.dependencies['@anthropic-ai/claude-agent-sdk']).toBe('0.2.109'); expect(pkg.dependencies.zod).toBe('4.4.3'); expect(pkg.dependencies).not.toHaveProperty(obsolete); });
  it('keeps package-lock.json aligned with package.json', async () => { const lock = await readJson('../package-lock.json'); const obsolete = 'zod-' + 'to-json-schema'; expect(lock.packages[''].dependencies['@anthropic-ai/claude-agent-sdk']).toBe('0.2.109'); expect(lock.packages[''].dependencies.zod).toBe('4.4.3'); expect(lock.packages[''].dependencies).not.toHaveProperty(obsolete); expect(lock.packages['node_modules/@anthropic-ai/claude-agent-sdk'].version).toBe('0.2.109'); expect(lock.packages['node_modules/zod'].version).toBe('4.4.3'); expect(lock.packages['node_modules/' + obsolete]).toBeUndefined(); });
});
