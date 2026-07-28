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
    expect(codeQualityAnalyzer.description.toLowerCase()).toContain(
      'code quality'
    );
    expect(codeQualityAnalyzer.description.toLowerCase()).toContain(
      'analy'
    );
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
