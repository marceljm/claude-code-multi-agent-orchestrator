import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { codeQualityAnalyzer, refactoringSuggester, testCoverageAnalyzer } from '../src/agents/index.js';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../src/prompts/code-quality-analyzer.prompt.js';

const skills = [
  { name: 'javascript-best-practices', headings: ['# JavaScript Best Practices Analyzer', '## Output:'] },
  { name: 'typescript-patterns', headings: ['# TypeScript Patterns', '## Type Safety', '## Narrowing and Runtime Validation', '## API and Data Modeling', '## Generics', '## Async and Error Handling', '## Common Risk Patterns', '## Severity Guidance', '## Output'] },
  { name: 'security-analysis', headings: ['# Security Analysis', '## Trust Boundaries and Validation', '## Injection Risks', '## Authentication and Authorization', '## Secrets and Cryptography', '## Data Exposure and Logging', '## Dependencies and Deserialization', '## Severity Guidance', '## Output'] }
];

async function readRepositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('Claude Skills rubric', () => {
  it('installs every required skill with valid front matter and guidance', async () => {
    for (const skill of skills) {
      const content = await readRepositoryFile(`.claude/skills/${skill.name}/SKILL.md`);
      expect(content).toMatch(/^---\n[\s\S]*?\n---\n/);
      expect(content).toMatch(/^description:\s+\S.+$/m);
      expect(content).not.toMatch(/\bTODO\b/);
      expect(content.split('\n').length).toBeLessThanOrEqual(500);
      for (const heading of skill.headings) expect(content).toContain(heading);
    }
  });

  it('wires all required skills into only the code-quality specialist', () => {
    expect(codeQualityAnalyzer.tools).toEqual(['Read', 'Grep', 'Glob', 'Skill']);
    expect(testCoverageAnalyzer.tools).not.toContain('Skill');
    expect(refactoringSuggester.tools).not.toContain('Skill');
    for (const skill of ['security-analysis', 'typescript-patterns', 'javascript-best-practices']) {
      expect(codeQualityAnalyzer.description).toContain(skill);
      expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(skill);
    }
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('Invoke security-analysis exactly once for every review.');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('Invoke typescript-patterns exactly once');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('Invoke javascript-best-practices exactly once');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('Do not invoke an irrelevant language skill.');
  });

  it('documents every installed skill and its runtime selection rules', async () => {
    const readme = await readRepositoryFile('.claude/skills/README.md');
    for (const skill of skills) expect(readme).toContain(skill.name);
    expect(readme).toContain('Security guidance is required for every review.');
    expect(readme).toContain('TypeScript guidance is required');
    expect(readme).toContain('JavaScript guidance is required');
  });
});
