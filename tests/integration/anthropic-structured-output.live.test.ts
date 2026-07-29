import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { toDraft07JsonSchema } from '../../src/types/json-schema.js';

const LIVE = process.env.RUN_LIVE_ANTHROPIC_STRUCTURED_OUTPUT === '1';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TURNS = 3;
const MAX_BUDGET_USD = 0.05;
const TIMEOUT_MS = 60_000;
const DISALLOWED_TOOLS = ['Bash', 'Write', 'Edit', 'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Skill', 'Task', 'Agent'];
const OutputSchema = z.strictObject({ ok: z.literal(true), label: z.literal('structured-output-ok') });
const OutputJSONSchema = toDraft07JsonSchema(OutputSchema);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('structured-output smoke-test contract', () => {
  it('remains tightly bounded and tool-free', () => {
    expect(MODEL).toBe('claude-haiku-4-5-20251001');
    expect(MAX_TURNS).toBe(3);
    expect(MAX_BUDGET_USD).toBe(0.05);
    expect(TIMEOUT_MS).toBe(60_000);
    expect(DISALLOWED_TOOLS).toContain('Task');
    expect(DISALLOWED_TOOLS).toContain('Agent');
  });
});

describe.skipIf(!LIVE)('Anthropic Agent SDK structured-output smoke test', () => {
  it('returns one tiny Draft 7 structured result', async () => {
    if (process.env.ANTHROPIC_BASE_URL?.trim()) throw new Error('ANTHROPIC_BASE_URL must be unset.');
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('ANTHROPIC_API_KEY is required.');
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(new Error('Structured-output smoke test exceeded 60 seconds.')), TIMEOUT_MS);
    let result: Record<string, unknown> | undefined;
    try {
      for await (const message of query({
        prompt: 'Return the requested structured result immediately. Do not call tools. Set ok to true. Set label to exactly "structured-output-ok".',
        options: {
          model: MODEL, cwd: process.cwd(), maxTurns: MAX_TURNS, maxBudgetUsd: MAX_BUDGET_USD,
          abortController, permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
          settingSources: [], tools: [], allowedTools: [], disallowedTools: [...DISALLOWED_TOOLS],
          outputFormat: { type: 'json_schema', schema: OutputJSONSchema }
        }
      })) if (isRecord(message) && message.type === 'result') result = message;
    } finally { clearTimeout(timeout); }
    if (!result) throw new Error('Agent SDK stream ended without a result message.');
    const subtype = result.subtype;
    const reportedCost = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined;
    if (subtype !== 'success') throw new Error(`Agent SDK structured-output smoke test failed. Subtype: ${typeof subtype === 'string' ? subtype : 'missing'}. Reported cost: ${reportedCost === undefined ? 'unreported' : `$${reportedCost.toFixed(6)}`}.`);
    const parsed = OutputSchema.safeParse(result.structured_output);
    if (!parsed.success) throw new Error('Successful SDK result did not contain the expected structured output.');
    expect(parsed.data).toEqual({ ok: true, label: 'structured-output-ok' });
    if (reportedCost !== undefined) expect(reportedCost).toBeLessThanOrEqual(MAX_BUDGET_USD);
  }, TIMEOUT_MS + 10_000);
});
