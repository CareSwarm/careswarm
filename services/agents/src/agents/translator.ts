// Translates the scribe's note into the user's language. MedPsy-1.7B is
// Qwen3-based and handles Vietnamese fine.

import { aiComplete } from '../ai-client.ts';
import type { AgentDescriptor, AgentHandler, JobRequest, JobResult } from '../types.ts';

export const manifest: AgentDescriptor = {
  id: 'translator',
  name: 'Translator',
  description: 'Translates the final care note into the user\'s language, fully on-device.',
  category: 'language',
  version: '1.0.0',
  price: 10_000, // 0.01 USDT
  capabilities: ['translation', 'vietnamese', 'multilingual'],
  modelKey: 'medpsy_1_7b',
};

const LANG_NAMES: Record<string, string> = {
  vi: 'Vietnamese', en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese', it: 'Italian',
};

export const handler: AgentHandler = async (job: JobRequest): Promise<JobResult> => {
  const t0 = Date.now();
  const target = ((job.payload?.translateTo as string) ?? 'vi').toLowerCase();
  const targetName = LANG_NAMES[target] ?? target;
  const context = (job.payload?.context as Record<string, unknown>) ?? {};

  // Find the scribe's note in the dependency context (fall back to prompt)
  const scribeOut = Object.entries(context).find(([k]) => k.includes('scribe'))?.[1] as
    | { note?: string }
    | undefined;
  const text = scribeOut?.note ?? (job.payload?.text as string) ?? job.prompt;

  try {
    const res = await aiComplete(
      `You are a precise medical translator. Translate the user's text into ${targetName}. Keep the structure, numbers, and the final disclaimer line. Output ONLY the translation. /no_think`,
      text,
      {
        modelKey: 'medpsy_1_7b',
        maxTokens: 900,
        noThink: true,
        agentId: manifest.id,
        jobId: job.jobId,
        workflowId: job.workflowId,
        paymentReceipt: job.paymentReceipt,
      },
    );
    return {
      jobId: job.jobId,
      agentId: manifest.id,
      status: 'success',
      result: { translation: res.contentText, target, stats: res.stats },
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
