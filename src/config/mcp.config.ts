/**
 * Model Context Protocol server configurations used by the orchestrator.
 *
 * The package names and process configuration intentionally follow the
 * project rubric.
 */
export const mcpServersConfig = {
  /**
   * GitHub MCP server for pull request and repository operations.
   *
   * The server expects GITHUB_PERSONAL_ACCESS_TOKEN. The application exposes
   * the optional GITHUB_TOKEN variable and maps it to that expected name.
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP server for linting and static-analysis operations.
   *
   * This server does not require authentication.
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
};
