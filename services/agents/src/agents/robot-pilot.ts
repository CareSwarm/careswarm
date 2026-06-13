// Care-robot policy agent: runs SmolVLA-LIBERO on-device and returns action
// chunks for a manipulation instruction. We don't own a robot arm, so v1
// runs the policy on synthetic observations and the dashboard animates the
// predicted trajectory — clearly labeled as a policy demo, not real actuation.

import { runVla } from '@careswarm/engine';
import type { AgentDescriptor, AgentHandler, JobRequest, JobResult } from '../types.ts';

export const manifest: AgentDescriptor = {
  id: 'robot-pilot',
  name: 'Robot Pilot',
  description: 'Vision-language-action policy (SmolVLA-LIBERO) running fully on-device: instruction + camera frames -> robot action chunks. Demo mode uses synthetic observations.',
  category: 'robotics',
  version: '1.0.0',
  price: 50_000, // 0.05 USDT
  capabilities: ['vla-policy', 'action-chunks', 'manipulation'],
  modelKey: 'smolvla',
};

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';

export const handler: AgentHandler = async (job: JobRequest): Promise<JobResult> => {
  const t0 = Date.now();
  const instruction = (job.payload?.userPrompt as string) ?? job.prompt;
  try {
    const result = await runVla({
      instruction,
      chunks: 3,
      meta: { agentId: manifest.id, jobId: job.jobId, workflowId: job.workflowId },
      onChunk: (chunk, index) => {
        fetch(`${ORCHESTRATOR_URL}/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'robot:action_chunk',
            data: {
              agentId: manifest.id,
              instruction: instruction.slice(0, 60),
              chunkIndex: index,
              inferMs: Math.round(chunk.stats.total_ms ?? 0),
              visionMs: Math.round(chunk.stats.vision_ms ?? 0),
              odeMs: Math.round(chunk.stats.ode_ms ?? 0),
            },
          }),
        }).catch(() => {});
      },
    });

    return {
      jobId: job.jobId,
      agentId: manifest.id,
      status: 'success',
      result: {
        instruction,
        mode: 'policy-demo (synthetic observations — no physical robot attached)',
        hparams: result.hparams,
        // 3 chunks x 50 steps x 7 dims is chunky; keep full data for the
        // dashboard animation, it's only a few KB
        chunks: result.chunks.map((c) => ({ stats: c.stats, actions: c.actions })),
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
