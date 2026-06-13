// QVAC embed() through the ModelManager.

import { embed } from '@qvac/sdk';
import { acquire, release } from './model-manager.ts';

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { modelId } = await acquire('embeddings');
  try {
    const res = (await embed({ modelId, text: texts })) as {
      embedding?: number[][] | number[];
    };
    const vecs = res.embedding ?? (res as unknown as number[][]);
    // Single-text calls may return a flat vector
    if (texts.length === 1 && typeof (vecs as number[])[0] === 'number') {
      return [vecs as number[]];
    }
    return vecs as number[][];
  } finally {
    release('embeddings');
  }
}
