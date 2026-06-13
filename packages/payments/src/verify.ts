// Verify an X-Payment-Proof receipt against the ledger.

import { getReceipt } from './ledger.ts';
import type { PaymentProof, VerificationResult } from './types.ts';
import { USDT_TOKEN, PLASMA_TESTNET_CHAIN_ID } from './constants.ts';

export interface VerifyExpectation {
  /** Expected recipient account */
  to: string;
  /** Expected amount in micro-USDT (exact or minimum) */
  amount: string;
  /** Reject receipts older than this many seconds (default 600) */
  maxAgeSec?: number;
}

export function verifyReceipt(
  receiptId: string,
  expected: VerifyExpectation,
): VerificationResult {
  const row = getReceipt(receiptId);
  if (!row) {
    return { valid: false, proof: null, error: `Unknown receipt: ${receiptId}` };
  }
  if (row.to_id !== expected.to) {
    return {
      valid: false,
      proof: null,
      error: `Receipt pays ${row.to_id}, expected ${expected.to}`,
    };
  }
  if (row.amount < Number(expected.amount)) {
    return {
      valid: false,
      proof: null,
      error: `Receipt amount ${row.amount} below required ${expected.amount}`,
    };
  }
  const maxAge = expected.maxAgeSec ?? 600;
  if (Math.floor(Date.now() / 1000) - row.ts > maxAge) {
    return { valid: false, proof: null, error: 'Receipt expired' };
  }

  const proof: PaymentProof = {
    proofId: row.id,
    hash: row.hash,
    from: row.from_id,
    to: row.to_id,
    amount: String(row.amount),
    token: USDT_TOKEN,
    chain: PLASMA_TESTNET_CHAIN_ID,
    timestamp: row.ts,
  };
  return { valid: true, proof };
}
