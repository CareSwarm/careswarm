// Smoke test for every QVAC SDK call we depend on.
//   node scripts/smoke.mjs                  -> core sections
//   node scripts/smoke.mjs thinking vla     -> specific sections

import path from 'node:path';
import {
  loadModel,
  completion,
  unloadModel,
  embed,
  ragIngest,
  ragSearch,
  ragDeleteWorkspace,
  close,
  QWEN3_1_7B_INST_Q4,
  EMBEDDINGGEMMA_300M_Q8_0,
  SMOLVLA_LIBERO_VISION_Q8,
} from '@qvac/sdk';

const MODELS_DIR = process.env.QVAC_MODELS_DIR ?? './models';
const MEDPSY_1_7B = path.join(MODELS_DIR, 'medpsy-1.7b-q4_k_m-imat.gguf');
const MEDPSY_4B = path.join(MODELS_DIR, 'medpsy-4b-q4_k_m-imat.gguf');

const args = process.argv.slice(2);
const DEFAULT_SECTIONS = ['llm', 'tools', 'json', 'medpsy', 'embed', 'rag'];
const sections = args.length ? args : DEFAULT_SECTIONS;

const results = [];

function logProgress(label) {
  let last = 0;
  return (p) => {
    const pct = typeof p === 'number' ? p : (p?.progress ?? p?.percent ?? null);
    if (pct !== null && pct - last >= 0.25) {
      last = pct;
      console.log(`   [${label}] download/load progress:`, JSON.stringify(p).slice(0, 120));
    }
  };
}

async function section(name, fn) {
  if (!sections.includes(name)) return;
  const t0 = performance.now();
  console.log(`\n━━━ SMOKE: ${name} ━━━`);
  try {
    await fn();
    const ms = Math.round(performance.now() - t0);
    results.push({ name, ok: true, ms });
    console.log(`✅ ${name} PASS (${ms}ms)`);
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    results.push({ name, ok: false, ms, error: String(err?.message ?? err) });
    console.error(`❌ ${name} FAIL (${ms}ms):`, err);
  }
}

/** Drain a completion run; returns {text, thinking, toolCalls, stats, ttftMs} */
async function drain(run, { echo = false } = {}) {
  const t0 = performance.now();
  let ttftMs = null;
  let text = '';
  let thinking = '';
  const toolCalls = [];
  let stats = null;
  let stopReason = null;

  for await (const ev of run.events) {
    if (ttftMs === null && ['contentDelta', 'thinkingDelta', 'toolCall'].includes(ev.type)) {
      ttftMs = Math.round(performance.now() - t0);
    }
    if (ev.type === 'contentDelta') {
      text += ev.text;
      if (echo) process.stdout.write(ev.text);
    } else if (ev.type === 'thinkingDelta') {
      thinking += ev.text;
    } else if (ev.type === 'toolCall') {
      toolCalls.push(ev.call);
    } else if (ev.type === 'completionStats') {
      stats = ev.stats ?? ev;
    } else if (ev.type === 'completionDone') {
      stopReason = ev.stopReason ?? null;
    }
  }
  if (echo) process.stdout.write('\n');
  return { text, thinking, toolCalls, stats, stopReason, ttftMs };
}

// ── 1. Built-in LLM: load + streamed completion + stats ──────
await section('llm', async () => {
  const modelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: 'llm',
    modelConfig: { ctx_size: 4096 },
    onProgress: logProgress('qwen3-1.7b'),
  });
  console.log('   modelId:', modelId);
  const run = completion({
    modelId,
    history: [{ role: 'user', content: 'Reply with exactly: CARESWARM ONLINE /no_think' }],
    stream: true,
  });
  const out = await drain(run, { echo: true });
  console.log('   ttftMs:', out.ttftMs, 'stats:', JSON.stringify(out.stats));
  if (!out.text.toLowerCase().includes('careswarm')) {
    console.warn('   (model deviated from instruction — fine for smoke)');
  }
  await unloadModel({ modelId });
});

