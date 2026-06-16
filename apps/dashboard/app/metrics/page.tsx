'use client';

// TTFT / tok/s charts from the JSONL audit log.

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, CartesianGrid,
} from 'recharts';
import { REPLAY } from '../lib/replay';

interface InferenceRow {
  ts: string;
  event: string;
  modelKey: string;
  agentId?: string;
  ttftMs: number;
  tokensPerSecond: number;
  promptTokens: number;
  completionTokens: number;
  delegated: boolean;
  process: string;
}

export default function MetricsPage() {
  const [data, setData] = useState<{ aggregate: any; recent: any[] } | null>(null);

  useEffect(() => {
    const url = REPLAY ? '/replay/metrics.json' : '/api/metrics';
    const load = () => fetch(url).then((r) => r.json()).then(setData).catch(() => {});
    load();
    if (REPLAY) return; // static in replay
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="text-[var(--muted)] text-sm">loading audit log…</div>;

  const inferences = (data.recent.filter((e) => e.event === 'inference') as InferenceRow[]).map(
    (e, i) => ({
      idx: i + 1,
      label: `${e.agentId ?? e.modelKey}`,
      ttftMs: Math.round(e.ttftMs),
      tps: Number(e.tokensPerSecond.toFixed(1)),
      tokens: e.promptTokens + e.completionTokens,
      model: e.modelKey,
    }),
  );

  const byModel = Object.entries(data.aggregate.byModel ?? {}).map(([model, v]: [string, any]) => ({
    model,
    avgTtft: Math.round(v.avgTtftMs),
    avgTps: Number(v.avgTokensPerSecond.toFixed(1)),
    n: v.inferences,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-sm text-[var(--muted)]">
        Auditable performance log (logs/qvac-audit.jsonl) — every model load and inference on this machine.
      </h1>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['Inferences', data.aggregate.totalInferences],
          ['Total tokens', data.aggregate.totalTokens?.toLocaleString()],
          ['Avg TTFT', `${Math.round(data.aggregate.avgTtftMs)}ms`],
          ['Avg speed', `${data.aggregate.avgTokensPerSecond?.toFixed(1)} tok/s`],
          ['Loads/unloads', `${data.aggregate.modelLoads}/${data.aggregate.modelUnloads}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="panel px-4 py-3">
            <div className="text-xs text-[var(--muted)]">{label}</div>
            <div className="text-xl font-bold text-[var(--accent)]">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="panel p-4 h-72">
          <div className="text-xs text-[var(--muted)] mb-2">TTFT per inference (ms)</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={inferences}>
              <CartesianGrid stroke="#1e2733" />
              <XAxis dataKey="idx" stroke="#6b7c93" fontSize={10} />
              <YAxis stroke="#6b7c93" fontSize={10} />
              <Tooltip
                contentStyle={{ background: '#11161f', border: '1px solid #1e2733' }}
                labelFormatter={(i) => inferences[Number(i) - 1]?.label ?? ''}
              />
              <Line type="monotone" dataKey="ttftMs" stroke="#60a5fa" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-4 h-72">
          <div className="text-xs text-[var(--muted)] mb-2">Tokens/sec per inference</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={inferences}>
              <CartesianGrid stroke="#1e2733" />
              <XAxis dataKey="idx" stroke="#6b7c93" fontSize={10} />
              <YAxis stroke="#6b7c93" fontSize={10} />
              <Tooltip
                contentStyle={{ background: '#11161f', border: '1px solid #1e2733' }}
                labelFormatter={(i) => inferences[Number(i) - 1]?.label ?? ''}
              />
              <Line type="monotone" dataKey="tps" stroke="#34d399" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel p-4 h-72">
        <div className="text-xs text-[var(--muted)] mb-2">Per-model averages</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={byModel}>
            <CartesianGrid stroke="#1e2733" />
            <XAxis dataKey="model" stroke="#6b7c93" fontSize={10} />
            <YAxis stroke="#6b7c93" fontSize={10} />
            <Tooltip contentStyle={{ background: '#11161f', border: '1px solid #1e2733' }} />
            <Legend />
            <Bar dataKey="avgTtft" name="avg TTFT (ms)" fill="#60a5fa" />
            <Bar dataKey="avgTps" name="avg tok/s" fill="#34d399" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel p-4 overflow-x-auto">
        <div className="text-xs text-[var(--muted)] mb-2">Recent inferences (raw log tail)</div>
        <table className="text-xs w-full">
          <thead className="text-[var(--muted)] text-left">
            <tr>
              <th className="pr-4">time</th><th className="pr-4">agent</th><th className="pr-4">model</th>
              <th className="pr-4">TTFT</th><th className="pr-4">tok/s</th><th className="pr-4">tokens</th>
              <th className="pr-4">P2P</th><th>process</th>
            </tr>
          </thead>
          <tbody>
            {inferences.slice(-25).reverse().map((r, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                <td className="pr-4 text-[var(--muted)]">{r.idx}</td>
                <td className="pr-4">{r.label}</td>
                <td className="pr-4 text-[var(--accent2)]">{r.model}</td>
                <td className="pr-4">{r.ttftMs}ms</td>
                <td className="pr-4 text-[var(--accent)]">{r.tps}</td>
                <td className="pr-4">{r.tokens}</td>
                <td className="pr-4">{(data.recent.find((e) => e.event === 'inference') as any)?.delegated ? '🛰️' : '—'}</td>
                <td className="text-[var(--muted)]">local</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
