'use client';

// Agent marketplace + live ModelManager state.

import { useEffect, useState } from 'react';

interface Manifest {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  capabilities: string[];
  modelKey?: string;
}

const AGENT_EMOJI: Record<string, string> = {
  triage: '🩺', librarian: '📚', clinician: '🧠', scribe: '✍️',
  translator: '🌐', 'robot-pilot': '🤖', voice: '🎙️',
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Manifest[]>([]);
  const [models, setModels] = useState<any>(null);

  useEffect(() => {
    fetch('/api/agents').then((r) => r.json()).then(setAgents).catch(() => {});
    const t = setInterval(() => {
      fetch('/api/models').then((r) => r.json()).then(setModels).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-sm text-[var(--muted)]">
        The swarm — each agent is priced per job (HTTP 402) and powered by an on-device QVAC model.
      </h1>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((a) => (
          <div key={a.id} className="panel p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{AGENT_EMOJI[a.id] ?? '🐝'}</span>
              <span className="font-bold">{a.name}</span>
              <span className="ml-auto text-[var(--accent)] font-bold">
                {(a.price / 1e6).toFixed(2)} USDT
              </span>
            </div>
            <p className="text-xs text-[var(--muted)]">{a.description}</p>
            <div className="flex flex-wrap gap-1 mt-auto">
              {a.modelKey && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent2)]/20 text-[var(--accent2)]">
                  {a.modelKey}
                </span>
              )}
              {a.capabilities.map((c) => (
                <span key={c} className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)]">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {models && (
        <div className="panel p-4">
          <div className="text-xs text-[var(--muted)] mb-2">
            QVAC ModelManager (orchestrator process) — budget {models.budgetGB}GB, in use {models.usedGB}GB
          </div>
          <div className="flex flex-wrap gap-2">
            {models.models?.length === 0 && (
              <span className="text-xs text-[var(--muted)]">no models resident (idle-TTL unloaded)</span>
            )}
            {models.models?.map((m: any) => (
              <span key={m.key} className="text-xs px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)]">
                {m.key} · {m.ramGB}GB · idle {(m.idleMs / 1000).toFixed(0)}s{m.delegated ? ' · P2P' : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
