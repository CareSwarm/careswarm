// Clinical reasoning. Can call the search_guidelines tool mid-reasoning, which
// hires the librarian over a paid A2A call (max 2 rounds, then it answers).
//
// Model: MedPsy-1.7B by default so the whole swarm fits an 8GB laptop without
// swap thrash. When a P2P provider session exists the heavier MedPsy-4B runs
// delegated on that box instead (set CLINICIAN_MODEL=medpsy_4b to force 4B
// locally on a roomier machine).

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { complete } from '@careswarm/engine';
import type { ChatMessage, ToolDef, ModelKey } from '@careswarm/engine';
import { hireAgent } from '../a2a-client.ts';
import type { AgentDescriptor, AgentHandler, JobRequest, JobResult } from '../types.ts';

const LOCAL_MODEL = (process.env.CLINICIAN_MODEL as ModelKey) ?? 'medpsy_1_7b';

export const manifest: AgentDescriptor = {
  id: 'clinician',
  name: 'Clinician',
  description: 'Clinical reasoning over the triage + guideline context. Hires the Guideline Librarian mid-inference when it needs sources (paid A2A tool call). Runs MedPsy-1.7B locally on 8GB, or MedPsy-4B when delegated to a P2P provider.',
  category: 'health',
  version: '1.0.0',
  price: 100_000, // 0.10 USDT
  capabilities: ['clinical-reasoning', 'differential-diagnosis', 'tool-calling', 'a2a-hiring', 'p2p-delegation'],
  modelKey: 'medpsy_1_7b',
};

const SYSTEM = `You are a careful clinician assistant analyzing a case on a privacy-preserving local device.
You receive triage findings and guideline passages as context. If you need additional guideline evidence on a specific topic, call the search_guidelines tool.
Structure your final answer as:
1. Assessment (most likely explanations, max 3)
2. What to do now (concrete next steps)
3. Warning signs that require emergency care
Keep the final answer under 250 words. You are NOT a doctor and must say so.`;

/** Read the delegated-inference session written by `npm run provider` (P2P mode). */
function delegateOptions(): { providerPublicKey: string; fallbackToLocal: boolean } | undefined {
  try {
    const p = path.join(process.env.CARESWARM_DATA_DIR ?? path.join(process.cwd(), 'data'), 'provider-session.json');
    const session = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      providerPublicKey?: string;
      expiresAt?: number;
    };
    if (session.providerPublicKey && (!session.expiresAt || session.expiresAt > Date.now())) {
      return { providerPublicKey: session.providerPublicKey, fallbackToLocal: true };
    }
  } catch {
    /* no provider session — run locally */
  }
  return undefined;
}

export const handler: AgentHandler = async (job: JobRequest): Promise<JobResult> => {
  const t0 = Date.now();
  const userPrompt = (job.payload?.userPrompt as string) ?? job.prompt;
  const context = (job.payload?.context as Record<string, unknown>) ?? {};

  const searchTool: ToolDef = {
    name: 'search_guidelines',
    description: 'Search the local medical guidelines corpus for evidence on a specific topic. Returns cited passages.',
    schema: z.object({
      query: z.string().describe('What to search for, e.g. "exertional chest pain workup"'),
    }),
  };

  const contextBlock = Object.entries(context)
    .map(([k, v]) => `### ${k}\n${JSON.stringify(v, null, 1).slice(0, 1200)}`)
    .join('\n\n');

  const history: ChatMessage[] = [
    {
      role: 'user',
      content: `Case: ${userPrompt}\n\nInstruction: ${job.prompt}\n\nContext from previous agents:\n${contextBlock || '(none)'}`,
    },
  ];

  const delegate = delegateOptions();
  // Delegated → the provider hosts 4B; local → light 1.7B so 8GB stays smooth.
  const modelKey: ModelKey = delegate ? 'medpsy_4b' : LOCAL_MODEL;
  const toolCallsMade: Array<{ query: string; receipt?: string }> = [];
  let thinkingText = '';
  let finalText = '';
  let lastStats: unknown = null;

  try {
    for (let round = 0; round < 3; round++) {
      const res = await complete({
        modelKey,
        system: SYSTEM,
        history,
        tools: [searchTool],
        captureThinking: true,
        maxTokens: 1200,
        delegate,
        meta: { agentId: manifest.id, jobId: job.jobId, workflowId: job.workflowId },
        paymentReceipt: job.paymentReceipt,
      });
      thinkingText += res.thinkingText;
      lastStats = res.stats;

      const call = res.toolCalls.find((t) => t.name === 'search_guidelines');
      if (!call || round === 2) {
        finalText = res.contentText;
        break;
      }

      // Tool call → hire the librarian over a paid A2A request
      const query = (call.arguments as { query: string }).query;
      console.log(`[clinician] 🔧 search_guidelines("${query}") → hiring librarian (A2A)`);
      const sub = await hireAgent({
        parentAgentId: manifest.id,
        parentJobId: job.jobId,
        agentId: 'librarian',
        prompt: query,
        payload: { query },
        workflowId: job.workflowId,
      });
      toolCallsMade.push({ query, receipt: sub.paymentReceipt });

      history.push({ role: 'assistant', content: `[called search_guidelines("${query}")]` });
      history.push({
        role: 'user',
        content: `Tool result (search_guidelines):\n${JSON.stringify(sub.result, null, 1).slice(0, 1500)}\n\nContinue your analysis and give the final structured answer.`,
      });
    }

    return {
      jobId: job.jobId,
      agentId: manifest.id,
      status: 'success',
      result: {
        assessment: finalText,
        thinking: thinkingText.slice(0, 4000),
        guidelineSearches: toolCallsMade,
        delegated: Boolean(delegate),
        stats: lastStats,
      },
      executionTimeMs: Date.now() - t0,
      timestamp: Date.now(),
      paymentReceipt: job.paymentReceipt,
    };
  } catch (err: any) {
    return {
      jobId: job.jobId,
      agentId: manifest.id,
      status: 'error',
      error: err.message,
      executionTimeMs: Date.now() - t0,
      timestamp: Date.now(),
    };
  }
};
