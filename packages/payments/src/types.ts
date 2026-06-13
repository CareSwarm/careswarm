// x402 types. Wallet addresses / tx hashes from the original on-chain
// protocol become ledger account ids / receipt ids; headers stay the same.

/** Payment request parsed from 402 response headers */
export interface PaymentRequired {
  /** Recipient ledger account (e.g. "agent:clinician") */
  payTo: string;
  /** Amount in micro-USDT (6 decimals, e.g. "20000" = 0.02) */
  amount: string;
  /** Token identifier (always "USDT" on the local ledger) */
  token: string;
  /** Chain ID (9746 = Plasma testnet; symbolic in local mode) */
  chain: number;
  /** Maximum acceptable amount — client rejects if amount exceeds this */
  maxAmount?: string;
  network?: string;
  facilitator?: string;
  /** Human-readable description of what is being paid for */
  description?: string;
  /** The URL/resource being paid for */
  resourceUrl?: string;
}

/** Proof of a settled payment (ledger receipt), sent back to the server */
export interface PaymentProof {
  /** Ledger receipt id (or Plasma tx hash when settled on-chain) */
  proofId: string;
  /** Tamper-evident chain hash of the ledger row */
  hash: string;
  from: string;
  to: string;
  /** Amount transferred (micro-USDT) */
  amount: string;
  token: string;
  chain: number;
  /** Unix seconds */
  timestamp: number;
}

/** Configuration for the LedgerPaymentClient */
export interface PaymentConfig {
  /** Ledger account that pays (e.g. "orchestrator", "agent:clinician") */
  accountId: string;
  /** Safety limit: reject auto-payments above this amount (micro-USDT) */
  maxAutoPayAmount?: string;
  /** Callback fired after each successful payment */
  onPayment?: (proof: PaymentProof) => void;
}

/** Result of payment verification */
export interface VerificationResult {
  valid: boolean;
  proof: PaymentProof | null;
  error?: string;
}

/** Options for the paymentRequired middleware */
export interface PaymentMiddlewareOptions {
  /** Recipient ledger account */
  payTo: string;
  /** Fixed amount or function that computes amount per request (micro-USDT) */
  amount: string | ((req: any) => string);
  token?: string;
  chain?: number;
  /** Custom verification function (overrides the default ledger check) */
  verifyPayment?: (proof: string, req: any) => Promise<boolean>;
  description?: string | ((req: any) => string);
  facilitator?: string;
  network?: string;
}
