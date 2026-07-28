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

  it('requires Skill initialization before analysis', () => {
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'Your first tool action must be a Skill invocation'
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'javascript-best-practices'
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'Do not return the final JSON before this Skill invocation completes'
    );
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
      'Return exactly one JSON object'
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'Do not wrap the JSON in Markdown'
    );
    expect(CODE_QUALITY_ANALYZER_PROMPT).toContain(
      'CodeQualityResultSchema'
    );
  });
});
