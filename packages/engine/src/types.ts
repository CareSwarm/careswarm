// Shared engine types.

export type ModelKey =
  | 'orchestrator'   // Qwen3-1.7B instruct (built-in) — planning + tool calling
  | 'medpsy_1_7b'    // MedPsy-1.7B Q4_K_M — fast medical SLM (triage, scribe, translator)
  | 'medpsy_4b'      // MedPsy-4B-Thinking Q4_K_M — deep clinical reasoning
  | 'embeddings'     // GTE embeddings for RAG
  | 'smolvla';       // SmolVLA-LIBERO — robot policy (VLA)

export interface ModelSpec {
  /** QVAC modelSrc: built-in constant or absolute path to a local GGUF */
  src: string;
  modelType: 'llm' | 'embeddings' | 'vla';
  /** Estimated resident RAM, used by the ModelManager budget */
  ramGB: number;
  ctxSize?: number;
  sampling?: { temperature?: number; top_k?: number; top_p?: number };
  /** Model emits <think> blocks (Qwen3-Thinking family) */
  thinking?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A tool the model may call. JSON-schema-ish; exact wire format adapted in completion.ts */
export interface ToolDef {
  name: string;
  description: string;
  /** Zod schema — validated on our side regardless of what the model emits */
  schema: import('zod').ZodTypeAny;
  /** Optional executor; when present the tool call is invoked and the result returned */
  execute?: (args: unknown) => Promise<unknown>;
}

export interface CompletionMeta {
  agentId?: string;
  jobId?: string;
  workflowId?: string;
}

export interface CompletionStats {
  ttftMs: number;
  tokensPerSecond: number;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  stopReason: string;
}

export interface ParsedToolCall {
  name: string;
  arguments: unknown;
}

export interface CompleteResult {
  contentText: string;
  thinkingText: string;
  toolCalls: ParsedToolCall[];
  stats: CompletionStats;
}

export interface CompleteOptions {
  modelKey: ModelKey;
  history: ChatMessage[];
  system?: string;
  tools?: ToolDef[];
  captureThinking?: boolean;
  maxTokens?: number;
  meta?: CompletionMeta;
  /** Streaming callbacks (wired to SSE by callers) */
  onDelta?: (text: string) => void;
  onThinking?: (text: string) => void;
  /** Receipt id of the 402 payment that funded this inference (for the audit log) */
  paymentReceipt?: string;
}

// ── Audit log events (hackathon artifact schema) ─────────────
export interface ModelLoadEvent {
  ts: string;
  event: 'model_load';
  modelKey: ModelKey;
  modelId: string;
  source: string; // 'local' | 'delegated:<pubkey8>'
  ramEstGB: number;
  loadMs: number;
  process: string;
}

export interface ModelUnloadEvent {
  ts: string;
  event: 'model_unload';
  modelKey: ModelKey;
  reason: 'lru_evict' | 'idle_ttl' | 'shutdown' | 'manual';
  process: string;
}

export interface InferenceEvent {
  ts: string;
  event: 'inference';
  id: string;
  modelKey: ModelKey;
  agentId?: string;
  jobId?: string;
  workflowId?: string;
  delegated: boolean;
  prompt: string;
  promptTokens: number;
  completionTokens: number;
  ttftMs: number;
  tokensPerSecond: number;
  durationMs: number;
  stopReason: string;
  toolCallNames: string[];
  paymentReceipt?: string;
  process: string;
}

export type AuditEvent = ModelLoadEvent | ModelUnloadEvent | InferenceEvent;

/** Engine → event-bus bridge: services subscribe to surface SSE events */
export type EngineEventListener = (event: AuditEvent) => void;
