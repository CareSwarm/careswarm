'use client';

// Real-time activity stream + stat cards.

import { useState } from 'react';
import type { LiveState, SwarmEvent } from '../hooks/useSSE';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'model', label: 'Models' },
  { key: 'inference', label: 'Inference' },
  { key: 'payment', label: 'Payments' },
  { key: 'agent', label: 'Agents' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'robot', label: 'Robot' },
] as const;

const ICONS: Record<string, string> = {
  'model:loading': '⏳', 'model:loaded': '📦', 'model:unloaded': '🗑️',
  'inference:started': '🧠', 'inference:completed': '🧠', 'inference:delegated': '🛰️',
  'payment:required': '🔒', 'payment:settled': '💸',
  'agent:job_started': '▶️', 'agent:job_completed': '✅', 'agent:job_failed': '❌',
  'agent:a2a_hired': '🤝',
  'workflow:created': '🗺️', 'workflow:step_started': '·', 'workflow:step_completed': '→',
  'workflow:completed': '🏁', 'workflow:failed': '💥',
  'rag:search': '🔎', 'robot:action_chunk': '🤖', 'settlement:plasma': '⛓️',
};

function describe(ev: SwarmEvent): string {
  const d = ev.data;
  switch (ev.type) {
    case 'model:loaded':
      return `${d.modelKey} loaded (${d.source}) in ${d.loadMs}ms · ~${d.ramEstGB}GB [${d.process}]`;
    case 'model:unloaded':
      return `${d.modelKey} unloaded (${d.reason}) [${d.process}]`;
    case 'inference:completed':
      return `${d.agentId ?? d.modelKey}: ${d.completionTokens} tok · TTFT ${Math.round(d.ttftMs)}ms · ${Number(d.tokensPerSecond).toFixed(1)} tok/s${d.delegated ? ' · P2P' : ''}`;
    case 'payment:settled':
      return `${d.from} → ${d.to}: ${d.display ?? d.amount} (${d.receiptId})`;
    case 'payment:required':
      return d.display ?? `escrow hold ${d.amount}`;
    case 'agent:a2a_hired':
      return `${d.from} hired ${d.to} for ${(d.amount / 1e6).toFixed(2)} USDT (${d.receiptId})`;
    case 'workflow:created':
      return `${d.summary} — ${(d.agents ?? []).join(' → ')} [${d.parser}]`;
    case 'workflow:step_started':
      return `step ${d.stepIndex}: ${d.agentId} working…`;
    case 'workflow:step_completed':
      return `step ${d.stepIndex}: ${d.agentId} ${d.status}${d.receiptId ? ` · paid (${d.receiptId})` : ''}`;
    case 'workflow:completed':
      return `workflow settled · spent ${(d.spent / 1e6).toFixed(2)} USDT · ${(d.durationMs / 1000).toFixed(1)}s`;
    case 'robot:action_chunk':
      return `robot-pilot: ${d.instruction ?? ''} chunk ${d.chunkIndex ?? ''} (${d.inferMs}ms)`;
    case 'settlement:plasma':
      return `session settled on Plasma testnet: ${d.txHash}`;
    default:
      return JSON.stringify(d).slice(0, 100);
  }
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`text-xl font-bold ${accent ? 'text-[var(--accent)]' : ''}`}>{value}</div>
    </div>
  );
}

export default function LiveFeed({ live }: { live: LiveState }) {
  const [filter, setFilter] = useState<string>('all');
  const events = [...live.feed]
    .reverse()
    .filter((e) => filter === 'all' || e.type.startsWith(filter));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Inferences" value={live.stats.totalInferences} accent />
        <StatCard label="Tokens" value={live.stats.totalTokens.toLocaleString()} />
        <StatCard label="Payments" value={`${(live.stats.totalPaymentsMicro / 1e6).toFixed(2)} USDT`} accent />
        <StatCard label="Model load/unload" value={`${live.stats.modelLoads}/${live.stats.modelUnloads}`} />
      </div>

      <div className="panel flex flex-col h-[520px]">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)]">
          <span className={`w-2 h-2 rounded-full ${live.connected ? 'bg-[var(--accent)]' : 'bg-[var(--danger)]'}`} />
          <span className="text-xs text-[var(--muted)]">live feed</span>
          <div className="ml-auto flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-2 py-0.5 rounded ${filter === f.key ? 'bg-[var(--accent)] text-black' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-2 space-y-1 text-xs">
          {events.length === 0 && (
            <div className="text-[var(--muted)] pt-8 text-center">
              No events yet — send the swarm a request.
            </div>
          )}
          {events.map((ev) => (
            <div key={ev.id} className="flex gap-2 items-baseline">
              <span className="text-[var(--muted)] shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString()}
              </span>
              <span className="shrink-0">{ICONS[ev.type] ?? '·'}</span>
              <span className="text-[var(--accent2)] shrink-0">{ev.type}</span>
              <span className="truncate">{describe(ev)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
