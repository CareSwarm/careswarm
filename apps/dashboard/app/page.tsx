'use client';

import Chat from './components/Chat';
import LiveFeed from './components/LiveFeed';
import { useSSE } from './hooks/useSSE';

export default function Home() {
  const live = useSSE();
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div>
        <h1 className="text-sm text-[var(--muted)] mb-3">
          Talk to the swarm — every agent runs on THIS machine via QVAC; every job is a USDT micropayment.
        </h1>
        <Chat live={live} />
      </div>
      <div>
        <h2 className="text-sm text-[var(--muted)] mb-3">Live swarm activity</h2>
        <LiveFeed live={live} />
      </div>
    </div>
  );
}
