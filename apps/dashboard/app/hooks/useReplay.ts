'use client';

// Replay-mode analog of useSSE: instead of an SSE backend it plays the
// recorded events from /public/replay into the same LiveState shape, and
// surfaces the recorded workflow result. Auto-plays once on load.

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LiveState, SwarmEvent, SwarmStats } from './useSSE';
import { loadReplay, playEvents } from '../lib/replay';

const INITIAL_STATS: SwarmStats = {
  totalInferences: 0, totalTokens: 0, totalDelegated: 0, totalAgentJobs: 0,
  totalA2AHires: 0, totalWorkflows: 0, totalPaymentsMicro: 0, totalPayments: 0,
  modelLoads: 0, modelUnloads: 0, ragSearches: 0, robotActionChunks: 0,
};
const MAX_FEED = 150;
const FRESH: LiveState = { feed: [], agentActivity: {}, stats: INITIAL_STATS, connected: true };

// Same fold as useSSE's protocol-event handler.
function apply(p: LiveState, ev: SwarmEvent): LiveState {
  const feed = [...p.feed, ev].slice(-MAX_FEED);
  const agentActivity = { ...p.agentActivity };
  const agentId = ev.data?.agentId;
  if (agentId) {
    agentActivity[agentId] = { jobs: (agentActivity[agentId]?.jobs ?? 0) + 1, lastActive: Date.now() };
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
}

export function useReplay() {
  const [live, setLive] = useState<LiveState>(FRESH);
  const [result, setResult] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const events = useRef<SwarmEvent[]>([]);
  const workflow = useRef<any>(null);
  const cancel = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      loadReplay<{ events: SwarmEvent[] }>('events'),
      loadReplay<any>('workflow'),
    ]).then(([e, w]) => {
      events.current = e?.events ?? [];
      workflow.current = w;
      setReady(true);
    });
  }, []);

  const play = useCallback(() => {
    cancel.current?.();
    setLive(FRESH);
    setResult(null);
    setPlaying(true);
    cancel.current = playEvents(
      events.current,
      (ev) => setLive((p) => apply(p, ev)),
      () => { setResult(workflow.current); setPlaying(false); },
    );
  }, []);

  // auto-play once the recording is loaded
  useEffect(() => {
    if (ready && events.current.length) play();
    return () => cancel.current?.();
  }, [ready, play]);

  return { live, result, play, playing };
}
