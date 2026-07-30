import type {
  AgentDefinition
} from '@anthropic-ai/claude-agent-sdk';

import {
  REFACTORING_SUGGESTER_PROMPT
} from '../prompts/refactoring-suggester.prompt.js';

export const refactoringSuggester:
  AgentDefinition = {
    description:
      'Invoke this agent exactly once to propose safe refactorings for all assigned changed files, use relevant Claude Skills when useful, and return one result per file.',

    prompt:
      REFACTORING_SUGGESTER_PROMPT,

    tools: [
      'Read',
      'Grep',
      'Glob',
      'Skill'
    ],

    model:
      'inherit'
  };
