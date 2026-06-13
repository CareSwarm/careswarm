'use client';

// Ledger balances, receipt chain, optional Plasma settlement.

import { useEffect, useState } from 'react';

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
    const load = () => fetch('/api/ledger').then((r) => r.json()).then(setLedger).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  async function settleOnPlasma() {
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
          {settling ? 'settling…' : '⛓️ Settle on Plasma testnet'}
        </button>
      </div>

      {settleResult && <div className="panel p-3 text-xs">{settleResult}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ledger.balances.map((b) => (
          <div key={b.id} className="panel px-4 py-3">
            <div className="text-xs text-[var(--muted)]">{b.id}</div>
            <div className="text-lg font-bold text-[var(--accent)]">{b.display}</div>
          </div>
        ))}
      </div>

      <div className="panel p-4 overflow-x-auto">
        <div className="text-xs text-[var(--muted)] mb-2">Receipt chain (latest first)</div>
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
                <td>{t.plasma_tx ? `⛓️ ${t.plasma_tx.slice(0, 10)}…` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
