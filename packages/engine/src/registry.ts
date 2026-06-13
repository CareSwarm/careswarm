// All models we use + their RAM cost (what the ModelManager budgets against).

import path from 'node:path';
import type { ModelKey, ModelSpec } from './types.ts';

// QVAC requires an absolute path for local GGUF files, so resolve here.
const MODELS_DIR = path.resolve(process.env.QVAC_MODELS_DIR ?? './models');

function local(file: string): string {
  return path.join(MODELS_DIR, file);
}

/**
 * Built-in QVAC constants are resolved lazily in model-manager.ts (import from
 * @qvac/sdk), keyed here by name so the registry stays dependency-free.
 */
export const MODELS: Record<ModelKey, ModelSpec & { builtin?: string }> = {
  orchestrator: {
    src: '',
    builtin: 'QWEN3_1_7B_INST_Q4',
    modelType: 'llm',
    ramGB: 1.5,
    ctxSize: 4096,
    sampling: { temperature: 0.2 },
  },
  medpsy_1_7b: {
    src: local(process.env.MEDPSY_1_7B_FILE ?? 'medpsy-1.7b-q4_k_m-imat.gguf'),
    modelType: 'llm',
    ramGB: 1.5,
    ctxSize: 4096,
    sampling: { temperature: 0.6, top_k: 20, top_p: 0.95 },
  },
  medpsy_4b: {
    src: local(process.env.MEDPSY_4B_FILE ?? 'medpsy-4b-q4_k_m-imat.gguf'),
    modelType: 'llm',
    ramGB: 3.4,
    ctxSize: 4096,
    sampling: { temperature: 0.6, top_k: 20, top_p: 0.95 },
    thinking: true,
  },
  embeddings: {
    src: '',
    builtin: 'EMBEDDINGGEMMA_300M_Q8_0', // 768-dim, ~0.35GB — fits the 8GB budget
    modelType: 'embeddings',
    ramGB: 0.5,
  },
  smolvla: {
    src: '',
    builtin: 'SMOLVLA_LIBERO_VISION_Q8',
    modelType: 'vla',
    ramGB: 2.2,
  },
};

export function spec(key: ModelKey): ModelSpec & { builtin?: string } {
  const s = MODELS[key];
  if (!s) throw new Error(`Unknown model key: ${key}`);
  return s;
}
