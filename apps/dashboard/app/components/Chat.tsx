'use client';

// Talk to the swarm: POST /api/orchestrate, render workflow steps live from
// SSE while the request runs (status, payment receipts, thinking accordion).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LiveState } from '../hooks/useSSE';

interface StepView {
  stepIndex: number;
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  receiptId?: string;
  executionTimeMs?: number;
}

interface WorkflowView {
  workflowId: string;
  summary?: string;
  agents?: string[];
  parser?: string;
  steps: Record<number, StepView>;
  done?: boolean;
  spent?: number;
}

const AGENT_EMOJI: Record<string, string> = {
  triage: '🩺', librarian: '📚', clinician: '🧠', scribe: '✍️',
  translator: '🌐', 'robot-pilot': '🤖', voice: '🎙️',
};

const EXAMPLES = [
  'My father is 62 and gets chest tightness when he climbs stairs; it eases with rest. What should we do?',
  'My 8-month-old has a 38.6°C fever since this morning. What should I watch for?',
  'I have had a mild headache for two days after long screen hours.',
  'Mi padre tiene dolor en el pecho al subir escaleras. ¿Qué hacemos?',
  'Robot, fetch the medicine box from the table.',
];

// Predicted trajectory from SmolVLA action chunks: cumulative xy of the
// end-effector deltas + gripper state. Policy demo, not real actuation.
function RobotTrajectory({ robot }: { robot: any }) {
  const W = 360, H = 180;
  const paths = (robot.chunks ?? []).map((chunk: any) => {
    let x = 0, y = 0;
    return chunk.actions.map((a: number[]) => {
      x += a[0] ?? 0;
      y += a[1] ?? 0;
      return { x, y, grip: a[6] ?? 0 };
    });
  });
  const all = paths.flat();
  if (!all.length) return null;
  const xs = all.map((p: any) => p.x), ys = all.map((p: any) => p.y);
  const sx = (v: number) => 20 + ((v - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1)) * (W - 40);
  const sy = (v: number) => 20 + ((v - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys) || 1)) * (H - 40);
  const colors = ['#34d399', '#60a5fa', '#fbbf24'];
  return (
    <div className="panel p-3 text-xs">
      <div className="text-[var(--accent2)] mb-1">🤖 robot-pilot — SmolVLA predicted trajectory ({robot.mode})</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-[var(--bg)] rounded">
        {paths.map((path: any[], ci: number) => (
          <polyline
            key={ci}
            fill="none"
            stroke={colors[ci % colors.length]}
            strokeWidth="1.5"
            points={path.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          />
        ))}
        {paths.map((path: any[], ci: number) =>
          path.filter((_, i) => i % 10 === 0).map((p, i) => (
            <circle key={`${ci}-${i}`} cx={sx(p.x)} cy={sy(p.y)} r={p.grip > 0 ? 3 : 1.5}
              fill={p.grip > 0 ? '#f87171' : colors[ci % colors.length]} />
          )),
        )}
      </svg>
      <div className="flex gap-3 mt-1 text-[var(--muted)]">
        {(robot.chunks ?? []).map((c: any, i: number) => (
          <span key={i}>chunk {i}: {Math.round(c.stats?.total_ms ?? 0)}ms
            {c.stats?.vision_ms ? ` (vision ${Math.round(c.stats.vision_ms)}ms)` : ''}</span>
        ))}
      </div>
    </div>
  );
}

