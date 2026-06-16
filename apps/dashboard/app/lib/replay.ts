// Replay mode: when NEXT_PUBLIC_REPLAY=1 (set on Vercel) the dashboard has no
// backend, so it plays back a recorded on-device run from /public/replay/*.json
// instead of talking to the orchestrator. The AI itself never runs in the
// cloud — this is just a viewer for a real local run.

import type { SwarmEvent } from '../hooks/useSSE';

export const REPLAY = process.env.NEXT_PUBLIC_REPLAY === '1';

/** Fetch a bundled replay file (static asset). */
export async function loadReplay<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(`/replay/${name}.json`, { cache: 'force-cache' });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Emit recorded swarm events over time, paced by their original gaps but
 * clamped so the whole run plays in a watchable ~25s. Returns a cancel fn.
 */
export function playEvents(
  events: SwarmEvent[],
  onEvent: (e: SwarmEvent) => void,
  onDone?: () => void,
): () => void {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const t0 = sorted[0]?.timestamp ?? 0;

  // scale real elapsed (often minutes) into ~25s, clamp per-event gap
  const span = (sorted.at(-1)?.timestamp ?? t0) - t0 || 1;
  const scale = Math.min(1, 25_000 / span);

  sorted.forEach((e, i) => {
    const delay = Math.min(2000, Math.max(120, (e.timestamp - t0) * scale + i * 40));
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        onEvent(e);
        if (i === sorted.length - 1) onDone?.();
      }, delay),
    );
  });

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}
