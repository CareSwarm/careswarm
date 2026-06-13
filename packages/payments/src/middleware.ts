// Express paywall: no valid X-Payment-Proof -> 402 + payment headers;
// valid proof -> verify against the ledger and call next().

import type { PaymentMiddlewareOptions } from './types.ts';
import { createPaymentHeaders } from './headers.ts';
import { verifyReceipt } from './verify.ts';
import { USDT_TOKEN, PLASMA_TESTNET_CHAIN_ID, HEADERS } from './constants.ts';

export function paymentRequired(options: PaymentMiddlewareOptions) {
  const {
    payTo,
    token = USDT_TOKEN,
    chain = PLASMA_TESTNET_CHAIN_ID,
    verifyPayment: customVerify,
    facilitator,
    network,
  } = options;

  return async (req: any, res: any, next: any) => {
    // 1. Check for payment proof header
    const proofId = req.headers[HEADERS.PROOF.toLowerCase()] as
      | string
      | undefined;

    const expectedAmount =
      typeof options.amount === 'function' ? options.amount(req) : options.amount;

    if (proofId) {
      try {
        let isValid: boolean;

        if (customVerify) {
          isValid = await customVerify(proofId, req);
        } else {
          const result = verifyReceipt(proofId, {
            to: payTo,
            amount: expectedAmount,
          });
          isValid = result.valid;
          if (!isValid && result.error) {
            console.warn(`[payments] verification failed: ${result.error}`);
          }
        }

        if (isValid) {
          // Attach proof info to request for downstream use (audit log link)
          req.paymentProof = proofId;
          return next();
        }
      } catch (err) {
        console.warn('[payments] verification error:', err);
      }
    }

    // 2. No (valid) proof → 402 with payment instructions
    const description =
      typeof options.description === 'function'
        ? options.description(req)
        : options.description;

    const headers = createPaymentHeaders({
      payTo,
      amount: expectedAmount,
      token,
      chain,
      network,
      facilitator,
      description,
      resourceUrl: req.originalUrl,
    });

    res.set(headers);
    res.status(402).json({
      error: 'Payment Required',
      payTo,
      amount: expectedAmount,
      token,
      description,
    });
  };
}
