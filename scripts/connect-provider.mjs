// Buy a P2P delegated-inference session from a remote provider and point the
// clinician at it. Pays on the local USDT ledger (cross-machine settlement is
// what the Plasma path is for); the clinician then delegates over the DHT.
// Usage: node scripts/connect-provider.mjs <PROVIDER_PUBKEY>

import fs from 'node:fs';
import path from 'node:path';
import { transfer, formatUSDT } from '../packages/payments/src/index.ts';

const pubkey = process.argv[2];
if (!pubkey || pubkey.length < 32) {
  console.error('usage: node scripts/connect-provider.mjs <PROVIDER_PUBKEY>');
  process.exit(1);
}

const PRICE = 50_000; // 0.05 USDT
const { receiptId } = transfer('user', 'provider', PRICE, 'P2P delegated MedPsy-4B session');

const dataDir = process.env.CARESWARM_DATA_DIR ?? path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, 'provider-session.json'),
  JSON.stringify(
    { providerPublicKey: pubkey, paymentReceipt: receiptId, maxTokens: 2000, expiresAt: Date.now() + 30 * 60_000 },
    null,
    2,
  ),
);

console.log(`paid ${formatUSDT(PRICE)} USDT → provider (receipt ${receiptId})`);
console.log(`clinician will delegate to ${pubkey.slice(0, 16)}… (fallbackToLocal on)`);
