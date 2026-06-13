# Prior Work Disclosure

Per the hackathon rules, this documents everything that predates the hackathon and exactly what was reused.

## Prior project

CareSwarm reuses selected infrastructure code from **agt.finance** (Agentic Finance Protocol), a pre-existing project by the same author: an agent-to-agent payment protocol with on-chain settlement, cloud-LLM orchestration (Anthropic/OpenAI APIs), and a ZK trust layer.

For this hackathon we kept the *plumbing* that had nothing to do with AI (payment headers, event bus, SSE transport) and **rewrote the entire AI layer on the QVAC SDK** — which is the point of the event. The original project used cloud LLM APIs for everything; CareSwarm uses none.

## What was built during the hackathon (June 13–21, 2026)

- `packages/engine` — entire QVAC integration: model lifecycle on a RAM budget, completion with tool calling + grammar-constrained JSON, TTFT/TPS audit logging, RAG wrappers. **New.**
- `services/orchestrator/src/intent-parser.ts` — 3-tier on-device planner (tool call → json_schema → keyword). **Rewritten from scratch** (original was a single Anthropic API call).
- `services/agents/src/agents/*` — all seven specialist agents (triage, librarian, clinician with paid A2A tool calls, scribe, translator, robot-pilot, voice). **New** (original repo had 32 blockchain-operation agents; none were ported).
- `services/provider` — P2P delegated-inference provider with paid sessions. **New.**
- `packages/payments/src/ledger.ts` — tamper-evident local USDT ledger. **New.**
- `apps/dashboard` — all four pages and components. **New** (one hook ported, see below).
- `corpus/`, `scripts/`, all docs and artifacts. **New.**

## Ported / adapted from agt.finance

| Source (agt.finance) | Here | What changed |
|---|---|---|
| `packages/http-402/src/headers.ts` | `packages/payments/src/headers.ts` | near-verbatim; constants now Plasma/USDT |
| `packages/http-402/src/middleware.ts` | `packages/payments/src/middleware.ts` | structure kept; default verify now checks the local ledger instead of on-chain ERC20 |
| `packages/http-402/src/client.ts` | `packages/payments/src/client.ts` | fetch/safety-cap flow kept; ethers wallet → ledger account |
| `services/ai-brain/src/event-bus.ts` | `services/orchestrator/src/event-bus.ts` | structure kept; event vocabulary rewritten for local AI |
| `services/ai-brain/src/sse-server.ts` | `services/orchestrator/src/sse-server.ts` | near-verbatim |
| `services/ai-brain/src/state-tracker.ts` | `services/orchestrator/src/state-tracker.ts` | near-verbatim |
| `services/ai-brain/src/agent-router.ts` | `services/orchestrator/src/agent-router.ts` | manifest cache kept; axios → auto-paying 402 client |
| `services/ai-brain/src/workflow-engine.ts` | `services/orchestrator/src/workflow-engine.ts` | state machine kept; steps now come from the QVAC planner; escrow → ledger holds |
| `services/agents/src/index.ts` (route shape) | `services/agents/src/index.ts` | registry/route pattern kept; 32 agents dropped, 402 paywall added |
| `services/agents/src/types.ts` | `services/agents/src/types.ts` | near-verbatim |
| `apps/dashboard/app/hooks/useSSE.ts` | same path | reconnect logic kept; retyped |

## Explicitly NOT ported

ZK circuits (415MB), 22 smart contracts and the Tempo L1 integration, the MCP server, the APS-1 implementation, the Python auth service, the payroll/streams/shield dashboard, and all 32 on-chain agents.

## Models and data

- MedPsy-1.7B / MedPsy-4B: QVAC's published models (Apache 2.0), unmodified GGUF Q4_K_M.
- Qwen3-1.7B-Instruct, EmbeddingGemma-300M, SmolVLA-LIBERO: QVAC built-in registry models.
- `corpus/*.md`: educational guideline summaries written for this project during the hackathon (general medical knowledge, WHO/CDC-style guidance, no copied text).
