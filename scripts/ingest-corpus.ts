// Ingest corpus/*.md into the QVAC RAG workspace. Each chunk gets a
// [SOURCE: file] prefix so citations survive chunking. Run: npm run ingest

import fs from 'node:fs';
import path from 'node:path';
import { ragChunk, ragIngest, ragDeleteWorkspace, close } from '@qvac/sdk';
import { acquire, release, CORPUS_WORKSPACE, shutdownModels } from '../packages/engine/src/index.ts';

process.env.CARESWARM_PROCESS = 'ingest';

const CORPUS_DIR = path.join(process.cwd(), 'corpus');

const files = fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.md'));
if (!files.length) {
  console.error('No corpus files found in', CORPUS_DIR);
  process.exit(1);
}

console.log(`Ingesting ${files.length} corpus documents into workspace "${CORPUS_WORKSPACE}"…`);

// Fresh workspace each run
await ragDeleteWorkspace({ workspace: CORPUS_WORKSPACE } as never).catch(() => {});

const { modelId } = await acquire('embeddings');
try {
  let totalChunks = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8');
    const sourceName = file.replace(/\.md$/, '');

    const chunkRes = (await ragChunk({
      documents: text,
      chunkOpts: { chunkSize: 480, chunkOverlap: 48, chunkStrategy: 'paragraph' },
    } as never)) as unknown;

    const rawChunks: unknown[] = Array.isArray(chunkRes)
      ? chunkRes
      : ((chunkRes as { chunks?: unknown[] }).chunks ?? []);
    const chunks = rawChunks
      .map((c) => (typeof c === 'string' ? c : ((c as { text?: string; content?: string }).text ?? (c as { content?: string }).content ?? '')))
      .filter((c) => c.trim().length > 40)
      .map((c) => `[SOURCE: ${sourceName}] ${c}`);

    await ragIngest({
      workspace: CORPUS_WORKSPACE,
      modelId,
      documents: chunks,
      chunk: false,
    } as never);

    totalChunks += chunks.length;
    console.log(`  ✓ ${file} → ${chunks.length} chunks`);
  }
  console.log(`\nDone: ${totalChunks} chunks indexed in "${CORPUS_WORKSPACE}".`);
} finally {
  release('embeddings');
  await shutdownModels();
  await close().catch(() => {});
}
process.exit(0);
