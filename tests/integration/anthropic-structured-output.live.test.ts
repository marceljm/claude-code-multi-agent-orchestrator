import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { toDraft07JsonSchema } from '../../src/types/json-schema.js';

const LIVE = process.env.RUN_LIVE_ANTHROPIC_STRUCTURED_OUTPUT === '1';
const OutputSchema = z.object({ ok: z.boolean(), label: z.string() });

describe.skipIf(!LIVE)('Anthropic Agent SDK structured-output smoke test', () => {
  it('returns one tiny Draft 7 structured result', async () => {
    expect(process.env.ANTHROPIC_BASE_URL?.trim()).toBeFalsy();
    expect(process.env.ANTHROPIC_API_KEY?.trim()).toBeTruthy();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let result: any;
    try {
      for await (const message of query({ prompt: 'Return ok=true and label exactly structured-output-ok. Do not call tools.', options: { model: 'claude-haiku-4-5-20251001', cwd: process.cwd(), maxTurns: 3, maxBudgetUsd: 0.05, abortController: controller, permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, settingSources: [], tools: [], allowedTools: [], disallowedTools: ['Bash', 'Write', 'Edit', 'Read'], outputFormat: { type: 'json_schema', schema: toDraft07JsonSchema(OutputSchema) } } })) if ((message as any).type === 'result') result = message;
    } finally { clearTimeout(timeout); }
    expect(result?.subtype).toBe('success');
    expect(OutputSchema.parse(result?.structured_output)).toEqual({ ok: true, label: 'structured-output-ok' });
    if (typeof result?.total_cost_usd === 'number') expect(result.total_cost_usd).toBeLessThanOrEqual(0.05);
  }, 70_000);
});