export default function Chat({
  live,
  replayResult,
  onReplay,
  replaying,
  recordedPrompt,
}: {
  live: LiveState;
  replayResult?: any;
  onReplay?: () => void;
  replaying?: boolean;
  recordedPrompt?: string;
}) {
  const isReplay = typeof onReplay === 'function';
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [localResult, setLocalResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // In replay mode the result comes from the recording, not a POST.
  const result = isReplay ? replayResult : localResult;
  const effectiveBusy = isReplay ? Boolean(replaying) : busy;

  // Replay mode plays one recorded run, so lock the box to its prompt as soon
  // as it loads (before the run even plays) — no stray example can mismatch it.
  useEffect(() => {
    if (isReplay && recordedPrompt) setPrompt(recordedPrompt);
  }, [isReplay, recordedPrompt]);

  // Build the live view of the most recent workflow from SSE events
  const workflow = useMemo<WorkflowView | null>(() => {
    let wf: WorkflowView | null = null;
    for (const ev of live.feed) {
      const d = ev.data;
      if (ev.type === 'workflow:created') {
        wf = { workflowId: d.workflowId, summary: d.summary, agents: d.agents, parser: d.parser, steps: {} };
      } else if (wf && d.workflowId === wf.workflowId) {
        if (ev.type === 'workflow:step_started') {
          wf.steps[d.stepIndex] = { stepIndex: d.stepIndex, agentId: d.agentId, status: 'running' };
        } else if (ev.type === 'workflow:step_completed') {
          wf.steps[d.stepIndex] = {
            stepIndex: d.stepIndex, agentId: d.agentId, status: d.status,
            receiptId: d.receiptId, executionTimeMs: d.executionTimeMs,
          };
        } else if (ev.type === 'workflow:completed') {
          wf.done = true;
          wf.spent = d.spent;
        }
      }
    }
    return wf;
  }, [live.feed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [workflow, result]);

  async function send() {
    // Replay mode: re-run the recording instead of hitting a backend.
    if (isReplay) {
      onReplay!();
      return;
    }
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setLocalResult(null);
    setError(null);
    setEmergency(null);
    try {
      const res = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLocalResult(data);
      if (data.plan?.emergencyBanner) setEmergency(data.plan.emergencyBanner);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const finalOutput = result?.finalOutput;
  const finalText =
    finalOutput?.translation ?? finalOutput?.note ?? finalOutput?.assessment ??
    (finalOutput ? JSON.stringify(finalOutput, null, 2) : null);
  const clinicianStep = result?.workflow?.steps?.find((s: any) => s.agentId === 'clinician');
  const thinking = clinicianStep?.result?.result?.thinking;
  const searches = clinicianStep?.result?.result?.guidelineSearches;
  const robot = result?.workflow?.steps?.find((s: any) => s.agentId === 'robot-pilot')?.result?.result;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel p-4">
        <textarea
          className="w-full bg-transparent outline-none resize-none text-sm placeholder-[var(--muted)] read-only:cursor-default"
          rows={3}
          placeholder="Describe symptoms or give the swarm a task… (any language)"
          value={prompt}
          readOnly={isReplay}
          title={isReplay ? 'Replay mode plays one recorded run. Run it locally to ask your own question.' : undefined}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
        />
        <div className="flex items-center gap-2 mt-2">
          {isReplay ? (
            <span className="text-[10px] text-[var(--muted)]">
              Recorded question — press replay to watch the swarm answer it.
            </span>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {EXAMPLES.map((ex, i) => (
                <button key={i} onClick={() => setPrompt(ex)}
                  className="text-[10px] px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]">
                  {ex.slice(0, 38)}…
                </button>
              ))}
            </div>
          )}
          <button
            onClick={send}
            disabled={effectiveBusy || (!isReplay && !prompt.trim())}
            className="ml-auto px-4 py-1.5 rounded bg-[var(--accent)] text-black text-sm font-bold disabled:opacity-40"
          >
            {isReplay
              ? (effectiveBusy ? 'replaying…' : '▶ Replay recorded run')
              : (effectiveBusy ? 'swarm working…' : 'Send ⌘↵')}
          </button>
        </div>
      </div>

      {emergency && (
        <div className="panel border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          🚨 {emergency}
        </div>
      )}

      <div ref={scrollRef} className="flex flex-col gap-2">
        {workflow && (effectiveBusy || result) && (
          <>
            <div className="text-xs text-[var(--muted)]">
              plan via <span className="text-[var(--accent2)]">{workflow.parser}</span> · {workflow.summary}
            </div>
            {(workflow.agents ?? []).map((agentId, i) => {
              const step = workflow.steps[i];
              const status = step?.status ?? 'pending';
              return (
                <div key={i} className="panel px-3 py-2 flex items-center gap-3 text-sm">
                  <span className="text-lg">{AGENT_EMOJI[agentId] ?? '🐝'}</span>
                  <span className="font-bold w-24">{agentId}</span>
                  <span className={
                    status === 'completed' ? 'text-[var(--accent)]' :
                    status === 'running' ? 'text-[var(--warn)] animate-pulse' :
                    status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--muted)]'
                  }>
                    {status === 'running' ? '● working' : status}
                  </span>
                  {step?.executionTimeMs != null && (
                    <span className="text-xs text-[var(--muted)]">{(step.executionTimeMs / 1000).toFixed(1)}s</span>
                  )}
                  {step?.receiptId && (
                    <span className="ml-auto text-xs text-[var(--accent)]">💸 {step.receiptId}</span>
                  )}
                </div>
              );
            })}
          </>
        )}

        {searches?.length > 0 && (
          <div className="panel px-3 py-2 text-xs">
            🤝 clinician hired librarian mid-inference:
            {searches.map((s: any, i: number) => (
              <div key={i} className="text-[var(--muted)] ml-4">→ search_guidelines("{s.query}") · paid {s.receipt}</div>
            ))}
          </div>
        )}

        {thinking && (
          <details open className="panel px-3 py-2 text-xs">
            <summary className="cursor-pointer text-[var(--accent2)]">🧠 clinician reasoning — MedPsy-4B thinking trace ({thinking.length} chars)</summary>
            <pre className="whitespace-pre-wrap text-[var(--muted)] mt-2 max-h-56 overflow-y-auto scrollbar-thin">{thinking}</pre>
          </details>
        )}

        {robot?.chunks && <RobotTrajectory robot={robot} />}

        {finalText && (
          <div className="panel p-4 text-sm whitespace-pre-wrap border-[var(--accent)]">
            {finalText}
          </div>
        )}

        {error && (
          <div className="panel p-3 text-sm text-[var(--danger)]">❌ {error}</div>
        )}
      </div>
    </div>
  );
}
