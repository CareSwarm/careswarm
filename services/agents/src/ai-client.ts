// Shared AI client for all agents — everything goes through the engine
// (QVAC on-device). No cloud AI anywhere in this repo.

import { complete, completeJSON } from '@careswarm/engine';
import type { ModelKey, ToolDef, CompleteResult } from '@careswarm/engine';
import type { z } from 'zod';

export interface AiCompleteOptions {
  modelKey?: ModelKey;
  maxTokens?: number;
  tools?: ToolDef[];
  captureThinking?: boolean;
  noThink?: boolean;
  agentId?: string;
  jobId?: string;
  workflowId?: string;
  paymentReceipt?: string;
  onDelta?: (text: string) => void;
  onThinking?: (text: string) => void;
}

export async function aiComplete(
  system: string,
  user: string,
  opts: AiCompleteOptions = {},
): Promise<CompleteResult> {
  return complete({
    modelKey: opts.modelKey ?? 'medpsy_1_7b',
    system,
    history: [{ role: 'user', content: user }],
    tools: opts.tools,
    captureThinking: opts.captureThinking,
    noThink: opts.noThink,
    maxTokens: opts.maxTokens ?? 1024,
    meta: { agentId: opts.agentId, jobId: opts.jobId, workflowId: opts.workflowId },
    paymentReceipt: opts.paymentReceipt,
    onDelta: opts.onDelta,
    onThinking: opts.onThinking,
  });
}

/** Structured output against a Zod + JSON schema (grammar-constrained). */
export async function aiCompleteJSON<T>(
  system: string,
  user: string,
  zodSchema: z.ZodType<T>,
  jsonSchema: Record<string, unknown>,
  opts: AiCompleteOptions = {},
): Promise<T> {
  return completeJSON(
    opts.modelKey ?? 'medpsy_1_7b',
    system,
    user,
    zodSchema,
    jsonSchema,
    { agentId: opts.agentId, jobId: opts.jobId, workflowId: opts.workflowId },
  );
}
