// Shared types for the agent service.

export interface AgentDescriptor {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  /** Job price in micro-USDT (6 decimals) */
  price: number;
  capabilities: string[];
  /** Which QVAC model powers this agent (shown in the marketplace) */
  modelKey?: string;
}

export interface JobRequest {
  jobId: string;
  agentId: string;
  prompt: string;
  payload?: Record<string, unknown>;
  callerAccount: string;
  timestamp: number;
  /** Ledger receipt that paid for this job (from the 402 paywall) */
  paymentReceipt?: string;
  workflowId?: string;
}

export interface JobResult {
  jobId: string;
  agentId: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
  executionTimeMs: number;
  timestamp: number;
  paymentReceipt?: string;
}

export type AgentHandler = (job: JobRequest) => Promise<JobResult>;

// ── A2A (Agent-to-Agent) Types ──────────────────────────────

/** Extended job request for Agent-to-Agent calls. */
export interface A2AJobRequest extends JobRequest {
  parentJobId?: string;
  parentAgentId?: string;
  /** Recursion depth - max 2 to prevent runaway chains */
  depth: number;
  /** Budget allocated by the parent for this sub-task (micro-USDT) */
  budgetAllocation: number;
  /** Groups all jobs in the same A2A chain */
  a2aChainId: string;
}
