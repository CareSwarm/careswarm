'use client';

// Ledger balances, receipt chain, optional Plasma settlement.

import { useEffect, useState } from 'react';
import { REPLAY } from '../lib/replay';

// The on-chain anchor tx (Plasma testnet, chain 9746) and the receipt-chain head
// it notarizes in calldata: `careswarm:<head>:<digest>`. Reproduce/verify with
// `node scripts/verify-onchain.mjs`. Shown in replay mode.
const PLASMA_TX = '0x7a07094778177363dda884995a626cba40f1be1cbeecd9b828ac45a3dc00afb0';
const ANCHORED_HEAD = '9db436aaade4c4199b2174587ea20fe6ccf0fc8bf5d43c0bb9e6bf48617af9fd';

interface Ledger {
  balances: Array<{ id: string; balance: number; display: string }>;
  transfers: Array<{
    id: string; hash: string; from_id: string; to_id: string;
    amount: number; memo: string | null; ts: number; plasma_tx: string | null;
  }>;
  chain: { valid: boolean; checked: number };
}

export default function EconomyPage() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleResult, setSettleResult] = useState<string | null>(null);

  useEffect(() => {
    const url = REPLAY ? '/replay/ledger.json' : '/api/ledger';
    const load = () => fetch(url).then((r) => r.json()).then(setLedger).catch(() => {});
    load();
    if (REPLAY) return; // static in replay
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function settleOnPlasma() {
    // Replay mode: the settlement already happened — link to the real tx.
    if (REPLAY) {
      window.open(`https://testnet.plasmascan.to/tx/${PLASMA_TX}`, '_blank');
      return;
    }
    setSettling(true);
    setSettleResult(null);
    try {
      const res = await fetch('/api/settle', { method: 'POST' });
      const data = await res.json();
      setSettleResult(res.ok ? `⛓️ settled: ${data.txHash}` : `❌ ${data.error}`);
    } catch (err: any) {
      setSettleResult(`❌ ${err.message}`);
    } finally {
      setSettling(false);
    }
  }

  if (!ledger) return <div className="text-[var(--muted)] text-sm">loading ledger…</div>;

  // Receipts that were checkpointed on-chain carry the Plasma anchor tx.
  const settledCount = ledger.transfers.filter((t) => t.plasma_tx).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="text-sm text-[var(--muted)]">
          Local USDT ledger — every agent job is a micropayment; receipts are sha256-chained.
        </h1>
        <span className={`text-xs px-2 py-1 rounded ${ledger.chain.valid ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--danger)]/20 text-[var(--danger)]'}`}>
          chain {ledger.chain.valid ? 'VALID' : 'BROKEN'} · {ledger.chain.checked} receipts
        </span>
        <button
          onClick={settleOnPlasma}
          disabled={settling}
          className="ml-auto text-xs px-3 py-1.5 rounded border border-[var(--accent2)] text-[var(--accent2)] hover:bg-[var(--accent2)]/10 disabled:opacity-40"
          title="Optional: net session balances on Tether's Plasma testnet (disclosed remote API)"
        >
          {REPLAY ? '⛓️ View on-chain anchor tx ↗' : settling ? 'anchoring…' : '⛓️ Anchor on Plasma testnet'}
        </button>
      </div>

      {settleResult && <div className="panel p-3 text-xs">{settleResult}</div>}

      {REPLAY && (
        <div className="panel p-3 text-xs border-[var(--accent2)]/40 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-[var(--accent2)] font-bold">⛓️ On-chain anchor · Plasma testnet</span>
            <span className="text-[var(--muted)]">
              The USDT ledger is a sha256 hash chain; a 0-value checkpoint tx notarizes its head on-chain,
              so the off-chain ledger can&apos;t be rewritten. (It anchors a hash — not a token transfer.)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono">
            <span className="text-[var(--muted)]">anchored head <span className="text-[var(--accent)]">{ANCHORED_HEAD.slice(0, 18)}…</span></span>
            <span className="text-[var(--muted)]">settled <span className="text-[var(--accent)]">{settledCount} receipts</span></span>
            <a href={`https://testnet.plasmascan.to/tx/${PLASMA_TX}`} target="_blank" rel="noreferrer"
              className="text-[var(--accent2)] hover:underline">{PLASMA_TX.slice(0, 14)}…{PLASMA_TX.slice(-6)} ↗</a>
            <span className="text-[var(--muted)]">verify <span className="text-[var(--text)]">node scripts/verify-onchain.mjs</span></span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ledger.balances.map((b) => (
          <div key={b.id} className="panel px-4 py-3">
            <div className="text-xs text-[var(--muted)]">{b.id}</div>
            <div className="text-lg font-bold text-[var(--accent)]">{b.display}</div>
          </div>
        ))}
      </div>

      <div className="panel p-4 overflow-x-auto">
        <div className="text-xs text-[var(--muted)] mb-2 leading-relaxed">
          Receipt chain (latest first) — <span className="text-[var(--text)]">off-chain</span> USDT micropayments, sha256-linked
          (each receipt commits to the previous one, so the chain is tamper-evident). The settled session&apos;s head is
          <span className="text-[var(--accent2)]"> anchored on-chain</span> above; later receipts are pending the next checkpoint.
        </div>
        <table className="text-xs w-full">
          <thead className="text-[var(--muted)] text-left">
            <tr>
              <th className="pr-4">receipt</th><th className="pr-4">from</th><th className="pr-4">to</th>
              <th className="pr-4">amount</th><th className="pr-4">memo</th><th className="pr-4">hash</th><th>on-chain</th>
            </tr>
          </thead>
          <tbody>
            {ledger.transfers.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border)]">
                <td className="pr-4 text-[var(--accent)]">{t.id}</td>
                <td className="pr-4">{t.from_id}</td>
                <td className="pr-4">{t.to_id}</td>
                <td className="pr-4">{(t.amount / 1e6).toFixed(2)} USDT</td>
                <td className="pr-4 text-[var(--muted)] max-w-48 truncate">{t.memo}</td>
                <td className="pr-4 text-[var(--muted)]">{t.hash.slice(0, 10)}…</td>
                <td>
                  {t.plasma_tx ? (
                    <span
                      title="This receipt is inside the on-chain-anchored checkpoint — its chain head is committed in the Plasma tx above."
                      className="text-[var(--accent2)]/70 whitespace-nowrap cursor-help"
                    >
                      ⛓ anchored
                    </span>
                  ) : (
                    <span className="text-[var(--muted)] whitespace-nowrap">— off-chain</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
