// Merges the swarm's findings into one patient-friendly note (MedPsy-1.7B),
// always ending with the safety disclaimer.

import { aiComplete } from '../ai-client.ts';
import type { AgentDescriptor, AgentHandler, JobRequest, JobResult } from '../types.ts';

export const manifest: AgentDescriptor = {
  id: 'scribe',
  name: 'Care Scribe',
  description: 'Writes the final patient-friendly summary and care plan from the swarm\'s findings (MedPsy-1.7B).',
  category: 'health',
  version: '1.0.0',
  price: 20_000, // 0.02 USDT
  capabilities: ['summarization', 'care-plan', 'plain-language'],
  modelKey: 'medpsy_1_7b',
};

const SYSTEM = `You are a medical scribe. Merge the findings from the triage nurse, librarian, and clinician into one clear, warm, patient-friendly note:
- "What this likely is" (plain language, no jargon)
- "What you should do" (numbered, concrete)
- "Go to emergency care immediately if" (bullet red flags)
Do not invent findings that are not in the context. End with exactly:
"⚠️ This is general information from an on-device AI assistant, not a medical diagnosis. Please consult a healthcare professional." /no_think`;

export const handler: AgentHandler = async (job: JobRequest): Promise<JobResult> => {
  const t0 = Date.now();
  const userPrompt = (job.payload?.userPrompt as string) ?? job.prompt;
  const context = (job.payload?.context as Record<string, unknown>) ?? {};

  const contextBlock = Object.entries(context)
    .map(([k, v]) => `### ${k}\n${JSON.stringify(v, null, 1).slice(0, 1500)}`)
    .join('\n\n');

  try {
    const res = await aiComplete(
      SYSTEM,
      `Original request: ${userPrompt}\n\nFindings from the swarm:\n${contextBlock || '(none)'}\n\nWrite the final note.`,
      {
        modelKey: 'medpsy_1_7b',
        maxTokens: 700,
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
      result: { note: res.contentText, stats: res.stats },
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
