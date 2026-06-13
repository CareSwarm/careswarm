// Central event bus. The SSE endpoint subscribes here and pushes
// everything to connected dashboards; emitEvent also keeps a ring log
// + running counters for the stats header.

import { EventEmitter } from 'events';

// ── Event Types ─────────────────────────────────────────────

export type SwarmEventType =
  | 'model:loading'
  | 'model:loaded'
  | 'model:unloaded'
  | 'inference:started'
  | 'inference:completed'
  | 'inference:delegated'
  | 'payment:required'
  | 'payment:settled'
  | 'agent:job_started'
  | 'agent:job_completed'
  | 'agent:job_failed'
  | 'agent:a2a_hired'
  | 'workflow:created'
  | 'workflow:step_started'
  | 'workflow:step_completed'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'rag:search'
  | 'robot:action_chunk'
  | 'settlement:plasma';

export interface SwarmEvent {
  id: string;
  type: SwarmEventType;
  timestamp: number;
  data: {
    agentId?: string;
    agentName?: string;
    modelKey?: string;
    /** micro-USDT */
    amount?: number;
    receiptId?: string;
    jobId?: string;
    workflowId?: string;
    stepIndex?: number;
    ttftMs?: number;
    tokensPerSecond?: number;
    promptTokens?: number;
    completionTokens?: number;
    delegated?: boolean;
    providerKey?: string;
    reason?: string;
    summary?: string;
    process?: string;
    [key: string]: unknown;
  };
}

// ── Event Bus Singleton ─────────────────────────────────────

class SwarmEventBus extends EventEmitter {
  private eventLog: SwarmEvent[] = [];
  private maxLogSize = 500;

  // Counters for stats (live dashboard header)
  public stats = {
    totalInferences: 0,
    totalTokens: 0,
    totalDelegated: 0,
    totalAgentJobs: 0,
    totalA2AHires: 0,
    totalWorkflows: 0,
    totalPaymentsMicro: 0, // micro-USDT moved between accounts
    totalPayments: 0,
    modelLoads: 0,
    modelUnloads: 0,
    ragSearches: 0,
    robotActionChunks: 0,
  };

  constructor() {
    super();
    this.setMaxListeners(100); // Support many SSE clients
  }

  /** Emit a swarm event and log it. */
  emitEvent(event: Omit<SwarmEvent, 'id' | 'timestamp'>): SwarmEvent {
    const fullEvent: SwarmEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    this.updateStats(fullEvent);

    this.eventLog.push(fullEvent);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }

    this.emit('protocol-event', fullEvent);

    console.log(
      `[event-bus] 📡 ${fullEvent.type} - ${fullEvent.data.agentId || fullEvent.data.modelKey || 'system'}`,
    );
    return fullEvent;
  }

  getRecentEvents(limit = 50): SwarmEvent[] {
    return this.eventLog.slice(-limit);
  }

  getStats() {
    return { ...this.stats };
  }

  private updateStats(event: SwarmEvent) {
    switch (event.type) {
      case 'inference:completed':
        this.stats.totalInferences++;
        this.stats.totalTokens +=
          (event.data.promptTokens ?? 0) + (event.data.completionTokens ?? 0);
        if (event.data.delegated) this.stats.totalDelegated++;
        break;
      case 'inference:delegated':
        this.stats.totalDelegated++;
        break;
      case 'payment:settled':
        this.stats.totalPayments++;
        this.stats.totalPaymentsMicro += event.data.amount ?? 0;
        break;
      case 'agent:job_completed':
        this.stats.totalAgentJobs++;
        break;
      case 'agent:a2a_hired':
        this.stats.totalA2AHires++;
        break;
      case 'workflow:created':
        this.stats.totalWorkflows++;
        break;
      case 'model:loaded':
        this.stats.modelLoads++;
        break;
      case 'model:unloaded':
        this.stats.modelUnloads++;
        break;
      case 'rag:search':
        this.stats.ragSearches++;
        break;
      case 'robot:action_chunk':
        this.stats.robotActionChunks++;
        break;
    }
  }
}

// Export singleton
export const eventBus = new SwarmEventBus();
