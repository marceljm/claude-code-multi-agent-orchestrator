import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface DependencyMap {
  [packageName: string]: string | undefined;
}

interface PackageJson {
  name?: string;
  description?: string;
  dependencies?: DependencyMap;
}

interface LockPackage {
  name?: string;
  dependencies?: DependencyMap;
}

interface PackageLock {
  name?: string;
  packages?: {
    [path: string]: LockPackage | undefined;
  };
}

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('final submission metadata', () => {
  it('aligns completed-project package metadata and lockfile metadata', async () => {
    const packageJson = JSON.parse(await readRepositoryFile('package.json')) as PackageJson;
    const packageLock = JSON.parse(await readRepositoryFile('package-lock.json')) as PackageLock;
    const rootPackage = packageLock.packages?.[''];
    expect(packageJson.name).toBe('claude-code-multi-agent-orchestrator');
    expect(packageLock.name).toBe('claude-code-multi-agent-orchestrator');
    expect(rootPackage?.name).toBe('claude-code-multi-agent-orchestrator');
    expect(packageJson.description).toBe(
      'Multi-agent pull request code review orchestrator built with the Claude Agent SDK'
    );
    expect(packageJson.dependencies?.['@modelcontextprotocol/sdk']).toBe('1.29.0');
    expect(rootPackage?.dependencies?.['@modelcontextprotocol/sdk']).toBe('1.29.0');
  });

  it('documents completed Vocareum, direct-Anthropic, and Bedrock configuration', async () => {
    const readme = await readRepositoryFile('README.md');
    const environmentExample = await readRepositoryFile('.env.example');
    const obsoleteTexts = [
      'What You Need to Implement',
      'starter project',
      'Starter project'
    ];

    for (
      const obsoleteText
      of obsoleteTexts
    ) {
      expect(readme).not.toContain(obsoleteText);
      expect(environmentExample).not.toContain(obsoleteText);
    }
    expect(readme).not.toMatch(/^\s*-\s*\[\s\]/m);
    const sections = [
      '## Architecture',
      '## Requirements',
      '## Installation',
      '## Udacity Vocareum configuration',
      '## Direct Anthropic configuration',
      '## AWS Bedrock configuration',
      '## Running a review',
      '## Review specialists',
      '## MCP servers',
      '## Reports included in this repository',
      '## Offline validation',
      '## Opt-in live tests',
      '## Core technologies'
    ];

    for (
      const section
      of sections
    ) {
      expect(readme).toContain(section);
    }

    const settings = [
      'REVIEW_MAX_TURNS=80',
      'REVIEW_MAX_BUDGET_USD=1.25'
    ];

    for (
      const setting
      of settings
    ) {
      expect(readme).toContain(setting);
      expect(environmentExample).toContain(setting);
    }
    expect(readme).toContain(
      'ANTHROPIC_MODEL=claude-sonnet-4-5-20250929'
    );
    expect(environmentExample).toContain(
      'ANTHROPIC_MODEL=claude-sonnet-4-5-20250929'
    );
    expect(readme).toContain(
      'ANTHROPIC_BASE_URL=https://claude.vocareum.com'
    );
    expect(environmentExample).toContain(
      'ANTHROPIC_BASE_URL=https://claude.vocareum.com'
    );
    expect(readme).toContain('ANTHROPIC_BASE_URL` must be unset');
    expect(environmentExample).toContain('Remove or comment out ANTHROPIC_BASE_URL');
    expect(environmentExample).toContain(
      'PROJECT_ROOT=/absolute/path/to/claude-code-multi-agent-orchestrator'
    );
    expect(readme).toContain('CLAUDE_CODE_USE_BEDROCK=1');
    expect(environmentExample).toContain('CLAUDE_CODE_USE_BEDROCK=1');
  });

  it('documents all installed Claude skills', async () => {
    const skillsReadme = await readRepositoryFile('.claude/skills/README.md');
    expect(skillsReadme).not.toContain('TODO');
    expect(skillsReadme).not.toContain('## Your Task');
    const requiredTexts = [
      'javascript-best-practices',
      'typescript-patterns',
      'security-analysis',
      '## Installed skills',
      '## Runtime use',
      '## Skill format',
      '## Adding another skill'
    ];

    for (
      const requiredText
      of requiredTexts
    ) {
      expect(skillsReadme).toContain(requiredText);
    }

    for (
      const skillName
      of [
        'javascript-best-practices',
        'typescript-patterns',
        'security-analysis'
      ]
    ) {
      expect(skillsReadme).toContain(skillName);
    }
  });
});
