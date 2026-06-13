// complete() wraps QVAC completion(): streams deltas, measures TTFT,
// validates tool calls with zod, and logs every inference to the audit file.

import { completion } from '@qvac/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { acquire, release, type DelegateOptions } from './model-manager.ts';
import { spec } from './registry.ts';
import { logEvent, now, processName } from './metrics-logger.ts';
import type {
  ChatMessage,
  CompleteOptions,
  CompleteResult,
  CompletionStats,
  ParsedToolCall,
  ToolDef,
} from './types.ts';

/** Convert a Zod object schema into QVAC's flat tool-parameters JSON schema. */
function zodToToolParameters(schema: z.ZodTypeAny): {
  type: 'object';
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
} {
  const def = (schema as z.ZodObject<z.ZodRawShape>).shape;
  if (!def) return { type: 'object', properties: {} };
  const properties: Record<string, { type: string; description?: string; enum?: string[] }> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(def)) {
    let f: z.ZodTypeAny = field as z.ZodTypeAny;
    let optional = false;
    // unwrap optional/default
    while (f instanceof z.ZodOptional || f instanceof z.ZodDefault) {
      optional = true;
      f = (f as z.ZodOptional<z.ZodTypeAny>).unwrap
        ? (f as z.ZodOptional<z.ZodTypeAny>).unwrap()
        : (f._def as { innerType: z.ZodTypeAny }).innerType;
    }
    const desc = (f as { description?: string }).description;
    let prop: { type: string; description?: string; enum?: string[] };
    if (f instanceof z.ZodEnum) {
      prop = { type: 'string', enum: (f.options as string[]).map(String) };
    } else if (f instanceof z.ZodNumber) {
      prop = { type: 'number' };
    } else if (f instanceof z.ZodBoolean) {
      prop = { type: 'boolean' };
    } else if (f instanceof z.ZodArray) {
      prop = { type: 'array' };
    } else if (f instanceof z.ZodObject) {
      prop = { type: 'object' };
    } else {
      prop = { type: 'string' };
    }
    if (desc) prop.description = desc;
    properties[name] = prop;
    if (!optional) required.push(name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function toQvacTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: zodToToolParameters(t.schema),
  }));
}

export interface CompleteExtras {
  /** Delegate this inference to a P2P provider (clinician delegated mode) */
  delegate?: DelegateOptions;
  /** Force JSON output against a JSON schema (grammar-constrained) */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** Disable Qwen3 thinking (faster, cleaner for summarize/translate jobs) */
  noThink?: boolean;
}

