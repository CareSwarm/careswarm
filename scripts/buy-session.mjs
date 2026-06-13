// Buy a delegated-inference session from the P2P provider (pays the 402).
// Usage: node scripts/buy-session.mjs [maxTokens]
import { LedgerPaymentClient, formatUSDT } from '../packages/payments/src/index.ts';

const maxTokens = Number(process.argv[2] ?? 2000);
const url = `${process.env.PROVIDER_URL ?? 'http://localhost:3002'}/session`;

const client = new LedgerPaymentClient({
  accountId: 'user',
  maxAutoPayAmount: '1000000',
  onPayment: (p) => console.log(`💸 paid ${formatUSDT(p.amount)} USDT → ${p.to} (${p.proofId})`),
});

const res = await client.fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ maxTokens }),
});
if (!res.ok) {
  console.error('failed:', res.status, await res.text());
  process.exit(1);
}
const session = await res.json();
console.log('session:', session);
console.log('→ clinician will now run delegated (data/provider-session.json)');
