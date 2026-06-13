// SmolVLA (vision-language-action) through the ModelManager.
// The SDK wants pre-tokenized instructions (SmolVLM2 tokenizer, consumer
// side) and preprocessed frames; we handle both here so the robot-pilot
// agent just passes an instruction.

import { vla, vlaHparams } from '@qvac/sdk';
import { acquire, release } from './model-manager.ts';
import { logEvent, now, processName } from './metrics-logger.ts';

let tokenizerPromise: Promise<any> | null = null;

// SmolVLA's language tower is SmolLM2 — tokenizer files are fetched once
// from HF and cached (declared in APIS.json, setup-time only).
function getTokenizer() {
  tokenizerPromise ??= import('@huggingface/transformers').then(({ AutoTokenizer }) =>
    AutoTokenizer.from_pretrained('HuggingFaceTB/SmolLM2-135M-Instruct'),
  );
  return tokenizerPromise;
}

export interface VlaChunk {
  /** chunkSize x actionDim, row-major */
  actions: number[][];
  stats: {
    vision_ms?: number;
    smollm2_total_ms?: number;
    ode_ms?: number;
    total_ms?: number;
    backendDevice?: number;
  };
}

export interface VlaRunOptions {
  instruction: string;
  /** Two camera frames (front + wrist). Defaults to a synthetic test scene. */
  images?: Float32Array[];
  state?: Float32Array;
  chunks?: number;
  meta?: { agentId?: string; jobId?: string; workflowId?: string };
  onChunk?: (chunk: VlaChunk, index: number) => void;
}

/** Simple synthetic frame: table plane + a colored "box" patch. CHW, [-1,1]. */
function syntheticFrame(size: number, boxShift = 0): Float32Array {
  const img = new Float32Array(3 * size * size);
  const plane = Math.floor(size * 0.6);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const ground = y > plane;
      // background gray / table brown-ish
      img[i] = ground ? 0.2 : -0.4; // R
      img[size * size + i] = ground ? 0.0 : -0.4; // G
      img[2 * size * size + i] = ground ? -0.3 : -0.3; // B
    }
  }
  // the "medicine box"
  const bx = Math.floor(size * (0.5 + boxShift));
  const by = Math.floor(size * 0.65);
  const half = Math.floor(size * 0.06);
  for (let y = by - half; y < by + half; y++) {
    for (let x = bx - half; x < bx + half; x++) {
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const i = y * size + x;
      img[i] = 0.9; img[size * size + i] = -0.6; img[2 * size * size + i] = -0.6;
    }
  }
  return img;
}

export async function runVla(opts: VlaRunOptions): Promise<{
  hparams: { chunkSize: number; actionDim: number; visionImageSize: number };
  chunks: VlaChunk[];
}> {
  const { modelId } = await acquire('smolvla');
  try {
    const hp = ((await vlaHparams({ modelId } as never)) as any).hparams ??
      ((await vlaHparams({ modelId } as never)) as any);
    const size: number = hp.visionImageSize;

    const tokenizer = await getTokenizer();
    const enc = tokenizer(opts.instruction, {
      padding: 'max_length',
      truncation: true,
      max_length: hp.tokenizerMaxLength,
    });
    const tokens = new Int32Array(hp.tokenizerMaxLength);
    const mask = new Uint8Array(hp.tokenizerMaxLength);
    const ids = Array.from(enc.input_ids.data as bigint[] | number[], Number);
    const am = Array.from(enc.attention_mask.data as bigint[] | number[], Number);
    tokens.set(ids.slice(0, hp.tokenizerMaxLength));
    mask.set(am.slice(0, hp.tokenizerMaxLength));

    const images = opts.images ?? [syntheticFrame(size), syntheticFrame(size, 0.08)];
    const state = new Float32Array(hp.maxStateDim);
    if (opts.state) state.set(opts.state.slice(0, hp.maxStateDim));

    const chunks: VlaChunk[] = [];
    const n = opts.chunks ?? 3;
    for (let c = 0; c < n; c++) {
      const t0 = performance.now();
      const res = (await vla({
        modelId,
        images,
        imgWidth: size,
        imgHeight: size,
        state,
        tokens,
        mask,
      } as never)) as { actions: Float32Array; actionDim: number; chunkSize: number; stats?: VlaChunk['stats'] };

      const actions: number[][] = [];
      for (let s = 0; s < res.chunkSize; s++) {
        actions.push(Array.from(res.actions.slice(s * res.actionDim, (s + 1) * res.actionDim)));
      }
      const chunk: VlaChunk = { actions, stats: res.stats ?? { total_ms: performance.now() - t0 } };
      chunks.push(chunk);
      opts.onChunk?.(chunk, c);

      logEvent({
        ts: now(),
        event: 'inference',
        id: `vla-${Date.now()}-${c}`,
        modelKey: 'smolvla',
        agentId: opts.meta?.agentId,
        jobId: opts.meta?.jobId,
        workflowId: opts.meta?.workflowId,
        delegated: false,
        prompt: opts.instruction,
        promptTokens: ids.filter((x) => x !== 0).length,
        completionTokens: res.chunkSize * res.actionDim,
        ttftMs: chunk.stats.total_ms ?? 0,
        tokensPerSecond: 0,
        durationMs: Math.round(performance.now() - t0),
        stopReason: 'vla_chunk',
        toolCallNames: [],
        process: processName(),
      });
    }

    return {
      hparams: { chunkSize: hp.chunkSize, actionDim: hp.actionDim, visionImageSize: size },
      chunks,
    };
  } finally {
    release('smolvla');
  }
}
