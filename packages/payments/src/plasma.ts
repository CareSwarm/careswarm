// Optional on-chain settlement: anchor the ledger's receipt-chain head and
// a balance digest on Plasma testnet (Tether's stablecoin L1) in a single
// transaction. Off by default — the whole demo runs offline without it.
// Needs PLASMA_MODE=on and a faucet-funded key (https://gas.zip/faucet/plasma).

import { JsonRpcProvider, Wallet, hexlify, toUtf8Bytes } from 'ethers';
import { createHash } from 'node:crypto';
import { balances, chainHead, unsettledReceiptIds, markSettledOnPlasma } from './ledger.ts';
import { PLASMA_RPC_URL, PLASMA_TESTNET_CHAIN_ID } from './constants.ts';

export async function settleOnPlasma(): Promise<{
  txHash: string;
  anchoredHead: string;
  receipts: number;
  explorer: string;
}> {
  if (process.env.PLASMA_MODE !== 'on') {
    throw new Error(
      'Plasma settlement is off. Set PLASMA_MODE=on and fund PLASMA_PRIVATE_KEY from https://gas.zip/faucet/plasma (testnet, chain 9746).',
    );
  }
  const pk = process.env.PLASMA_PRIVATE_KEY;
  if (!pk) throw new Error('PLASMA_PRIVATE_KEY not set');

  const head = chainHead();
  const digest = createHash('sha256')
    .update(JSON.stringify({ head, balances: balances() }))
    .digest('hex');

  const provider = new JsonRpcProvider(PLASMA_RPC_URL, PLASMA_TESTNET_CHAIN_ID);
  const wallet = new Wallet(pk, provider);

  // 0-value self-tx carrying the anchor in calldata — cheap and verifiable
  const tx = await wallet.sendTransaction({
    to: wallet.address,
    value: 0n,
    data: hexlify(toUtf8Bytes(`careswarm:${head}:${digest}`)),
  });
  await tx.wait();

  const receipts = unsettledReceiptIds();
  markSettledOnPlasma(receipts, tx.hash);

  return {
    txHash: tx.hash,
    anchoredHead: head,
    receipts: receipts.length,
    explorer: `https://testnet.plasmascan.to/tx/${tx.hash}`,
  };
}
