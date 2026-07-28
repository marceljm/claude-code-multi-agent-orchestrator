import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

export const refactoringSuggester: AgentDefinition = {
  description:
    'Invoke this agent to identify refactoring opportunities involving modernization and design-pattern improvements.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit'
};
