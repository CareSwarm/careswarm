// Local USDT ledger (SQLite, WAL so all 3 processes share one file).
// Transfers are sha256-chained -> tamper-evident receipts; a receipt id is
// what travels in X-Payment-Proof. Optional Plasma netting in plasma.ts.

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.CARESWARM_DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'ledger.db');

export interface TransferRow {
  id: string;
  hash: string;
  prev_hash: string;
  from_id: string;
  to_id: string;
  amount: number; // micro-USDT
  memo: string | null;
  job_id: string | null;
  ts: number; // unix seconds
  plasma_tx: string | null;
}

export interface HoldRow {
  id: string;
  from_id: string;
  amount: number;
  status: 'held' | 'settled' | 'released';
  memo: string | null;
  ts: number;
}

/** Default opening balances (micro-USDT) */
const SEED: Record<string, number> = {
  user: 100_000_000, // 100 USDT
  orchestrator: 50_000_000,
  provider: 0,
};
const AGENT_SEED = 10_000_000; // 10 USDT per agent account

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      memo TEXT,
      job_id TEXT,
      ts INTEGER NOT NULL,
      plasma_tx TEXT
    );
    CREATE TABLE IF NOT EXISTS holds (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      memo TEXT,
      ts INTEGER NOT NULL
    );
  `);
  for (const [id, balance] of Object.entries(SEED)) {
    db.prepare(
      'INSERT OR IGNORE INTO accounts (id, balance) VALUES (?, ?)',
    ).run(id, balance);
  }
  return db;
}

/** Create the account if missing. Agent accounts get a working-capital seed. */
export function ensureAccount(id: string): void {
  const seed = id.startsWith('agent:') ? AGENT_SEED : 0;
  getDb()
    .prepare('INSERT OR IGNORE INTO accounts (id, balance) VALUES (?, ?)')
    .run(id, seed);
}

export function balanceOf(id: string): number {
  const row = getDb()
    .prepare('SELECT balance FROM accounts WHERE id = ?')
    .get(id) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export function balances(): Array<{ id: string; balance: number }> {
  return getDb()
    .prepare('SELECT id, balance FROM accounts ORDER BY id')
    .all() as Array<{ id: string; balance: number }>;
}

function lastHash(d: Database.Database): string {
  const row = d
    .prepare('SELECT hash FROM transfers ORDER BY rowid DESC LIMIT 1')
    .get() as { hash: string } | undefined;
  return row?.hash ?? 'genesis';
}

/**
 * Atomically move micro-USDT between accounts.
 * Returns the receipt — its id is what travels in X-Payment-Proof.
 */
export function transfer(
  from: string,
  to: string,
  amountMicro: number,
  memo?: string,
  jobId?: string,
): { receiptId: string; hash: string } {
  if (!Number.isInteger(amountMicro) || amountMicro <= 0) {
    throw new Error(`Invalid transfer amount: ${amountMicro}`);
  }
  const d = getDb();
  ensureAccount(from);
  ensureAccount(to);

  const run = d.transaction(() => {
    const bal = balanceOf(from);
    if (bal < amountMicro) {
      throw new Error(
        `Insufficient balance: ${from} has ${bal}, needs ${amountMicro}`,
      );
    }
    const id = `rcpt-${randomUUID().slice(0, 8)}`;
    const ts = Math.floor(Date.now() / 1000);
    const prev = lastHash(d);
    const hash = createHash('sha256')
      .update(prev + JSON.stringify({ id, from, to, amountMicro, memo, jobId, ts }))
      .digest('hex');

    d.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(
      amountMicro,
      from,
    );
    d.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(
      amountMicro,
      to,
    );
    d.prepare(
      `INSERT INTO transfers (id, hash, prev_hash, from_id, to_id, amount, memo, job_id, ts, plasma_tx)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(id, hash, prev, from, to, amountMicro, memo ?? null, jobId ?? null, ts);

    return { receiptId: id, hash };
  });

  return run();
}

export function getReceipt(receiptId: string): TransferRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM transfers WHERE id = ?')
      .get(receiptId) as TransferRow | undefined) ?? null
  );
}

export function listTransfers(limit = 200): TransferRow[] {
  return getDb()
    .prepare('SELECT * FROM transfers ORDER BY rowid DESC LIMIT ?')
    .all(limit) as TransferRow[];
}

// ── Escrow holds (workflow budget locking) ───────────────────

export function hold(from: string, amountMicro: number, memo?: string): string {
  const d = getDb();
  ensureAccount(from);
  const run = d.transaction(() => {
    const bal = balanceOf(from);
    if (bal < amountMicro) {
      throw new Error(
        `Insufficient balance for hold: ${from} has ${bal}, needs ${amountMicro}`,
      );
    }
    const id = `hold-${randomUUID().slice(0, 8)}`;
    d.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?').run(
      amountMicro,
      from,
    );
    d.prepare(
      'INSERT INTO holds (id, from_id, amount, status, memo, ts) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, from, amountMicro, 'held', memo ?? null, Math.floor(Date.now() / 1000));
    return id;
  });
  return run();
}

/** Release an unused hold back to the payer (full or remaining amount). */
export function releaseHold(holdId: string): void {
  const d = getDb();
  const run = d.transaction(() => {
    const h = d.prepare('SELECT * FROM holds WHERE id = ?').get(holdId) as
      | HoldRow
      | undefined;
    if (!h || h.status !== 'held') return;
    d.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(
      h.amount,
      h.from_id,
    );
    d.prepare("UPDATE holds SET status = 'released' WHERE id = ?").run(holdId);
  });
  run();
}

/** Mark a hold consumed (its funds were spent via transfers already made). */
export function consumeHold(holdId: string, refundMicro = 0): void {
  const d = getDb();
  const run = d.transaction(() => {
    const h = d.prepare('SELECT * FROM holds WHERE id = ?').get(holdId) as
      | HoldRow
      | undefined;
    if (!h || h.status !== 'held') return;
    if (refundMicro > 0) {
      d.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(
        Math.min(refundMicro, h.amount),
        h.from_id,
      );
    }
    d.prepare("UPDATE holds SET status = 'settled' WHERE id = ?").run(holdId);
  });
  run();
}

/** Verify the tamper-evident hash chain end-to-end (used by /api/ledger). */
export function verifyChain(): { valid: boolean; checked: number } {
  const rows = getDb()
    .prepare('SELECT * FROM transfers ORDER BY rowid ASC')
    .all() as TransferRow[];
  let prev = 'genesis';
  for (const r of rows) {
    const expect = createHash('sha256')
      .update(
        prev +
          JSON.stringify({
            id: r.id,
            from: r.from_id,
            to: r.to_id,
            amountMicro: r.amount,
            memo: r.memo ?? undefined,
            jobId: r.job_id ?? undefined,
            ts: r.ts,
          }),
      )
      .digest('hex');
    if (expect !== r.hash) return { valid: false, checked: rows.length };
    prev = r.hash;
  }
  return { valid: true, checked: rows.length };
}

export function chainHead(): string {
  return lastHash(getDb());
}

export function unsettledReceiptIds(): string[] {
  return (
    getDb()
      .prepare('SELECT id FROM transfers WHERE plasma_tx IS NULL')
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
}

export function markSettledOnPlasma(receiptIds: string[], txHash: string): void {
  const d = getDb();
  const stmt = d.prepare('UPDATE transfers SET plasma_tx = ? WHERE id = ?');
  const run = d.transaction(() => {
    for (const id of receiptIds) stmt.run(txHash, id);
  });
  run();
}
