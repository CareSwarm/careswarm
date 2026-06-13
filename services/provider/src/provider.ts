// P2P inference provider: hosts MedPsy-4B over the Hyperswarm DHT (QVAC
// delegated inference) and sells prepaid sessions through a 402 paywall.
// Run in a second terminal: npm run provider
//
// On a sale we write data/provider-session.json; the clinician agent picks
// it up and runs its next inferences delegated (weights stay here).

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startQVACProvider } from '@qvac/sdk';
import { acquire, relayEngineEvents, shutdownModels } from '@careswarm/engine';
import { paymentRequired, verifyReceipt, formatUSDT } from '@careswarm/payments';

process.env.CARESWARM_PROCESS = process.env.CARESWARM_PROCESS ?? 'provider';

const PORT = Number(process.env.PROVIDER_PORT ?? 3002);
const DATA_DIR = process.env.CARESWARM_DATA_DIR ?? path.join(process.cwd(), 'data');
const SESSION_FILE = path.join(DATA_DIR, 'provider-session.json');
const SESSION_TTL_MS = 15 * 60_000;

// Flat session pricing: base + per-token rate against a cap. Keeps billing
// simple — no streaming meter, actuals go in the receipt memo.
const BASE_MICRO = 50_000; // 0.05 USDT
const PER_TOKEN_MICRO = 0.1; // 0.0001 USDT per token of cap

function sessionPrice(maxTokens: number): string {
  return String(Math.round(BASE_MICRO + PER_TOKEN_MICRO * maxTokens));
}

console.log('🛰️  Starting P2P provider…');

// Expose this process on the DHT. No firewall for the demo (single machine,
// disclosed in the README); lock down with publicKeys for real deployments.
const provide = (await startQVACProvider({})) as { publicKey?: string; success?: boolean };
const providerPublicKey = provide.publicKey;
if (!providerPublicKey) {
  console.error('startQVACProvider failed:', provide);
  process.exit(1);
}
console.log(`   DHT public key: ${providerPublicKey}`);

// Keep the big model warm so delegated calls don't pay the load cost
console.log('   warming MedPsy-4B…');
await acquire('medpsy_4b');
console.log('   ready to serve delegated inference.');

relayEngineEvents();

const app = express();
app.use(express.json());

app.get('/status', (_req, res) => {
  res.json({ ok: true, providerPublicKey, model: 'medpsy_4b', port: PORT });
});

// Buy a delegated-inference session (402-gated).
app.post(
  '/session',
  paymentRequired({
    payTo: 'provider',
    amount: (req) => sessionPrice(Number(req.body?.maxTokens ?? 2000)),
    description: 'P2P delegated inference session (MedPsy-4B)',
    verifyPayment: async (proofId, req) =>
      verifyReceipt(proofId, {
        to: 'provider',
        amount: sessionPrice(Number(req.body?.maxTokens ?? 2000)),
      }).valid,
  }),
  (req: express.Request & { paymentProof?: string }, res) => {
    const session = {
      sessionId: `sess-${randomUUID().slice(0, 8)}`,
      providerPublicKey,
      paymentReceipt: req.paymentProof,
      maxTokens: Number(req.body?.maxTokens ?? 2000),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    console.log(
      `💸 sold session ${session.sessionId} for ${formatUSDT(sessionPrice(session.maxTokens))} USDT (receipt ${req.paymentProof})`,
    );
    res.json(session);
  },
);

app.listen(PORT, () => {
  console.log(`   session shop on :${PORT}  (POST /session, 402-gated)`);
});

process.on('SIGINT', async () => {
  console.log('\n[provider] shutting down…');
  try { fs.unlinkSync(SESSION_FILE); } catch {}
  await shutdownModels();
  process.exit(0);
});
