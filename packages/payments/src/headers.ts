// Parse / create the X-Payment-* headers used in 402 responses.

import type { PaymentRequired } from './types.ts';
import {
  HEADERS,
  USDT_TOKEN,
  PLASMA_TESTNET_CHAIN_ID,
  NETWORK_NAME,
} from './constants.ts';

/** Parse X-Payment-* headers from a 402 response. */
export function parsePaymentHeaders(headers: Headers): PaymentRequired | null {
  const required = headers.get(HEADERS.REQUIRED);
  if (!required || required.toLowerCase() !== 'true') {
    return null;
  }

  const payTo = headers.get(HEADERS.TO);
  const amount = headers.get(HEADERS.AMOUNT);

  if (!payTo || !amount) {
    return null;
  }

  const result: PaymentRequired = {
    payTo,
    amount,
    token: headers.get(HEADERS.TOKEN) || USDT_TOKEN,
    chain: parseInt(
      headers.get(HEADERS.CHAIN) || String(PLASMA_TESTNET_CHAIN_ID),
      10,
    ),
  };

  const network = headers.get(HEADERS.NETWORK);
  if (network) result.network = network;

  const description = headers.get(HEADERS.DESCRIPTION);
  if (description) result.description = description;

  const facilitator = headers.get(HEADERS.FACILITATOR);
  if (facilitator) result.facilitator = facilitator;

  const resourceUrl = headers.get(HEADERS.RESOURCE_URL);
  if (resourceUrl) result.resourceUrl = resourceUrl;

  const maxAmount = headers.get(HEADERS.MAX_AMOUNT);
  if (maxAmount) result.maxAmount = maxAmount;

  return result;
}

/** HTTP header values must be Latin-1 — strip anything outside printable ASCII. */
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '-');
}

/** Create X-Payment-* headers for a server 402 response. */
export function createPaymentHeaders(
  req: PaymentRequired,
): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADERS.REQUIRED]: 'true',
    [HEADERS.TO]: req.payTo,
    [HEADERS.AMOUNT]: req.amount,
    [HEADERS.TOKEN]: req.token || USDT_TOKEN,
    [HEADERS.CHAIN]: String(req.chain || PLASMA_TESTNET_CHAIN_ID),
  };

  headers[HEADERS.NETWORK] = req.network || NETWORK_NAME;

  if (req.description) headers[HEADERS.DESCRIPTION] = headerSafe(req.description);
  if (req.facilitator) headers[HEADERS.FACILITATOR] = req.facilitator;
  if (req.resourceUrl) headers[HEADERS.RESOURCE_URL] = headerSafe(req.resourceUrl);
  if (req.maxAmount) headers[HEADERS.MAX_AMOUNT] = req.maxAmount;

  return headers;
}