// ── 2. Native tool calling on Qwen3-1.7B ─────────────────────
await section('tools', async () => {
  const modelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: 'llm',
    modelConfig: { ctx_size: 4096, tools: true },
    onProgress: logProgress('qwen3-tools'),
  });
  const tools = [
    {
      type: 'function',
      name: 'classify_urgency',
      description: 'Classify the medical urgency of the user message. Always call this tool.',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: ['emergency', 'urgent', 'routine'],
            description: 'Urgency level',
          },
          rationale: { type: 'string', description: 'One-sentence reason' },
        },
        required: ['level', 'rationale'],
      },
    },
  ];
  const run = completion({
    modelId,
    history: [
      {
        role: 'system',
        content:
          'You are a triage classifier. You MUST call the classify_urgency tool with your assessment. Do not answer in plain text. /no_think',
      },
      {
        role: 'user',
        content: 'I have had a mild headache for two days, no other symptoms.',
      },
    ],
    tools,
    stream: true,
  });
  const out = await drain(run);
  console.log('   toolCalls:', JSON.stringify(out.toolCalls, null, 2).slice(0, 400));
  console.log('   text:', out.text.slice(0, 120));
  if (!out.toolCalls.length) throw new Error('No toolCall event received');
  await unloadModel({ modelId });
});

// ── 3. Grammar-constrained JSON output (responseFormat) ──────
await section('json', async () => {
  const modelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: 'llm',
    modelConfig: { ctx_size: 4096 },
    onProgress: logProgress('qwen3-json'),
  });
  const run = completion({
    modelId,
    history: [
      {
        role: 'system',
        content: 'Plan workflow steps for the request. Agents: triage, librarian, clinician, scribe, translator. /no_think',
      },
      { role: 'user', content: 'My father has chest pain when climbing stairs. Reply in Vietnamese.' },
    ],
    stream: true,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'create_plan',
        schema: {
          type: 'object',
          properties: {
            urgency: { type: 'string', enum: ['emergency', 'urgent', 'routine'] },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agent: { type: 'string', enum: ['triage', 'librarian', 'clinician', 'scribe', 'translator'] },
                  instruction: { type: 'string' },
                },
                required: ['agent', 'instruction'],
              },
            },
            summary: { type: 'string' },
          },
          required: ['urgency', 'steps', 'summary'],
        },
        strict: true,
      },
    },
  });
  const out = await drain(run);
  const parsed = JSON.parse(out.text);
  console.log('   parsed plan:', JSON.stringify(parsed).slice(0, 300));
  if (!parsed.steps?.length) throw new Error('Empty steps in JSON plan');
  await unloadModel({ modelId });
});

// ── 4. Custom local GGUF: MedPsy-1.7B ────────────────────────
await section('medpsy', async () => {
  const modelId = await loadModel({
    modelSrc: MEDPSY_1_7B,
    modelType: 'llm',
    modelConfig: { ctx_size: 4096, temp: 0.6, top_k: 20, top_p: 0.95 },
    onProgress: logProgress('medpsy-1.7b'),
  });
  const run = completion({
    modelId,
    history: [
      { role: 'user', content: 'List three common causes of exertional chest pain in one sentence each.' },
    ],
    stream: true,
  });
  const out = await drain(run, { echo: true });
  console.log('   ttftMs:', out.ttftMs, 'stats:', JSON.stringify(out.stats));
  if (out.text.length < 20) throw new Error('Suspiciously short MedPsy output');
  await unloadModel({ modelId });
});

// ── 5. MedPsy-4B-Thinking with captureThinking ───────────────
await section('thinking', async () => {
  const modelId = await loadModel({
    modelSrc: MEDPSY_4B,
    modelType: 'llm',
    modelConfig: { ctx_size: 4096, temp: 0.6, top_k: 20, top_p: 0.95 },
    onProgress: logProgress('medpsy-4b'),
  });
  const run = completion({
    modelId,
    history: [
      { role: 'user', content: 'A 62-year-old has chest tightness when climbing stairs. Key differential diagnoses? Keep the final answer under 120 words.' },
    ],
    stream: true,
    captureThinking: true,
  });
  const out = await drain(run);
  console.log('   thinking chars:', out.thinking.length, '| answer chars:', out.text.length);
  console.log('   thinking preview:', out.thinking.slice(0, 200).replace(/\n/g, ' '));
  console.log('   answer preview:', out.text.slice(0, 200).replace(/\n/g, ' '));
  console.log('   ttftMs:', out.ttftMs, 'stats:', JSON.stringify(out.stats));
  await unloadModel({ modelId });
});

