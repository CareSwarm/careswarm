// Fast urgency classification on MedPsy-1.7B. Output is grammar-constrained
// JSON so a small model can't break the pipeline.

import { z } from 'zod';
import { aiCompleteJSON } from '../ai-client.ts';
import type { AgentDescriptor, AgentHandler, JobRequest, JobResult } from '../types.ts';

export const manifest: AgentDescriptor = {
  id: 'triage',
  name: 'Triage Nurse',
  description: 'Fast symptom triage and urgency classification, fully on-device (MedPsy-1.7B).',
  category: 'health',
  version: '1.0.0',
  price: 20_000, // 0.02 USDT
  capabilities: ['symptom-triage', 'urgency-classification', 'red-flag-detection'],
  modelKey: 'medpsy_1_7b',
};

const triageSchema = z.object({
  level: z.enum(['emergency', 'urgent', 'routine']),
  redFlags: z.array(z.string()),
  rationale: z.string(),
  suggestedFocus: z.string(),
});

const TRIAGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['emergency', 'urgent', 'routine'] },
    redFlags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    rationale: { type: 'string' },
    suggestedFocus: { type: 'string', description: 'What the clinician should focus on' },
  },
  required: ['level', 'redFlags', 'rationale', 'suggestedFocus'],
};

const SYSTEM = `You are a careful triage nurse. Classify the urgency of the described symptoms.
- "emergency": needs immediate emergency services (severe chest pain with collapse, breathing difficulty, stroke signs, heavy bleeding)
- "urgent": should see a doctor within 24-48 hours
- "routine": can be monitored / discussed at a regular appointment
List any red flags you notice. Be conservative: when in doubt, escalate one level. Output JSON only.`;

export const handler: AgentHandler = async (job: JobRequest): Promise<JobResult> => {
  const t0 = Date.now();
  const userPrompt = (job.payload?.userPrompt as string) ?? job.prompt;
  try {
    const triage = await aiCompleteJSON(SYSTEM, `Symptoms: ${userPrompt}`, triageSchema, TRIAGE_JSON_SCHEMA, {
      modelKey: 'medpsy_1_7b',
      agentId: manifest.id,
      jobId: job.jobId,
      workflowId: job.workflowId,
    });
    return {
      jobId: job.jobId,
      agentId: manifest.id,
      status: 'success',
      result: triage,
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
