// Workflow budget escrow: hold the user's budget when a workflow starts,
// refund whatever wasn't spent when it settles. Step payments themselves
// go through the 402 paywall.

import { hold, consumeHold, releaseHold, formatUSDT } from '@careswarm/payments';
import { eventBus } from './event-bus.ts';

export interface EscrowRecord {
  holdId: string;
  workflowId: string;
  amountMicro: number;
  status: 'held' | 'settled' | 'refunded';
}

export class LedgerEscrow {
  /** Lock the workflow budget from the user's account. */
  lockBudget(workflowId: string, userAccount: string, amountMicro: number): EscrowRecord {
    const holdId = hold(userAccount, amountMicro, `workflow:${workflowId}`);
    eventBus.emitEvent({
      type: 'payment:required',
      data: {
        workflowId,
        amount: amountMicro,
        display: `${formatUSDT(amountMicro)} USDT held in escrow`,
      },
    });
    return { holdId, workflowId, amountMicro, status: 'held' };
  }

  /** Settle: consume the hold, refunding any unspent budget. */
  settle(escrow: EscrowRecord, spentMicro: number): void {
    const refund = Math.max(0, escrow.amountMicro - spentMicro);
    consumeHold(escrow.holdId, refund);
    escrow.status = 'settled';
  }

  /** Refund the full hold (workflow failed before any spending). */
  refund(escrow: EscrowRecord): void {
    releaseHold(escrow.holdId);
    escrow.status = 'refunded';
  }
}
