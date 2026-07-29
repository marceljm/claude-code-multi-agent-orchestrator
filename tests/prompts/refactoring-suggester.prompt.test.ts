import { describe, expect, it } from 'vitest';

import {
  REFACTORING_SUGGESTER_PROMPT
} from '../../src/prompts/refactoring-suggester.prompt.js';

describe('REFACTORING_SUGGESTER_PROMPT', () => {
  it('defines the refactoring agent role and focus areas', () => {
    expect(REFACTORING_SUGGESTER_PROMPT).toContain(
      'Refactoring Suggester'
    );
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('modernization');
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('design patterns');
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('dead code');
  });

  it('requires actionable before-and-after examples', () => {
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('before');
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('after');
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('benefits');
  });

  it('uses supplied evidence and read-only tools for missing context', () => {
    expect(REFACTORING_SUGGESTER_PROMPT).toMatch(/evidence supplied by the orchestrator as the primary\s+input/);
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('specific missing context');
    expect(REFACTORING_SUGGESTER_PROMPT).toMatch(/Do\s+not invoke another agent/);
  });

  it('documents every required output field', () => {
    for (const field of [
      'file',
      'suggestions',
      'type',
      'location',
      'impact',
      'description',
      'before',
      'after',
      'benefits',
      'summary'
    ]) {
      expect(REFACTORING_SUGGESTER_PROMPT).toContain(field);
    }
  });

  it('documents all allowed types and impacts', () => {
    for (const value of [
      'extract-function',
      'rename',
      'modernize',
      'simplify',
      'pattern-improvement',
      'low',
      'medium',
      'high'
    ]) {
      expect(REFACTORING_SUGGESTER_PROMPT).toContain(value);
    }
  });

  it('requires JSON-only structured output', () => {
    expect(REFACTORING_SUGGESTER_PROMPT).toContain(
      'Return exactly one JSON array'
    );
    expect(REFACTORING_SUGGESTER_PROMPT).toMatch(/not wrap the array in Markdown/i);
    expect(REFACTORING_SUGGESTER_PROMPT).toContain(
      'RefactoringSuggestionSchema'
    );
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('same order as the bundle');
  });
});
