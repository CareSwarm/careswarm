// Append-only JSONL audit log: model loads/unloads + per-inference perf
// (prompt, tokens, TTFT, tok/s). This file is a submission artifact.

import fs from 'node:fs';
import path from 'node:path';
import type { AuditEvent, EngineEventListener } from './types.ts';

const LOG_DIR =
  process.env.CARESWARM_LOG_DIR ?? path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'qvac-audit.jsonl');

const PROCESS_NAME = process.env.CARESWARM_PROCESS ?? 'unknown';

const listeners: EngineEventListener[] = [];

export function onEngineEvent(listener: EngineEventListener): void {
  listeners.push(listener);
}

export function processName(): string {
  return PROCESS_NAME;
}

export function logEvent(event: AuditEvent): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(event) + '\n');
  } catch (err) {
    // Logging must never take the demo down; surface loudly instead.
    console.error('[metrics-logger] failed to append:', err);
  }
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      /* listener errors are not our problem */
    }
  }
}

export function now(): string {
  return new Date().toISOString();
}

/** Tail the audit log (used by GET /api/metrics) */
export function readAuditLog(limit = 500): AuditEvent[] {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = raw.trim().split('\n');
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEvent => e !== null);
  } catch {
    return [];
  }
}

/** Aggregate stats for the dashboard metrics page */
export function aggregateMetrics(): {
  totalInferences: number;
  totalTokens: number;
  avgTtftMs: number;
  avgTokensPerSecond: number;
  byModel: Record<
    string,
    { inferences: number; avgTtftMs: number; avgTokensPerSecond: number }
  >;
  modelLoads: number;
  modelUnloads: number;
} {
  const events = readAuditLog(10_000);
  const inferences = events.filter((e) => e.event === 'inference');
  const byModel: Record<string, { n: number; ttft: number; tps: number }> = {};
  let totalTokens = 0;
  for (const inf of inferences) {
    totalTokens += inf.promptTokens + inf.completionTokens;
    const m = (byModel[inf.modelKey] ??= { n: 0, ttft: 0, tps: 0 });
    m.n += 1;
    m.ttft += inf.ttftMs;
    m.tps += inf.tokensPerSecond;
  }
  const n = inferences.length || 1;
  return {
    totalInferences: inferences.length,
    totalTokens,
    avgTtftMs:
      inferences.reduce((s, i) => s + i.ttftMs, 0) / n,
    avgTokensPerSecond:
      inferences.reduce((s, i) => s + i.tokensPerSecond, 0) / n,
    byModel: Object.fromEntries(
      Object.entries(byModel).map(([k, v]) => [
        k,
        {
          inferences: v.n,
          avgTtftMs: v.ttft / v.n,
          avgTokensPerSecond: v.tps / v.n,
        },
      ]),
    ),
    modelLoads: events.filter((e) => e.event === 'model_load').length,
    modelUnloads: events.filter((e) => e.event === 'model_unload').length,
  };
}
