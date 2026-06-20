'use client';

// Ledger balances, receipt chain, optional Plasma settlement.

import { useEffect, useState } from 'react';
import { REPLAY } from '../lib/replay';

// The verified settlement tx (chain 9746) — shown in replay mode.
const PLASMA_TX = '0x7a07094778177363dda884995a626cba40f1be1cbeecd9b828ac45a3dc00afb0';

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

  // Net each account's position from the receipt flow — the netted total (sum of
  // the credits) is what actually moves on-chain when the session settles, vs. the
  // dozens of tiny off-chain micropayments.
  const net: Record<string, number> = {};
  for (const t of ledger.transfers) {
    net[t.from_id] = (net[t.from_id] ?? 0) - t.amount;
    net[t.to_id] = (net[t.to_id] ?? 0) + t.amount;
  }
  const nettedUSDT = (
    Object.values(net).reduce((s, v) => s + (v > 0 ? v : 0), 0) / 1e6
  ).toFixed(2);

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
          {REPLAY ? '⛓️ View Plasma settlement tx ↗' : settling ? 'settling…' : '⛓️ Settle on Plasma testnet'}
        </button>
      </div>

      {settleResult && <div className="panel p-3 text-xs">{settleResult}</div>}

      {REPLAY && (
        <div className="panel p-3 text-xs border-[var(--accent2)]/40 flex flex-wrap items-center gap-2">
          <span className="text-[var(--accent2)] font-bold">⛓️ Plasma settlement</span>
          <span className="text-[var(--accent)] font-bold whitespace-nowrap">
            {ledger.chain.checked} receipts → {nettedUSDT} USDT netted → 1 tx
          </span>
          <span className="text-[var(--muted)]">
            Receipts stay off-chain on the local ledger; the whole session is netted and committed
            on-chain (merkle root of the receipt log) in one transaction on Plasma testnet:
          </span>
          <a
            href={`https://testnet.plasmascan.to/tx/${PLASMA_TX}`}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent2)] hover:underline ml-auto whitespace-nowrap font-mono"
          >
            {PLASMA_TX.slice(0, 14)}…{PLASMA_TX.slice(-6)} ↗
          </a>
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
        <div className="text-xs text-[var(--muted)] mb-2">
          Receipt chain (latest first) — off-chain micropayments; ⛓️ links open the one on-chain settlement they were netted into.
        </div>
        <table className="text-xs w-full">
          <thead className="text-[var(--muted)] text-left">
            <tr>
              <th className="pr-4">receipt</th><th className="pr-4">from</th><th className="pr-4">to</th>
              <th className="pr-4">amount</th><th className="pr-4">memo</th><th className="pr-4">hash</th><th>plasma</th>
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
                    <a href={`https://testnet.plasmascan.to/tx/${t.plasma_tx}`} target="_blank" rel="noreferrer"
                      className="text-[var(--accent2)] hover:underline">⛓️ {t.plasma_tx.slice(0, 10)}… ↗</a>
                  ) : REPLAY ? (
                    <a href={`https://testnet.plasmascan.to/tx/${PLASMA_TX}`} target="_blank" rel="noreferrer"
                      title="Netted into this session's single on-chain settlement"
                      className="text-[var(--accent2)]/70 hover:underline whitespace-nowrap">⛓️ view tx ↗</a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
