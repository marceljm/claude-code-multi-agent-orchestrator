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

  it('instructs the agent to use Claude Skills', () => {
    expect(REFACTORING_SUGGESTER_PROMPT).toContain('Skill tool');
    expect(REFACTORING_SUGGESTER_PROMPT).toContain(
      'javascript-best-practices'
    );
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
      'Return exactly one JSON object'
    );
    expect(REFACTORING_SUGGESTER_PROMPT).toContain(
      'Do not wrap the JSON in Markdown'
    );
    expect(REFACTORING_SUGGESTER_PROMPT).toContain(
      'RefactoringSuggestionSchema'
    );
  });
});
