'use client';

// Live swarm events from the orchestrator's SSE stream, with auto-reconnect.

import { useState, useEffect, useRef, useCallback } from 'react';

export interface SwarmEvent {
  id: string;
  type: string;
  timestamp: number;
  data: Record<string, any>;
}

export interface SwarmStats {
  totalInferences: number;
  totalTokens: number;
  totalDelegated: number;
  totalAgentJobs: number;
  totalA2AHires: number;
  totalWorkflows: number;
  totalPaymentsMicro: number;
  totalPayments: number;
  modelLoads: number;
  modelUnloads: number;
  ragSearches: number;
  robotActionChunks: number;
}

export interface LiveState {
  feed: SwarmEvent[];
  agentActivity: Record<string, { jobs: number; lastActive: number }>;
  stats: SwarmStats;
  connected: boolean;
}

const INITIAL_STATS: SwarmStats = {
  totalInferences: 0, totalTokens: 0, totalDelegated: 0, totalAgentJobs: 0,
  totalA2AHires: 0, totalWorkflows: 0, totalPaymentsMicro: 0, totalPayments: 0,
  modelLoads: 0, modelUnloads: 0, ragSearches: 0, robotActionChunks: 0,
};

const MAX_FEED = 150;

export function useSSE(): LiveState {
  const [state, setState] = useState<LiveState>({
    feed: [], agentActivity: {}, stats: INITIAL_STATS, connected: false,
  });
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    esRef.current?.close();
    try {
      // Same-origin /api proxy → orchestrator
      const es = new EventSource('/api/live/stream');
      esRef.current = es;

      es.onopen = () => {
        retryRef.current = 0;
        setState((p) => ({ ...p, connected: true }));
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'init') {
            setState((p) => ({
              ...p,
              stats: data.stats ?? p.stats,
              feed: (data.recentEvents ?? []).slice(-MAX_FEED),
            }));
          }
        } catch { /* ignore */ }
      };

      es.addEventListener('protocol-event', (event: MessageEvent) => {
        try {
          const ev: SwarmEvent = JSON.parse(event.data);
          setState((p) => {
            const feed = [...p.feed, ev].slice(-MAX_FEED);
            const agentActivity = { ...p.agentActivity };
            const agentId = ev.data?.agentId;
            if (agentId) {
              agentActivity[agentId] = {
                jobs: (agentActivity[agentId]?.jobs ?? 0) + 1,
                lastActive: Date.now(),
              };
            }
            const stats = { ...p.stats };
            if (ev.type === 'inference:completed') {
              stats.totalInferences++;
              stats.totalTokens += (ev.data.promptTokens ?? 0) + (ev.data.completionTokens ?? 0);
              if (ev.data.delegated) stats.totalDelegated++;
            }
            if (ev.type === 'payment:settled') {
              stats.totalPayments++;
              stats.totalPaymentsMicro += ev.data.amount ?? 0;
            }
            if (ev.type === 'agent:job_completed') stats.totalAgentJobs++;
            if (ev.type === 'agent:a2a_hired') stats.totalA2AHires++;
            if (ev.type === 'workflow:created') stats.totalWorkflows++;
            if (ev.type === 'model:loaded') stats.modelLoads++;
            if (ev.type === 'model:unloaded') stats.modelUnloads++;
            if (ev.type === 'robot:action_chunk') stats.robotActionChunks++;
            return { ...p, feed, agentActivity, stats };
          });
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        setState((p) => ({ ...p, connected: false }));
        es.close();
        retryRef.current++;
        const delay = Math.min(3000 * 2 ** (retryRef.current - 1), 30_000);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(connect, delay);
      };
    } catch {
      setState((p) => ({ ...p, connected: false }));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [connect]);

  return state;
}
