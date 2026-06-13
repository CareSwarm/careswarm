// Forwards engine events from agents/provider processes to the
// orchestrator's SSE bus so the dashboard gets one unified feed.

import { onEngineEvent } from './metrics-logger.ts';
import type { AuditEvent } from './types.ts';

function toBusEvent(e: AuditEvent): { type: string; data: Record<string, unknown> } | null {
  switch (e.event) {
    case 'model_load':
      return {
        type: 'model:loaded',
        data: {
          modelKey: e.modelKey,
          source: e.source,
          loadMs: e.loadMs,
          ramEstGB: e.ramEstGB,
          process: e.process,
        },
      };
    case 'model_unload':
      return {
        type: 'model:unloaded',
        data: { modelKey: e.modelKey, reason: e.reason, process: e.process },
      };
    case 'inference':
      return {
        type: 'inference:completed',
        data: {
          modelKey: e.modelKey,
          agentId: e.agentId,
          jobId: e.jobId,
          workflowId: e.workflowId,
          delegated: e.delegated,
          ttftMs: e.ttftMs,
          tokensPerSecond: e.tokensPerSecond,
          promptTokens: e.promptTokens,
          completionTokens: e.completionTokens,
          receiptId: e.paymentReceipt,
          process: e.process,
        },
      };
    default:
      return null;
  }
}

/** Fire-and-forget relay; if the orchestrator is down the JSONL log still has everything. */
export function relayEngineEvents(
  orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:4000',
): void {
  onEngineEvent((event) => {
    const busEvent = toBusEvent(event);
    if (!busEvent) return;
    fetch(`${orchestratorUrl}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(busEvent),
    }).catch(() => {
      /* orchestrator down — the JSONL log still has everything */
    });
  });
}
