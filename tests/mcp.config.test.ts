import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

const originalGitHubToken = process.env.GITHUB_TOKEN;

async function loadMcpServersConfig() {
  const module = await import('../src/config/mcp.config.js');

  return module.mcpServersConfig;
}

beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  vi.resetModules();
});

afterEach(() => {
  if (originalGitHubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGitHubToken;
  }

  vi.resetModules();
});

describe('mcpServersConfig', () => {
  it('exports exactly the GitHub and ESLint MCP servers', async () => {
    const config = await loadMcpServersConfig();

    expect(Object.keys(config)).toEqual(['github', 'eslint']);
  });

  describe('GitHub MCP server', () => {
    it('uses the rubric-required stdio configuration', async () => {
      const config = await loadMcpServersConfig();

      expect(config.github).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: ''
        }
      });
    });

    it('maps GITHUB_TOKEN to GITHUB_PERSONAL_ACCESS_TOKEN', async () => {
      process.env.GITHUB_TOKEN = 'test-github-token';
      vi.resetModules();

      const config = await loadMcpServersConfig();

      expect(config.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(
        'test-github-token'
      );
    });

    it('uses an empty token when GITHUB_TOKEN is not configured', async () => {
      const config = await loadMcpServersConfig();

      expect(config.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('');
    });
  });

  describe('ESLint MCP server', () => {
    it('uses the rubric-required stdio configuration', async () => {
      const config = await loadMcpServersConfig();

      expect(config.eslint).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@eslint/mcp@latest'],
        env: {}
      });
    });

    it('does not require authentication environment variables', async () => {
      const config = await loadMcpServersConfig();

      expect(config.eslint.env).toEqual({});
    });
  });
});
