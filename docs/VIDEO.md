# Demo video shot list (≤ 5:00)

Record on the M1 Air with Activity Monitor (Memory tab) visible in a corner — the 8GB constraint is part of the story. Upload to YouTube as **unlisted**.

## 0:00–0:30 — Hook
- Show the laptop + Activity Monitor: "8GB MacBook Air, no GPU box, no cloud."
- One line: "CareSwarm — a swarm of medical AI agents that plan, reason, cite guidelines and answer in your language, entirely on-device with QVAC. Every agent job is a USDT micropayment."
- Terminal: `grep -ri "openai\|anthropic" package.json packages services` → nothing. "Zero cloud AI."

## 0:30–2:30 — Flagship workflow (the core)
- Browser at localhost:3000. Type the prompt:
  > My father is 62 and gets chest tightness when he climbs stairs; it eases when he rests. What should we do?
- Narrate as the right-hand **live feed** lights up:
  - orchestrator (Qwen3-1.7B) emits the plan → step cards appear: triage → librarian → clinician → scribe → translator.
  - Each step shows a **💸 payment receipt** (0.02 / 0.01 / 0.10 …) — point at it: "that's a real 402 micropayment on the local USDT ledger."
  - Watch **model load/unload** events in the feed: "8GB can't hold every model, so the ModelManager evicts LRU and reloads — this churn is the feature."
- Open the **clinician thinking** accordion: the reasoning is visible. Point at the `search_guidelines` line: "the clinician hired the librarian *mid-reasoning* over a paid agent-to-agent call."
- Final care note appears with the safety disclaimer.
- Multilingual beat (~15s): rerun with a Spanish prompt ("Mi padre tiene dolor en el pecho al subir escaleras…") — the translator agent renders the note in Spanish. "Ask in any language, it answers in yours."

## 2:30–3:15 — Metrics + audit
- `/metrics` page: TTFT and tok/s charts. "Every inference is logged."
- Editor: show `logs/sample-run.jsonl` — point at one inference line (prompt, tokens, ttftMs, tokensPerSecond, paymentReceipt).
- Quick terminal: `curl -s -X POST localhost:3001/agents/triage/execute` → **402** with X-Payment headers. "No payment, no inference."

## 3:15–4:00 — Robot-pilot (from advice to action)
- Type: "Robot, fetch the medicine box from the table and place it in the basket."
- Show the **SmolVLA trajectory panel** animating + per-chunk latency. "Same swarm, same laptop — now a vision-language-action policy producing robot action chunks on-device."

## 4:00–4:40 — Agent economy + Plasma
- `/economy` page: ledger balances + the sha256 receipt chain (chain VALID badge).
- Click **Settle on Plasma testnet** → show the tx, then open the explorer:
  https://testnet.plasmascan.to/tx/0x7a07094778177363dda884995a626cba40f1be1cbeecd9b828ac45a3dc00afb0
  "Session balances net to one transaction on Tether's own stablecoin chain."
- (P2P, optional / if 2nd device ready) two terminals: provider prints its DHT key, consumer buys a session (402) and the clinician runs **delegated** — weights stay on the provider; kill it → `fallbackToLocal` finishes the job.

## 4:40–5:00 — Close
- Architecture one-liner + the criteria it hits: multi-agent orchestration, native tool calling, paid A2A, P2P delegation, MedPsy 1.7B + 4B, on-device perf on 8GB.
- Disclaimer on screen: "Not a medical device — guideline navigator, demo data only."

## Pre-record checklist
- `./scripts/demo.sh` running (agents + orchestrator + dashboard), models warm (run the prompt once before recording so loads are cached).
- Activity Monitor visible; close other apps (8GB).
- If showing P2P: start the provider 2+ minutes early (DHT cold-start 15–45s).
- `#hashtag` for the Build-in-Public bonus in the description; tag @QVAC.
