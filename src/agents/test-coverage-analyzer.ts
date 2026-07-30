import type {
  AgentDefinition
} from '@anthropic-ai/claude-agent-sdk';

import {
  TEST_COVERAGE_ANALYZER_PROMPT
} from '../prompts/test-coverage-analyzer.prompt.js';

export const testCoverageAnalyzer:
  AgentDefinition = {
    description:
      'Invoke this agent exactly once to analyze test coverage for all assigned changed files, use relevant Claude Skills when useful, and return one result per file.',

    prompt:
      TEST_COVERAGE_ANALYZER_PROMPT,

    tools: [
      'Read',
      'Grep',
      'Glob',
      'Skill'
    ],

    model:
      'inherit'
  };