// ── 6. Embeddings ────────────────────────────────────────────
await section('embed', async () => {
  const modelId = await loadModel({
    modelSrc: EMBEDDINGGEMMA_300M_Q8_0,
    modelType: 'embeddings',
    onProgress: logProgress('embeddinggemma'),
  });
  const res = await embed({
    modelId,
    text: ['chest pain when climbing stairs', 'angina pectoris exertional symptoms', 'how to bake a chocolate cake'],
  });
  const vecs = res.embedding ?? res;
  const dims = vecs[0]?.length;
  const cos = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };
  const simRelated = cos(vecs[0], vecs[1]);
  const simUnrelated = cos(vecs[0], vecs[2]);
  console.log(`   dims=${dims} sim(related)=${simRelated.toFixed(3)} sim(unrelated)=${simUnrelated.toFixed(3)}`);
  if (!(simRelated > simUnrelated)) throw new Error('Embedding sanity check failed');
  await unloadModel({ modelId });
});

// ── 7. RAG workspace: ingest + search ────────────────────────
await section('rag', async () => {
  const modelId = await loadModel({
    modelSrc: EMBEDDINGGEMMA_300M_Q8_0,
    modelType: 'embeddings',
    onProgress: logProgress('rag-embed'),
  });
  const workspace = 'smoke-test';
  const docs = [
    'Stable angina: chest pain triggered by exertion such as climbing stairs, relieved by rest. Risk increases with age, smoking, hypertension.',
    'Gastroesophageal reflux can cause burning chest discomfort after meals, unrelated to exertion.',
    'Acute emergencies: chest pain with collapse, severe shortness of breath, or radiation to the jaw requires immediate emergency services.',
  ];
  await ragIngest({ workspace, modelId, documents: docs, chunk: true, chunkOpts: { chunkSize: 256 } });
  const hits = await ragSearch({ workspace, modelId, query: 'pain when climbing stairs', topK: 2 });
  console.log('   search hits:', JSON.stringify(hits).slice(0, 400));
  const arr = hits?.results ?? hits;
  if (!arr?.length) throw new Error('RAG search returned nothing');
  await ragDeleteWorkspace({ workspace }).catch(() => {});
  await unloadModel({ modelId });
});

// ── 8. VLA (SmolVLA-LIBERO) — flag-only, big download ────────
await section('vla', async () => {
  const { vla, vlaHparams, vlaPadState, VLA_DEFAULT_IMAGE_SIZE } = await import('@qvac/sdk');
  const modelId = await loadModel({
    modelSrc: SMOLVLA_LIBERO_VISION_Q8,
    modelType: 'vla',
    onProgress: logProgress('smolvla'),
  });
  const hp = await vlaHparams({ modelId });
  console.log('   vla hparams:', JSON.stringify(hp).slice(0, 300));
  const size = VLA_DEFAULT_IMAGE_SIZE ?? 256;
  const fakeImg = new Float32Array(3 * size * size).fill(0.5);
  const stateDim = hp?.stateDim ?? hp?.state_dim ?? 8;
  const fakeState = new Float32Array(stateDim).fill(0);
  const out = await vla({
    modelId,
    images: [fakeImg, fakeImg],
    state: fakeState,
    instruction: 'pick up the medicine box',
  });
  console.log('   vla result keys:', Object.keys(out ?? {}));
  console.log('   actions preview:', JSON.stringify(out?.actions ?? out)?.slice(0, 200));
  await unloadModel({ modelId });
});

// ── Summary ──────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━ SMOKE SUMMARY ━━━━━━━━━━━━');
for (const r of results) {
  console.log(` ${r.ok ? '✅' : '❌'} ${r.name.padEnd(10)} ${r.ms}ms ${r.error ?? ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} section(s) FAILED` : '\nALL SECTIONS PASSED');

await close().catch(() => {});
process.exit(failed ? 1 : 0);
