// Model lifecycle on a hard RAM budget. We run on an 8GB MacBook Air, so we
// can't keep every model resident: acquire()/release() refcount usage,
// loading evicts idle models LRU-first, and a sweeper unloads anything
// idle > 60s. Every load/unload goes to the audit log.

import { loadModel, unloadModel } from '@qvac/sdk';
import * as sdk from '@qvac/sdk';
import { MODELS, spec } from './registry.ts';
import { logEvent, now, processName } from './metrics-logger.ts';
import type { ModelKey } from './types.ts';

export interface DelegateOptions {
  providerPublicKey: string;
  timeout?: number;
  fallbackToLocal?: boolean;
}

interface Entry {
  modelId: string;
  ramGB: number;
  lastUsedAt: number;
  refCount: number;
  delegated: boolean;
}

const BUDGET_GB = Number(process.env.QVAC_RAM_BUDGET_GB ?? 3.6);
const IDLE_TTL_MS = Number(process.env.QVAC_IDLE_TTL_MS ?? 60_000);
const SWEEP_INTERVAL_MS = 20_000;

const entries = new Map<ModelKey, Entry>();
const loading = new Map<ModelKey, Promise<Entry>>();

let sweeper: ReturnType<typeof setInterval> | null = null;

function usedGB(): number {
  let total = 0;
  for (const e of entries.values()) total += e.ramGB;
  return total;
}

/** Resolve the QVAC modelSrc for a key (built-in constant or local GGUF path). */
function resolveSrc(key: ModelKey): string | object {
  const s = spec(key);
  if (s.builtin) {
    const constant = (sdk as Record<string, unknown>)[s.builtin];
    if (!constant) throw new Error(`Built-in model constant missing: ${s.builtin}`);
    return constant as object;
  }
  return s.src;
}

async function evict(key: ModelKey, reason: 'lru_evict' | 'idle_ttl' | 'shutdown'): Promise<void> {
  const e = entries.get(key);
  if (!e) return;
  entries.delete(key);
  try {
    await unloadModel({ modelId: e.modelId });
  } catch (err) {
    console.warn(`[model-manager] unload ${key} failed:`, err);
  }
  logEvent({ ts: now(), event: 'model_unload', modelKey: key, reason, process: processName() });
}

async function ensureBudget(needGB: number): Promise<void> {
  if (needGB > BUDGET_GB) {
    throw new Error(
      `Model needs ${needGB}GB but budget is ${BUDGET_GB}GB (QVAC_RAM_BUDGET_GB)`,
    );
  }
  while (usedGB() + needGB > BUDGET_GB) {
    // Evict the least-recently-used idle model
    const idle = [...entries.entries()]
      .filter(([, e]) => e.refCount === 0)
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    if (!idle.length) {
      throw new Error(
        `RAM budget exceeded (${usedGB().toFixed(1)} + ${needGB} > ${BUDGET_GB}GB) and no idle model to evict`,
      );
    }
    await evict(idle[0][0], 'lru_evict');
  }
}

async function doLoad(key: ModelKey, delegate?: DelegateOptions): Promise<Entry> {
  const s = spec(key);
  await ensureBudget(delegate ? 0.1 : s.ramGB); // delegated models cost a stub locally

  const t0 = performance.now();
  const modelConfig: Record<string, unknown> = {};
  if (s.modelType === 'llm') {
    modelConfig.ctx_size = s.ctxSize ?? 4096;
    if (s.sampling?.temperature !== undefined) modelConfig.temp = s.sampling.temperature;
    if (s.sampling?.top_k !== undefined) modelConfig.top_k = s.sampling.top_k;
    if (s.sampling?.top_p !== undefined) modelConfig.top_p = s.sampling.top_p;
    modelConfig.tools = true; // enable tool-calling support at load time
  }

  const modelId = (await loadModel({
    modelSrc: resolveSrc(key) as never,
    modelType: s.modelType as never,
    ...(s.modelType === 'llm' || s.modelType === 'embeddings' ? { modelConfig } : {}),
    ...(delegate
      ? {
          delegate: {
            providerPublicKey: delegate.providerPublicKey,
            timeout: delegate.timeout ?? 60_000,
            fallbackToLocal: delegate.fallbackToLocal ?? true,
          },
        }
      : {}),
  } as never)) as string;

  const loadMs = Math.round(performance.now() - t0);
  const entry: Entry = {
    modelId,
    ramGB: delegate ? 0.1 : s.ramGB,
    lastUsedAt: Date.now(),
    refCount: 0,
    delegated: Boolean(delegate),
  };
  entries.set(key, entry);

  logEvent({
    ts: now(),
    event: 'model_load',
    modelKey: key,
    modelId,
    source: delegate ? `delegated:${delegate.providerPublicKey.slice(0, 8)}` : 'local',
    ramEstGB: entry.ramGB,
    loadMs,
    process: processName(),
  });

  if (!sweeper) {
    sweeper = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
    sweeper.unref?.();
  }
  return entry;
}

async function sweep(): Promise<void> {
  const cutoff = Date.now() - IDLE_TTL_MS;
  for (const [key, e] of entries) {
    if (e.refCount === 0 && e.lastUsedAt < cutoff) {
      await evict(key, 'idle_ttl');
    }
  }
}

/**
 * Acquire a model for use. Loads (evicting idle models if needed) on first
 * use; subsequent acquires share the loaded instance. Pair with release().
 */
export async function acquire(
  key: ModelKey,
  opts?: { delegate?: DelegateOptions },
): Promise<{ modelId: string; delegated: boolean }> {
  let e = entries.get(key);
  // Local/delegated mismatch (e.g. a P2P session just started while the
  // model sits loaded locally): reload in the requested mode when idle.
  if (e && e.delegated !== Boolean(opts?.delegate) && e.refCount === 0) {
    await evict(key, 'manual');
    e = undefined;
  }
  if (!e) {
    let p = loading.get(key);
    if (!p) {
      p = doLoad(key, opts?.delegate).finally(() => loading.delete(key));
      loading.set(key, p);
    }
    e = await p;
  }
  e.refCount += 1;
  e.lastUsedAt = Date.now();
  return { modelId: e.modelId, delegated: e.delegated };
}

export function release(key: ModelKey): void {
  const e = entries.get(key);
  if (!e) return;
  e.refCount = Math.max(0, e.refCount - 1);
  e.lastUsedAt = Date.now();
}

/** Current manager state (GET /api/models for the dashboard). */
export function managerState() {
  return {
    budgetGB: BUDGET_GB,
    usedGB: Number(usedGB().toFixed(2)),
    process: processName(),
    models: [...entries.entries()].map(([key, e]) => ({
      key,
      modelId: e.modelId,
      ramGB: e.ramGB,
      refCount: e.refCount,
      delegated: e.delegated,
      idleMs: Date.now() - e.lastUsedAt,
    })),
  };
}

/** Unload one model now if it's idle. Lets the orchestrator free its planner
 *  model the moment planning is done, so the agents process has RAM for 4B. */
export async function forceUnload(key: ModelKey): Promise<void> {
  const e = entries.get(key);
  if (e && e.refCount === 0) await evict(key, 'manual');
}

/** Unload everything (graceful shutdown). */
export async function shutdownModels(): Promise<void> {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
  for (const key of [...entries.keys()]) {
    await evict(key, 'shutdown');
  }
}

export { MODELS };
