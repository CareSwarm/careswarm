// Standalone P2P inference provider for a remote box (e.g. a cheap VPS).
// Hosts MedPsy-4B over the Hyperswarm DHT so a low-RAM laptop can delegate
// the heavy clinician step to it. Only needs `@qvac/sdk` + the GGUF — not the
// full repo. Deploy steps in deploy/README.md.

import fs from 'node:fs';
import { startQVACProvider, loadModel } from '@qvac/sdk';

const MODEL = process.env.MODEL_PATH ?? '/root/cs-provider/models/medpsy-4b-q4_k_m-imat.gguf';
const allowed = process.env.ALLOWED_CONSUMER_KEY;

const res = await startQVACProvider(
  allowed ? { firewall: { mode: 'allow', publicKeys: [allowed] } } : {},
);
fs.writeFileSync('pubkey.txt', res.publicKey + '\n');
console.log('PROVIDER_PUBKEY=' + res.publicKey);

console.log('warming MedPsy-4B…');
const id = await loadModel({
  modelSrc: MODEL,
  modelType: 'llm',
  modelConfig: { ctx_size: 4096, temp: 0.6, top_k: 20, top_p: 0.95 },
});
fs.writeFileSync('ready.txt', id + '\n');
console.log('MODEL_READY=' + id);

process.stdin.resume();
