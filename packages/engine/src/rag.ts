// Thin wrappers over QVAC's RAG workspace (ragIngest embeds + stores,
// ragSearch queries). Used by the librarian agent.

import { ragIngest, ragSearch, ragListWorkspaces } from '@qvac/sdk';
import { acquire, release } from './model-manager.ts';
import { logEvent, now, processName } from './metrics-logger.ts';

export const CORPUS_WORKSPACE = 'careswarm-medical-corpus';

export interface RagHit {
  content: string;
  score?: number;
  source?: string;
  id?: string;
}

/** Ingest documents (chunked) into a workspace. Used by scripts/ingest-corpus. */
export async function ingestDocuments(
  documents: string[],
  workspace = CORPUS_WORKSPACE,
): Promise<unknown> {
  const { modelId } = await acquire('embeddings');
  try {
    return await ragIngest({
      workspace,
      modelId,
      documents,
      chunk: true,
      chunkOpts: { chunkSize: 512, chunkOverlap: 64, chunkStrategy: 'paragraph' },
    } as never);
  } finally {
    release('embeddings');
  }
}

/** Search the medical corpus; returns hits with source metadata when present. */
export async function searchCorpus(
  query: string,
  topK = 5,
  workspace = CORPUS_WORKSPACE,
): Promise<RagHit[]> {
  const { modelId } = await acquire('embeddings');
  const t0 = performance.now();
  try {
    const res = (await ragSearch({ workspace, modelId, query, topK } as never)) as unknown;
    const arr: unknown[] = Array.isArray(res)
      ? res
      : ((res as { results?: unknown[] }).results ?? []);
    const hits: RagHit[] = arr.map((h) => {
      const hit = h as Record<string, unknown>;
      return {
        content: String(hit.content ?? hit.text ?? hit.document ?? ''),
        score: typeof hit.score === 'number' ? hit.score : undefined,
        source:
          ((hit.metadata as Record<string, unknown>)?.source as string) ??
          (hit.source as string) ??
          undefined,
        id: hit.id as string | undefined,
      };
    });
    return hits;
  } finally {
    release('embeddings');
    console.log(
      `[rag] search "${query.slice(0, 60)}" took ${Math.round(performance.now() - t0)}ms`,
    );
  }
}

export async function listWorkspaces(): Promise<unknown> {
  return ragListWorkspaces({} as never);
}
