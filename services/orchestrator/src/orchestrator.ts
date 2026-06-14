// Orchestrator (:4000): prompt -> intent parser -> workflow engine ->
// agents hired over 402 -> SSE live feed.

import express from 'express';
import { IntentParser } from './intent-parser.ts';
import { AgentRouter } from './agent-router.ts';
import { WorkflowEngine } from './workflow-engine.ts';
import { LedgerEscrow } from './ledger-escrow.ts';
import { StateTracker } from './state-tracker.ts';
import { eventBus } from './event-bus.ts';
import { sseRouter } from './sse-server.ts';
import {
  managerState,
  aggregateMetrics,
  readAuditLog,
  onEngineEvent,
  shutdownModels,
  forceUnload,
} from '@careswarm/engine';
import { balances, listTransfers, verifyChain, formatUSDT, settleOnPlasma } from '@careswarm/payments';

process.env.CARESWARM_PROCESS = process.env.CARESWARM_PROCESS ?? 'orchestrator';

const PORT = Number(process.env.ORCHESTRATOR_PORT ?? 4000);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Proof');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

const parser = new IntentParser();
const router = new AgentRouter();
const escrow = new LedgerEscrow();
const engine = new WorkflowEngine(router, escrow);
const state = new StateTracker();

// Engine events from THIS process (orchestrator model) → SSE bus
onEngineEvent((e) => {
  if (e.event === 'model_load') {
    eventBus.emitEvent({
      type: 'model:loaded',
      data: { modelKey: e.modelKey, source: e.source, loadMs: e.loadMs, ramEstGB: e.ramEstGB, process: e.process },
    });
  } else if (e.event === 'model_unload') {
    eventBus.emitEvent({
      type: 'model:unloaded',
      data: { modelKey: e.modelKey, reason: e.reason, process: e.process },
    });
  } else if (e.event === 'inference') {
    eventBus.emitEvent({
      type: 'inference:completed',
      data: {
        modelKey: e.modelKey,
        agentId: e.agentId,
        delegated: e.delegated,
        ttftMs: e.ttftMs,
        tokensPerSecond: e.tokensPerSecond,
        promptTokens: e.promptTokens,
        completionTokens: e.completionTokens,
        process: e.process,
      },
    });
  }
});

// ── Routes ───────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'orchestrator', uptime: process.uptime() });
});

/**
 * POST /api/orchestrate { prompt, callerAccount? }
 * Main entry: parse → plan → execute → respond with full workflow.
 */
app.post('/api/orchestrate', async (req, res) => {
  const { prompt, callerAccount = 'user' } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const request = state.createRequest(prompt, callerAccount);
  try {
    state.updateStatus(request.id, 'parsing');
    const plan = await parser.parse(prompt, { jobId: request.id });

    // Planning is done — free the planner model so the agents process has the
    // full RAM budget for MedPsy-4B during the workflow (8GB machine).
    await forceUnload('orchestrator');

    state.updateStatus(request.id, 'routing', { intent: plan });
    const workflow = await engine.createWorkflow(plan, prompt, callerAccount);
    state.updateStatus(request.id, 'executing', { workflowId: workflow.id });

    const finished = await engine.executeWorkflow(workflow.id);
    state.updateStatus(request.id, finished.status === 'settled' ? 'completed' : 'failed', {
      result: finished.results.at(-1)?.result,
    });

    res.json({
      requestId: request.id,
      plan,
      workflow: finished,
      finalOutput: finished.results.at(-1)?.result ?? null,
    });
  } catch (err: any) {
    state.updateStatus(request.id, 'failed', { error: err.message });
    res.status(500).json({ error: err.message, requestId: request.id });
  }
});

/** Dry-run: parse + create the workflow without executing. */
app.post('/api/workflow', async (req, res) => {
  const { prompt, callerAccount = 'user' } = req.body ?? {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  try {
    const plan = await parser.parse(prompt);
    const workflow = await engine.createWorkflow(plan, prompt, callerAccount);
    res.json({ plan, workflow });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workflow/:id', (req, res) => {
  const wf = engine.getWorkflow(req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  res.json(wf);
});

app.get('/api/workflows', (_req, res) => {
  res.json(engine.listWorkflows().slice(0, 20));
});

/** Agents registry proxy (dashboard marketplace) */
app.get('/api/agents', async (_req, res) => {
  res.json(await router.listAgents());
});

/** QVAC model manager state (this process) */
app.get('/api/models', (_req, res) => {
  res.json(managerState());
});

/** Aggregated audit-log metrics + recent inferences (dashboard /metrics) */
app.get('/api/metrics', (_req, res) => {
  res.json({
    aggregate: aggregateMetrics(),
    recent: readAuditLog(200),
  });
});

/** Ledger balances + transfers + chain integrity (dashboard /economy) */
app.get('/api/ledger', (_req, res) => {
  res.json({
    balances: balances().map((b) => ({ ...b, display: `${formatUSDT(b.balance)} USDT` })),
    transfers: listTransfers(100),
    chain: verifyChain(),
  });
});

app.get('/api/stats', (_req, res) => {
  res.json({ system: state.getStats(), swarm: eventBus.getStats() });
});

/** Optional: anchor the receipt chain on Plasma testnet (PLASMA_MODE=on) */
app.post('/api/settle', async (_req, res) => {
  try {
    const result = await settleOnPlasma();
    eventBus.emitEvent({ type: 'settlement:plasma', data: { ...result } });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.use(sseRouter);

// ── Start ────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n🐝 CareSwarm orchestrator listening on :${PORT}`);
  console.log(`   POST /api/orchestrate  — run a request through the swarm`);
  console.log(`   GET  /api/live/stream  — SSE live feed\n`);
});

process.on('SIGINT', async () => {
  console.log('\n[orchestrator] shutting down…');
  server.close();
  await shutdownModels();
  process.exit(0);
});
