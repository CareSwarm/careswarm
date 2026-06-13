// fetch() wrapper that auto-pays 402 responses from a ledger account and
// retries with X-Payment-Proof. maxAutoPayAmount is the safety cap.

import type { PaymentConfig, PaymentProof, PaymentRequired } from './types.ts';
import { parsePaymentHeaders } from './headers.ts';
import { HEADERS, USDT_TOKEN, PLASMA_TESTNET_CHAIN_ID } from './constants.ts';
import { transfer, balanceOf, ensureAccount } from './ledger.ts';

export class LedgerPaymentClient {
  private accountId: string;
  private maxAutoPayAmount: bigint | null;
  private onPayment?: (proof: PaymentProof) => void;

  constructor(config: PaymentConfig) {
    this.accountId = config.accountId;
    this.maxAutoPayAmount = config.maxAutoPayAmount
      ? BigInt(config.maxAutoPayAmount)
      : null;
    this.onPayment = config.onPayment;
    ensureAccount(this.accountId);
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(url, init);
    if (response.status !== 402) {
      return response;
    }

    const paymentReq = parsePaymentHeaders(response.headers);
    if (!paymentReq) {
      throw new Error('Server returned 402 but missing valid X-Payment-* headers');
    }
    paymentReq.resourceUrl = paymentReq.resourceUrl || url;

    if (this.maxAutoPayAmount !== null) {
      const requestedAmount = BigInt(paymentReq.amount);
      if (requestedAmount > this.maxAutoPayAmount) {
        throw new Error(
          `Payment amount ${paymentReq.amount} exceeds safety limit ${this.maxAutoPayAmount.toString()}`,
        );
      }
    }

    const proof = this.pay(paymentReq);
    if (this.onPayment) {
      this.onPayment(proof);
    }

    const retryHeaders = new Headers(init?.headers || {});
    retryHeaders.set(HEADERS.PROOF, proof.proofId);

    return fetch(url, { ...init, headers: retryHeaders });
  }

  /** Settle a payment requirement on the local ledger. */
  private pay(req: PaymentRequired): PaymentProof {
    const amount = Number(req.amount);
    const { receiptId, hash } = transfer(
      this.accountId,
      req.payTo,
      amount,
      req.description ?? req.resourceUrl,
    );
    return {
      proofId: receiptId,
      hash,
      from: this.accountId,
      to: req.payTo,
      amount: req.amount,
      token: req.token || USDT_TOKEN,
      chain: req.chain || PLASMA_TESTNET_CHAIN_ID,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  /** Current ledger balance of this client account (micro-USDT). */
  getBalance(): string {
    return String(balanceOf(this.accountId));
  }

  get address(): string {
    return this.accountId;
  }
}
