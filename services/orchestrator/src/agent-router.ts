// Discovers agents from the agents service and executes jobs through the
// auto-paying 402 client — every job is a micropayment.

import { LedgerPaymentClient, formatUSDT } from '@careswarm/payments';
import { eventBus } from './event-bus.ts';

// ── Types ────────────────────────────────────────────────────

export interface AgentManifest {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  /** micro-USDT per job */
  price: number;
  capabilities: string[];
  modelKey?: string;
}

export interface AgentExecutionResult {
  jobId: string;
  agentId: string;
  status: 'success' | 'error';
  result?: any;
  error?: string;
  executionTimeMs: number;
  timestamp: number;
  /** ledger receipt that paid for this job */
  paymentReceipt?: string;
}

// ── Config ───────────────────────────────────────────────────

const AGENTS_SERVICE_URL = process.env.AGENTS_URL || 'http://localhost:3001';

// ── Agent Router Class ───────────────────────────────────────

export class AgentRouter {
  private agentCache: Map<string, AgentManifest> = new Map();
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 30_000;
  private payer: LedgerPaymentClient;

  constructor() {
    this.payer = new LedgerPaymentClient({
      accountId: 'orchestrator',
      maxAutoPayAmount: String(2_000_000), // safety: ≤2 USDT per job
      onPayment: (proof) => {
        eventBus.emitEvent({
          type: 'payment:settled',
          data: {
            receiptId: proof.proofId,
            amount: Number(proof.amount),
            from: proof.from,
            to: proof.to,
            display: `${formatUSDT(proof.amount)} USDT`,
          },
        });
      },
    });
  }

  /** Refresh the agent registry from the agents service. */
  async refreshAgents(): Promise<AgentManifest[]> {
    const now = Date.now();
    if (now - this.cacheTimestamp < this.CACHE_TTL_MS && this.agentCache.size > 0) {
      return [...this.agentCache.values()];
    }

    try {
      const res = await fetch(`${AGENTS_SERVICE_URL}/agents`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = (await res.json()) as AgentManifest[];
      this.agentCache.clear();
      for (const agent of data) {
        this.agentCache.set(agent.id, agent);
      }
      this.cacheTimestamp = now;
      console.log(`[router] Refreshed agent registry: ${this.agentCache.size} agents available`);
      return data;
    } catch (err: any) {
      console.error(`[router] Failed to refresh agents:`, err.message);
      return [...this.agentCache.values()];
    }
  }

  getManifest(agentId: string): AgentManifest | undefined {
    return this.agentCache.get(agentId);
  }

  /**
   * Execute a single agent job — pays the 402 paywall automatically from
   * the orchestrator's ledger account.
   */
  async executeAgent(
    agentId: string,
    prompt: string,
    payload?: Record<string, unknown>,
    workflowId?: string,
  ): Promise<AgentExecutionResult> {
    const url = `${AGENTS_SERVICE_URL}/agents/${agentId}/execute`;
    console.log(`[router] Executing agent '${agentId}'...`);

    let receiptId: string | undefined;
    const t0 = Date.now();
    try {
      const res = await this.payer.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, payload, workflowId }),
        // 4B inference + a tool round + model loads can stack up on 8GB
        signal: AbortSignal.timeout(600_000),
      });
      // capture the receipt the client attached on retry
      receiptId = (res as Response).headers.get('x-payment-receipt') ?? undefined;
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as AgentExecutionResult;
      data.paymentReceipt = data.paymentReceipt ?? receiptId;
      console.log(
        `[router] Agent '${agentId}' returned: ${data.status} (${data.executionTimeMs}ms)`,
      );
      return data;
    } catch (err: any) {
      console.error(`[router] Agent '${agentId}' failed:`, err.message);
      return {
        jobId: '',
        agentId,
        status: 'error',
        error: err.message,
        executionTimeMs: Date.now() - t0,
        timestamp: Date.now(),
      };
    }
  }

  async listAgents(): Promise<AgentManifest[]> {
    return this.refreshAgents();
  }

  /** Total cost (micro-USDT) of the agents used by a plan's steps. */
  calculateCost(agentIds: string[]): number {
    return agentIds.reduce((sum, id) => sum + (this.agentCache.get(id)?.price ?? 0), 0);
  }
}