export async function complete(
  opts: CompleteOptions & CompleteExtras,
): Promise<CompleteResult> {
  const s = spec(opts.modelKey);
  const history: ChatMessage[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...opts.history]
    : [...opts.history];

  const { modelId, delegated } = await acquire(opts.modelKey, {
    delegate: opts.delegate,
  });

  const inferenceId = `inf-${randomUUID().slice(0, 8)}`;
  const t0 = performance.now();
  let ttftMs: number | null = null;
  let text = '';
  let thinking = '';
  const rawToolCalls: Array<{ name: string; arguments: unknown }> = [];
  let sdkStats: Record<string, number | string | undefined> = {};
  let stopReason = 'unknown';

  try {
    const run = completion({
      modelId,
      history: history as never,
      stream: true,
      ...(opts.tools?.length ? { tools: toQvacTools(opts.tools) as never } : {}),
      // Always capture thinking so <think> blocks never leak into contentText
      captureThinking: true,
      ...(opts.jsonSchema
        ? {
            responseFormat: {
              type: 'json_schema' as const,
              json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
            },
          }
        : {}),
      ...(opts.maxTokens || opts.jsonSchema || opts.noThink
        ? {
            generationParams: {
              ...(opts.maxTokens ? { predict: opts.maxTokens } : {}),
              // Thinking interferes with grammar-constrained JSON — disable it there
              ...(opts.jsonSchema || opts.noThink ? { reasoning_budget: 0 as const } : {}),
            },
          }
        : {}),
    } as never);

    for await (const ev of (run as { events: AsyncIterable<Record<string, never>> }).events) {
      const e = ev as {
        type: string;
        text?: string;
        call?: { name: string; arguments: unknown };
        stats?: Record<string, number>;
        stopReason?: string;
      };
      if (
        ttftMs === null &&
        ['contentDelta', 'thinkingDelta', 'toolCall'].includes(e.type)
      ) {
        ttftMs = Math.round(performance.now() - t0);
      }
      switch (e.type) {
        case 'contentDelta':
          text += e.text ?? '';
          opts.onDelta?.(e.text ?? '');
          break;
        case 'thinkingDelta':
          thinking += e.text ?? '';
          opts.onThinking?.(e.text ?? '');
          break;
        case 'toolCall':
          if (e.call) rawToolCalls.push({ name: e.call.name, arguments: e.call.arguments });
          break;
        case 'completionStats':
          sdkStats = (e.stats ?? e) as Record<string, number>;
          break;
        case 'completionDone':
          stopReason = e.stopReason ?? 'stop';
          break;
      }
    }
  } finally {
    release(opts.modelKey);
  }

  const durationMs = Math.round(performance.now() - t0);

  // Belt-and-braces: strip any <think> block that still made it into content
  if (text.includes('<think>')) {
    const m = text.match(/<think>([\s\S]*?)<\/think>/);
    if (m) thinking += m[1];
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  // Zod-validate tool calls against their declared schemas
  const toolCalls: ParsedToolCall[] = [];
  for (const call of rawToolCalls) {
    const def = opts.tools?.find((t) => t.name === call.name);
    if (!def) {
      console.warn(`[engine] model called unknown tool: ${call.name}`);
      continue;
    }
    const parsed = def.schema.safeParse(call.arguments);
    if (parsed.success) {
      toolCalls.push({ name: call.name, arguments: parsed.data });
    } else {
      console.warn(`[engine] tool args failed validation for ${call.name}:`, parsed.error.issues);
      toolCalls.push({ name: call.name, arguments: call.arguments });
    }
  }

  const stats: CompletionStats = {
    ttftMs: (sdkStats.timeToFirstToken as number) ?? ttftMs ?? durationMs,
    tokensPerSecond: (sdkStats.tokensPerSecond as number) ?? 0,
    promptTokens: (sdkStats.promptTokens as number) ?? 0,
    completionTokens: (sdkStats.generatedTokens as number) ?? 0,
    durationMs,
    stopReason,
  };

  logEvent({
    ts: now(),
    event: 'inference',
    id: inferenceId,
    modelKey: opts.modelKey,
    agentId: opts.meta?.agentId,
    jobId: opts.meta?.jobId,
    workflowId: opts.meta?.workflowId,
    delegated,
    prompt: history.map((m) => `[${m.role}] ${m.content}`).join('\n'),
    promptTokens: stats.promptTokens,
    completionTokens: stats.completionTokens,
    ttftMs: stats.ttftMs,
    tokensPerSecond: stats.tokensPerSecond,
    durationMs,
    stopReason,
    toolCallNames: toolCalls.map((t) => t.name),
    paymentReceipt: opts.paymentReceipt,
    process: processName(),
  });

  return { contentText: text, thinkingText: thinking, toolCalls, stats };
}

/** Grammar-constrained JSON against a zod schema, one retry on bad output. */
export async function completeJSON<T>(
  modelKey: CompleteOptions['modelKey'],
  system: string,
  user: string,
  zodSchema: z.ZodType<T>,
  jsonSchema: Record<string, unknown>,
  meta?: CompleteOptions['meta'],
): Promise<T> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({
      modelKey,
      system,
      history: [
        {
          role: 'user',
          content: attempt === 0 ? user : `${user}\n\nYour previous output was invalid: ${lastError}. Output valid JSON only.`,
        },
      ],
      jsonSchema: { name: 'structured_output', schema: jsonSchema },
      meta,
    });
    try {
      const parsed = zodSchema.safeParse(JSON.parse(res.contentText));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (err) {
      lastError = String(err);
    }
  }
  throw new Error(`completeJSON failed after retry: ${lastError}`);
}
