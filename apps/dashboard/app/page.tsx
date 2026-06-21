'use client';

import Chat from './components/Chat';
import LiveFeed from './components/LiveFeed';
import ExtraPanels from './components/ExtraPanels';
import { useSSE } from './hooks/useSSE';
import { useReplay } from './hooks/useReplay';
import { REPLAY } from './lib/replay';

export default function Home() {
  return REPLAY ? <ReplayHome /> : <LiveHome />;
}

function LiveHome() {
  const live = useSSE();
  return (
    <Split
      chat={<Chat live={live} />}
      caption="Talk to the swarm — every agent runs on THIS machine via QVAC; every job is a USDT micropayment."
      live={live}
    />
  );
}

const PROOF = [
  { href: 'https://www.youtube.com/watch?v=w6OD7jEVB4E', label: '▶ Demo video' },
  { href: 'https://github.com/CareSwarm/careswarm', label: '💻 Source' },
  { href: '/economy', label: '⛓ Verify on-chain' },
  { href: 'https://github.com/CareSwarm/careswarm/blob/main/logs/sample-run.jsonl', label: '📄 Audit log' },
];

// Capabilities + proof links — gives a judge instant credibility and a path to
// verify everything (real video, open source, on-chain, audit log).
function ProofBar() {
  return (
    <div className="panel px-4 py-3 mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-medium text-[var(--text)]">
          A swarm of medical AI agents on one 8GB laptop — no cloud.
        </span>
        <span className="text-xs text-[var(--muted)] font-mono">
          <span className="text-[var(--accent)]">5</span> models
          · <span className="text-[var(--accent)]">8GB</span> RAM
          · <span className="text-[var(--accent)]">0</span> cloud calls
          · <span className="text-[var(--accent)]">$0</span> API cost
          · <span className="text-[var(--accent)]">⛓ 1</span> on-chain anchor
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-[var(--muted)]">
          QVAC on-device · multi-agent + tool calling · paid agent-to-agent · MedPsy 1.7B + 4B · settled on Tether’s Plasma
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {PROOF.map((p) => (
            <a
              key={p.href}
              href={p.href}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors whitespace-nowrap"
            >
              {p.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReplayHome() {
  const { live, result, play, playing, prompt } = useReplay();
  return (
    <>
      <ProofBar />
      <Split
        chat={<Chat live={live} replayResult={result} onReplay={play} replaying={playing} recordedPrompt={prompt} />}
        caption="Replay of a real on-device run — the recorded swarm, step by step. The AI itself runs locally via QVAC (see the video)."
        live={live}
      />
      <ExtraPanels />
    </>
  );
}

function Split({ chat, caption, live }: { chat: React.ReactNode; caption: string; live: any }) {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        <h1 className="text-sm text-[var(--muted)] mb-3 min-h-[2.75rem] leading-snug">{caption}</h1>
        {chat}
      </div>
      <div>
        <h2 className="text-sm text-[var(--muted)] mb-3 min-h-[2.75rem] leading-snug">Live swarm activity</h2>
        <LiveFeed live={live} />
      </div>
    </div>
  );
}
