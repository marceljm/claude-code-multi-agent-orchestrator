import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Invoke this agent exactly once to analyze all assigned changed files for security, performance, maintainability, bugs, style, and best-practice issues. It loads security-analysis plus the applicable typescript-patterns and javascript-best-practices skills.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  model: 'inherit'
};
