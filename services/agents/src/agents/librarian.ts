// Guideline retrieval from the local corpus (QVAC RAG, no LLM) — cheapest
// agent in the swarm. Also hired by the clinician mid-inference (A2A).

import { searchCorpus } from '@careswarm/engine';
import type { AgentDescriptor, AgentHandler, JobRequest, JobResult } from '../types.ts';

export const manifest: AgentDescriptor = {
  id: 'librarian',
  name: 'Guideline Librarian',
  description: 'Retrieves relevant passages from the on-device medical guidelines corpus with citations (QVAC embeddings + RAG).',
  category: 'health',
  version: '1.0.0',
  price: 10_000, // 0.01 USDT
  capabilities: ['guideline-retrieval', 'rag-search', 'citations'],
  modelKey: 'embeddings',
};

export const handler: AgentHandler = async (job: JobRequest): Promise<JobResult> => {
  const t0 = Date.now();
  const query = (job.payload?.query as string) ?? job.prompt;
  try {
    const hits = await searchCorpus(query, 5);
    // Documents are ingested with a "[SOURCE: …]" header line — surface it as the citation
    const passages = hits.map((h, i) => {
      const m = h.content.match(/^\[SOURCE:\s*([^\]]+)\]\s*/);
      return {
        rank: i + 1,
        source: h.source ?? m?.[1] ?? 'corpus',
        score: h.score,
        excerpt: h.content.replace(/^\[SOURCE:[^\]]+\]\s*/, '').slice(0, 600),
      };
    });
    return {
      jobId: job.jobId,
      agentId: manifest.id,
      status: 'success',
      result: { query, passages },
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
