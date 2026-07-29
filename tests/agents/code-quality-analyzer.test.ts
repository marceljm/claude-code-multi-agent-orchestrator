import { describe, expect, it } from 'vitest';

import { codeQualityAnalyzer } from '../../src/agents/code-quality-analyzer.js';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../../src/prompts/code-quality-analyzer.prompt.js';

describe('codeQualityAnalyzer', () => {
  it('defines a read-only Code Quality Analyzer subagent', () => {
    expect(codeQualityAnalyzer).toMatchObject({
      model: 'inherit',
      prompt: CODE_QUALITY_ANALYZER_PROMPT,
      tools: ['Read', 'Grep', 'Glob', 'Skill']
    });
  });

  it('describes when the orchestrator should invoke it', () => {
    for (const text of ['exactly once', 'all assigned changed files', 'security', 'performance', 'maintainability', 'applicable']) expect(codeQualityAnalyzer.description.toLowerCase()).toContain(text);
  });

  it('does not allow tools outside its read-only analysis toolset', () => {
    expect(codeQualityAnalyzer.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Skill'
    ]);
  });
});
