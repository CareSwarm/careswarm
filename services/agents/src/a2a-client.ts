// Agents hiring agents. The sub-agent's 402 paywall IS the escrow: the
// parent pays from its own ledger account and the receipt is the proof.
// Depth-capped so chains can't run away.

import { LedgerPaymentClient } from '@careswarm/payments';
import type { JobResult } from './types.ts';

const AGENTS_URL = process.env.AGENTS_URL ?? `http://localhost:${process.env.AGENTS_PORT ?? 3001}`;
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000';
const MAX_A2A_DEPTH = 2;

const payers = new Map<string, LedgerPaymentClient>();

function payerFor(agentId: string): LedgerPaymentClient {
  let p = payers.get(agentId);
  if (!p) {
    p = new LedgerPaymentClient({
      accountId: `agent:${agentId}`,
      maxAutoPayAmount: String(500_000), // ≤0.5 USDT per sub-task
      onPayment: (proof) => {
        // Relay the A2A payment to the dashboard live feed
        fetch(`${ORCHESTRATOR_URL}/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'agent:a2a_hired',
            data: {
              from: proof.from,
              to: proof.to,
              amount: Number(proof.amount),
              receiptId: proof.proofId,
            },
          }),
        }).catch(() => {});
      },
    });
    payers.set(agentId, p);
  }
  return p;
}

export interface HireOptions {
  parentAgentId: string;
  parentJobId: string;
  agentId: string;
  prompt: string;
  payload?: Record<string, unknown>;
  depth?: number;
  a2aChainId?: string;
  workflowId?: string;
}

/** Hire another agent as a sub-task; pays its 402 price automatically. */
export async function hireAgent(opts: HireOptions): Promise<JobResult> {
  const depth = opts.depth ?? 1;
  if (depth > MAX_A2A_DEPTH) {
    throw new Error(`A2A depth ${depth} exceeds max ${MAX_A2A_DEPTH}`);
  }

  const res = await payerFor(opts.parentAgentId).fetch(
    `${AGENTS_URL}/agents/${opts.agentId}/a2a-execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: opts.prompt,
        payload: opts.payload,
        callerAccount: `agent:${opts.parentAgentId}`,
        parentJobId: opts.parentJobId,
        parentAgentId: opts.parentAgentId,
        depth,
        a2aChainId: opts.a2aChainId ?? `chain-${opts.parentJobId}`,
        workflowId: opts.workflowId,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`A2A hire of '${opts.agentId}' failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as JobResult;
}
