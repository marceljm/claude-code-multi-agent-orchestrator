import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Invoke this agent to analyze assigned files for code quality issues, including security, performance, maintainability, bugs, style, and best practices.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit'
};
