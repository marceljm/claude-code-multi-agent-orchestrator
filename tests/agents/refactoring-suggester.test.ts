import { describe, expect, it } from 'vitest';

import {
  refactoringSuggester
} from '../../src/agents/refactoring-suggester.js';

import {
  REFACTORING_SUGGESTER_PROMPT
} from '../../src/prompts/refactoring-suggester.prompt.js';

describe('refactoringSuggester', () => {
  it('uses the specialized refactoring prompt', () => {
    expect(refactoringSuggester.prompt).toBe(
      REFACTORING_SUGGESTER_PROMPT
    );
  });

  it('inherits the orchestrator model', () => {
    expect(refactoringSuggester.model).toBe('inherit');
  });

  it('has a description that identifies when it should run', () => {
    for (const text of ['exactly once', 'safe refactorings', 'all assigned changed files', 'one result per file']) expect(refactoringSuggester.description).toContain(text);
  });

  it('has the required read-only analysis and Skill tools', () => {
    expect(refactoringSuggester.tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Skill'
    ]);
  });

  it('cannot edit files or execute shell commands', () => {
    expect(refactoringSuggester.tools).not.toContain('Write');
    expect(refactoringSuggester.tools).not.toContain('Edit');
    expect(refactoringSuggester.tools).not.toContain('Bash');
  });
});
