// Anchor the CURRENT replay ledger head on Plasma testnet — a 0-value self-tx
// whose calldata is `careswarm:<head>:<digest>`, covering every receipt in the
// chain (not just an earlier checkpoint). Run once, then paste the printed tx
// hash + head back so the dashboard/verify script point at the full anchor.
//
//   PLASMA_PRIVATE_KEY must be funded with testnet gas (https://gas.zip/faucet/plasma).
//   node scripts/anchor-ledger.mjs

import { JsonRpcProvider, Wallet, hexlify, toUtf8Bytes } from 'ethers';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// minimal .env loader (only needs PLASMA_PRIVATE_KEY / PLASMA_RPC_URL)
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
} catch {}

const pk = process.env.PLASMA_PRIVATE_KEY || env.PLASMA_PRIVATE_KEY;
const RPC = process.env.PLASMA_RPC_URL || env.PLASMA_RPC_URL || 'https://testnet-rpc.plasma.to';
if (!pk) throw new Error('PLASMA_PRIVATE_KEY not set (put it in .env)');

const ledger = JSON.parse(
  readFileSync(new URL('../apps/dashboard/public/replay/ledger.json', import.meta.url), 'utf8'),
);
const { transfers, balances } = ledger;

// chain tip = the hash that is nobody's prev_hash
const prevs = new Set(transfers.map((t) => t.prev_hash));
const tip = transfers.find((t) => !prevs.has(t.hash));
if (!tip) throw new Error('could not find a single chain tip');
const head = tip.hash;
const digest = createHash('sha256').update(JSON.stringify({ head, balances })).digest('hex');

const provider = new JsonRpcProvider(RPC, 9746);
const wallet = new Wallet(pk, provider);
console.log(`anchoring head ${head}`);
console.log(`from ${wallet.address} → Plasma testnet (chain 9746)`);

const tx = await wallet.sendTransaction({
  to: wallet.address,
  value: 0n,
  data: hexlify(toUtf8Bytes(`careswarm:${head}:${digest}`)),
});
console.log(`tx sent: ${tx.hash} — waiting for confirmation…`);
await tx.wait();

console.log('\n✓ anchored. Send these two values back so the dashboard updates:');
console.log(`  PLASMA_TX     = ${tx.hash}`);
console.log(`  ANCHORED_HEAD = ${head}`);
console.log(`  explorer: https://testnet.plasmascan.to/tx/${tx.hash}`);
