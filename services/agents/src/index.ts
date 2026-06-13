// Agents service (:3001) — specialist agents behind an HTTP 402 paywall.
// Every job, human- or agent-initiated, is a micropayment.
//
//   GET  /agents                  list manifests
//   POST /agents/:id/execute      run a job (402-gated)
//   POST /agents/:id/a2a-execute  agent-hires-agent (402-gated)

import express from 'express';
import { paymentRequired, verifyReceipt, ensureAccount } from '@careswarm/payments';
import { relayEngineEvents } from '@careswarm/engine';

import * as triage from './agents/triage.ts';
import * as librarian from './agents/librarian.ts';
import * as clinician from './agents/clinician.ts';
import * as scribe from './agents/scribe.ts';
import * as translator from './agents/translator.ts';
import * as robotPilot from './agents/robot-pilot.ts';

import type { AgentDescriptor, AgentHandler, JobRequest, A2AJobRequest } from './types.ts';

process.env.CARESWARM_PROCESS = process.env.CARESWARM_PROCESS ?? 'agents';

// ── Registry ──────────────────────────────────────────────

const registry = new Map<string, { manifest: AgentDescriptor; handler: AgentHandler }>([
  [triage.manifest.id, { manifest: triage.manifest, handler: triage.handler }],
  [librarian.manifest.id, { manifest: librarian.manifest, handler: librarian.handler }],
  [clinician.manifest.id, { manifest: clinician.manifest, handler: clinician.handler }],
  [scribe.manifest.id, { manifest: scribe.manifest, handler: scribe.handler }],
  [translator.manifest.id, { manifest: translator.manifest, handler: translator.handler }],
  [robotPilot.manifest.id, { manifest: robotPilot.manifest, handler: robotPilot.handler }],
]);

// Seed ledger accounts for every agent (working capital for A2A hiring)
for (const id of registry.keys()) ensureAccount(`agent:${id}`);

// ── Server ────────────────────────────────────────────────

const app = express();
const PORT = Number(process.env.AGENTS_PORT ?? 3001);

app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Proof');
  next();
});

// Relay model loads / inference metrics to the orchestrator's SSE feed
relayEngineEvents();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: registry.size, timestamp: Date.now() });
});

app.get('/agents', (_req, res) => {
  res.json([...registry.values()].map((e) => e.manifest));
});

app.get('/agents/:id', (req, res) => {
  const entry = registry.get(req.params.id);
  if (!entry) return res.status(404).json({ error: `Agent '${req.params.id}' not found` });
  res.json(entry.manifest);
});

/** 402 paywall for an agent: pay `price` micro-USDT to account `agent:<id>`. */
function paywallFor(agentId: string) {
  const entry = registry.get(agentId);
  if (!entry) return null;
  return paymentRequired({
    payTo: `agent:${agentId}`,
    amount: String(entry.manifest.price),
    description: `${entry.manifest.name}: ${entry.manifest.capabilities[0]}`,
    verifyPayment: async (proofId) =>
      verifyReceipt(proofId, { to: `agent:${agentId}`, amount: String(entry.manifest.price) }).valid,
  });
}

// POST /agents/:id/execute — 402-gated job execution
app.post('/agents/:id/execute', (req, res, next) => {
  const paywall = paywallFor(req.params.id);
  if (!paywall) return res.status(404).json({ error: `Agent '${req.params.id}' not found` });
  paywall(req, res, next);
}, async (req: express.Request & { paymentProof?: string }, res) => {
  const entry = registry.get(req.params.id)!;
  const job: JobRequest = {
    jobId: req.body.jobId ?? crypto.randomUUID(),
    agentId: req.params.id,
    prompt: req.body.prompt ?? '',
    payload: req.body.payload,
    callerAccount: req.body.callerAccount ?? 'user',
    timestamp: Date.now(),
    paymentReceipt: req.paymentProof,
    workflowId: req.body.workflowId,
  };

  try {
    const result = await entry.handler(job);
    res.setHeader('X-Payment-Receipt', req.paymentProof ?? '');
    res.json({ ...result, paymentReceipt: req.paymentProof });
  } catch (err: any) {
    res.status(500).json({
      jobId: job.jobId,
      agentId: req.params.id,
      status: 'error',
      error: err.message ?? String(err),
      executionTimeMs: 0,
      timestamp: Date.now(),
    });
  }
});

// POST /agents/:id/a2a-execute — agent-hires-agent, also 402-gated
app.post('/agents/:id/a2a-execute', (req, res, next) => {
  const paywall = paywallFor(req.params.id);
  if (!paywall) return res.status(404).json({ error: `Agent '${req.params.id}' not found` });
  paywall(req, res, next);
}, async (req: express.Request & { paymentProof?: string }, res) => {
  const entry = registry.get(req.params.id)!;
  const a2aJob: A2AJobRequest = {
    jobId: req.body.jobId ?? crypto.randomUUID(),
    agentId: req.params.id,
    prompt: req.body.prompt ?? '',
    payload: req.body.payload,
    callerAccount: req.body.callerAccount ?? '',
    timestamp: Date.now(),
    paymentReceipt: req.paymentProof,
    workflowId: req.body.workflowId,
    parentJobId: req.body.parentJobId,
    parentAgentId: req.body.parentAgentId,
    a2aChainId: req.body.a2aChainId ?? `chain-${Date.now()}`,
    depth: req.body.depth ?? 1,
    budgetAllocation: req.body.budgetAllocation ?? 0,
  };

  console.log(
    `[agents] A2A execute: ${req.params.id} (parent: ${a2aJob.parentAgentId}, depth: ${a2aJob.depth})`,
  );

  try {
    const result = await entry.handler(a2aJob);
    res.json({
      ...result,
      paymentReceipt: req.paymentProof,
      _a2a: {
        parentJobId: a2aJob.parentJobId,
        parentAgentId: a2aJob.parentAgentId,
        a2aChainId: a2aJob.a2aChainId,
        depth: a2aJob.depth,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      jobId: a2aJob.jobId,
      agentId: req.params.id,
      status: 'error',
      error: err.message ?? String(err),
      executionTimeMs: 0,
      timestamp: Date.now(),
    });
  }
});

// ── Start ─────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[agents] 🐝 ${registry.size} agents behind the 402 paywall on :${PORT}`);
  console.log(`[agents] ${[...registry.keys()].join(', ')}`);
});
