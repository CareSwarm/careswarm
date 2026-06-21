'use client';

import Chat from './components/Chat';
import LiveFeed from './components/LiveFeed';
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

function ReplayHome() {
  const { live, result, play, playing } = useReplay();
  return (
    <Split
      chat={<Chat live={live} replayResult={result} onReplay={play} replaying={playing} />}
      caption="Replay of a real on-device run — the recorded swarm, step by step. The AI itself runs locally via QVAC (see the video)."
      live={live}
    />
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
