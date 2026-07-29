import { describe, expect, it } from 'vitest';

import {
  CODE_QUALITY_ANALYZER_PROMPT
} from '../../src/prompts/code-quality-analyzer.prompt.js';

describe('CODE_QUALITY_ANALYZER_PROMPT', () => {
  it('defines the code-quality agent role and focus areas', () => {
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'Code Quality Analyzer'
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('security');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('performance');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('maintainability');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('best practices');
  });

  it('requires conditional Skill initialization before analysis', () => {
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('Your first tool actions must initialize the required Skills');
    for (const text of ['Invoke security-analysis exactly once for every review', 'Invoke typescript-patterns exactly once', 'Invoke javascript-best-practices exactly once', 'Complete every applicable Skill invocation before using Read, Grep, or Glob']) expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(text);
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain('Do not invoke an irrelevant language skill');
    expect(CODE_QUALITY_ANALYZER_PROMPT).toMatch(/Do not invoke any required Skill\s+more than once/);
  });

  it('documents every required output field', () => {
    for (const field of [
      'file',
      'issues',
      'line',
      'severity',
      'category',
      'description',
      'suggestion',
      'overallScore',
      'summary'
    ]) {
      expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(field);
    }
  });

  it('documents all allowed severities', () => {
    for (const severity of [
      'critical',
      'high',
      'medium',
      'low',
      'info'
    ]) {
      expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(severity);
    }
  });

  it('documents all allowed issue categories', () => {
    for (const category of [
      'security',
      'performance',
      'maintainability',
      'style',
      'bug-risk',
      'best-practice'
    ]) {
      expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(category);
    }
  });

  it('requires JSON-only structured output', () => {
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'Return exactly one JSON array'
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).toMatch(/not wrap the array in Markdown/i);
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'CodeQualityResultSchema'
    );
    for (const text of ['exactly one CodeQualityResultSchema object for every changed file', 'same order as the bundle', 'Do not omit files', 'Do not duplicate files']) expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(text);
  });
});
