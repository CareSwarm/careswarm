// Executes plan steps sequentially: hold budget -> run each agent (paid via
// 402) -> settle. Steps with failed dependencies are skipped. Every state
// change is emitted to the event bus for the live feed.

import type { ParsedPlan } from './intent-parser.ts';
import { AgentRouter, AgentExecutionResult } from './agent-router.ts';
import { LedgerEscrow, EscrowRecord } from './ledger-escrow.ts';
import { eventBus } from './event-bus.ts';

// ── Types ────────────────────────────────────────────────────

export type WorkflowStatus = 'created' | 'running' | 'completed' | 'failed' | 'settled';

export interface WorkflowStep {
  stepId: number;
  agentId: string;
  instruction: string;
  dependsOn: number[];
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  result?: AgentExecutionResult;
}

export interface Workflow {
  id: string;
  plan: ParsedPlan;
  prompt: string;
  callerAccount: string;
  steps: WorkflowStep[];
  status: WorkflowStatus;
  createdAt: number;
  completedAt?: number;
  /** micro-USDT */
  totalCost: number;
  spentMicro: number;
  escrow?: EscrowRecord;
  results: AgentExecutionResult[];
}

// ── Workflow Engine Class ────────────────────────────────────

export class WorkflowEngine {
  private workflows: Map<string, Workflow> = new Map();
  private router: AgentRouter;
  private escrow: LedgerEscrow;

  constructor(router: AgentRouter, escrow: LedgerEscrow) {
    this.router = router;
    this.escrow = escrow;
  }

  /** Create a workflow from a parsed plan. */
  async createWorkflow(plan: ParsedPlan, prompt: string, callerAccount: string): Promise<Workflow> {
    await this.router.refreshAgents();
    const workflowId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const steps: WorkflowStep[] = plan.steps.map((s, i) => ({
      stepId: i,
      agentId: s.agent,
      instruction: s.instruction,
      dependsOn: s.dependsOn,
      status: 'pending',
    }));

    const workflow: Workflow = {
      id: workflowId,
      plan,
      prompt,
      callerAccount,
      steps,
      status: 'created',
      createdAt: Date.now(),
      totalCost: this.router.calculateCost(steps.map((s) => s.agentId)),
      spentMicro: 0,
      results: [],
    };

    this.workflows.set(workflowId, workflow);
    eventBus.emitEvent({
      type: 'workflow:created',
      data: {
        workflowId,
        summary: plan.summary,
        stepCount: steps.length,
        agents: steps.map((s) => s.agentId),
        urgency: plan.urgency,
        parser: plan.parser,
        estimatedCost: workflow.totalCost,
      },
    });
    console.log(`[workflow] Created ${workflowId} with ${steps.length} steps (${plan.parser})`);
    return workflow;
  }

  /** Execute a workflow end-to-end (sequential, dependency-aware context). */
  async executeWorkflow(workflowId: string): Promise<Workflow> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow '${workflowId}' not found`);

    workflow.status = 'running';

    // ESCROW: hold the estimated budget (+25% headroom) from the caller
    try {
      const budget = Math.ceil(workflow.totalCost * 1.25);
      if (budget > 0) {
        workflow.escrow = this.escrow.lockBudget(workflowId, workflow.callerAccount, budget);
      }
    } catch (err: any) {
      console.warn(`[workflow] Budget hold failed (continuing unescrowed): ${err.message}`);
    }

    for (const step of workflow.steps) {
      // Skip steps whose dependencies failed/skipped
      const depsOk = step.dependsOn.every(
        (d) => workflow.steps[d]?.status === 'completed',
      );
      if (!depsOk) {
        step.status = 'skipped';
        eventBus.emitEvent({
          type: 'workflow:step_completed',
          data: { workflowId, stepIndex: step.stepId, agentId: step.agentId, status: 'skipped' },
        });
        continue;
      }

      step.status = 'running';
      eventBus.emitEvent({
        type: 'workflow:step_started',
        data: { workflowId, stepIndex: step.stepId, agentId: step.agentId, instruction: step.instruction },
      });

      const result = await this.router.executeAgent(
        step.agentId,
        step.instruction,
        this.buildPayload(step, workflow),
        workflowId,
      );

      step.result = result;
      workflow.results.push(result);
      if (result.paymentReceipt) {
        const manifest = this.router.getManifest(step.agentId);
        workflow.spentMicro += manifest?.price ?? 0;
      }

      if (result.status === 'success') {
        step.status = 'completed';
      } else {
        step.status = 'failed';
        workflow.status = 'failed';
      }
      eventBus.emitEvent({
        type: 'workflow:step_completed',
        data: {
          workflowId,
          stepIndex: step.stepId,
          agentId: step.agentId,
          status: step.status,
          receiptId: result.paymentReceipt,
          executionTimeMs: result.executionTimeMs,
        },
      });
      if (workflow.status === 'failed') break;
    }

    // SETTLE
    if (workflow.status !== 'failed') {
      workflow.status = 'completed';
      workflow.completedAt = Date.now();
      if (workflow.escrow) this.escrow.settle(workflow.escrow, workflow.spentMicro);
      workflow.status = 'settled';
      eventBus.emitEvent({
        type: 'workflow:completed',
        data: { workflowId, spent: workflow.spentMicro, durationMs: workflow.completedAt - workflow.createdAt },
      });
    } else {
      if (workflow.escrow) this.escrow.settle(workflow.escrow, workflow.spentMicro);
      eventBus.emitEvent({
        type: 'workflow:failed',
        data: { workflowId, spent: workflow.spentMicro },
      });
    }

    console.log(`[workflow] ${workflowId} finished: ${workflow.status}`);
    return workflow;
  }

  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  listWorkflows(): Workflow[] {
    return [...this.workflows.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Private helpers ────────────────────────────────────────

  /** Pass dependency step outputs (and the original prompt) to the agent. */
  private buildPayload(step: WorkflowStep, workflow: Workflow): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    for (const d of step.dependsOn) {
      const dep = workflow.steps[d];
      if (dep?.result?.result !== undefined) {
        context[`step${d}_${dep.agentId}`] = dep.result.result;
      }
    }
    return {
      userPrompt: workflow.prompt,
      language: workflow.plan.language,
      translateTo: workflow.plan.translateTo,
      urgency: workflow.plan.urgency,
      context,
    };
  }
}
