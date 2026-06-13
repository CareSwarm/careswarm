// x402 constants. Default mode settles on the local ledger (offline);
// chain values target Tether's Plasma testnet for optional settlement.

/** Plasma testnet chain ID (Tether's stablecoin L1) */
export const PLASMA_TESTNET_CHAIN_ID = 9746;

/** Plasma testnet RPC endpoint — used ONLY when PLASMA_MODE=on (see APIS.json) */
export const PLASMA_RPC_URL =
  process.env.PLASMA_RPC_URL ?? 'https://testnet-rpc.plasma.to';

/** Symbolic token identifier on the local ledger (6 decimals, micro-units) */
export const USDT_TOKEN = 'USDT';

export const USDT_DECIMALS = 6;

/** Default network name for X-Payment-Network */
export const NETWORK_NAME = 'careswarm-local';

/** X-Payment header names (identical to the agt.finance x402 wire format) */
export const HEADERS = {
  REQUIRED: 'X-Payment-Required',
  TO: 'X-Payment-To',
  AMOUNT: 'X-Payment-Amount',
  TOKEN: 'X-Payment-Token',
  CHAIN: 'X-Payment-Chain',
  NETWORK: 'X-Payment-Network',
  DESCRIPTION: 'X-Payment-Description',
  FACILITATOR: 'X-Payment-Facilitator',
  RESOURCE_URL: 'X-Payment-Resource-Url',
  MAX_AMOUNT: 'X-Payment-Max-Amount',
  PROOF: 'X-Payment-Proof',
} as const;

/** Format micro-units as a human USDT string, e.g. 20000 → "0.02" */
export function formatUSDT(micro: number | string | bigint): string {
  const n = Number(micro) / 10 ** USDT_DECIMALS;
  return n.toFixed(n < 0.01 ? 4 : 2);
}

/** Parse a human USDT amount into micro-units, e.g. 0.02 → 20000 */
export function toMicro(usdt: number): number {
  return Math.round(usdt * 10 ** USDT_DECIMALS);
}
