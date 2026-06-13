// Prompt -> workflow plan, on a 1.7B model.
//
// The plan schema is nested (array of step objects), which is beyond the
// flat tool-call wire format — so the planner uses grammar-constrained JSON
// (responseFormat json_schema) instead of tool calling, with a keyword
// fallback so parsing can never hard-fail. Native tool calling is used where
// it fits: the clinician's flat search_guidelines tool.
// A regex emergency pre-check runs before any LLM.

import { z } from 'zod';
import { completeJSON } from '@careswarm/engine';

// ── Types ────────────────────────────────────────────────────

export const AGENT_IDS = ['triage', 'librarian', 'clinician', 'scribe', 'translator', 'robot-pilot'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface PlanStep {
  agent: AgentId;
  instruction: string;
  dependsOn: number[];
}

export interface ParsedPlan {
  urgency: 'emergency' | 'urgent' | 'routine';
  language: string;
  translateTo: string | null;
  steps: PlanStep[];
  summary: string;
  confidence: number;
  parser: 'tool_call' | 'json_schema' | 'keyword' | 'emergency_precheck';
  emergencyBanner?: string;
}

// ── Agent capability map (system prompt) ─────────────────────

const AGENT_CAPABILITIES: Record<AgentId, string> = {
  triage: 'fast symptom triage and urgency classification (MedPsy-1.7B)',
  librarian: 'retrieves relevant passages from the local medical guidelines corpus (RAG, citations)',
  clinician: 'deep clinical reasoning over symptoms + guideline context (MedPsy-4B thinking model). Can call the librarian itself when it needs sources',
  scribe: 'writes the final patient-friendly summary and care plan with safety disclaimer',
  translator: 'translates the final summary into the user\'s language (e.g. Vietnamese)',
  'robot-pilot': 'executes physical fetch/place instructions on the care robot (SmolVLA policy). Only for explicit physical tasks like "fetch the pill bottle"',
};

const SYSTEM_PROMPT = `You are the CareSwarm orchestrator on a local-first medical assistant. Plan which specialist agents to hire for the user's request. Output ONLY the JSON plan object. Never answer the user directly.

Available agents:
${Object.entries(AGENT_CAPABILITIES).map(([id, cap]) => `- ${id}: ${cap}`).join('\n')}

Rules:
- Health questions: triage -> librarian -> clinician -> scribe, in that order. Add translator last if the user's language is not English.
- Simple factual lookups: librarian -> scribe.
- Physical tasks ("fetch...", "bring me...") use robot-pilot, then scribe.
- dependsOn lists earlier step indices (0-based) whose output the step needs.
- language = ISO code of the user's message ("en", "vi"...). translateTo = language for the final answer, or null. /no_think`;

// ── Zod schemas ──────────────────────────────────────────────

const planStepSchema = z.object({
  agent: z.enum(AGENT_IDS),
  instruction: z.string().min(3),
  dependsOn: z.array(z.number().int().min(0)).default([]),
});

const createPlanSchema = z.object({
  urgency: z.enum(['emergency', 'urgent', 'routine']),
  language: z.string().min(2).max(8),
  translateTo: z.string().min(2).max(8).nullable(),
  steps: z.array(planStepSchema).min(1).max(6),
  summary: z.string().min(3),
});

/** JSON-schema mirror of createPlanSchema for grammar-constrained output */
const CREATE_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    urgency: { type: 'string', enum: ['emergency', 'urgent', 'routine'] },
    language: { type: 'string' },
    translateTo: { type: ['string', 'null'] },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: [...AGENT_IDS] },
          instruction: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'integer' } },
        },
        required: ['agent', 'instruction'],
      },
      minItems: 1,
      maxItems: 6,
    },
    summary: { type: 'string' },
  },
  required: ['urgency', 'language', 'translateTo', 'steps', 'summary'],
};

// ── Tier 0: deterministic emergency pre-check ────────────────

const EMERGENCY_PATTERNS: RegExp[] = [
  /chest pain.*(collapse|faint|unconscious|sweat|jaw|left arm)/i,
  /(can'?t|cannot|difficulty|khó)\s*(breathe|breathing|thở)/i,
  /(unconscious|unresponsive|bất tỉnh|ngất xỉu)/i,
  /(stroke|đột quỵ|méo miệng|liệt nửa người)/i,
  /(severe bleeding|chảy máu (nhiều|ồ ạt))/i,
  /(suicide|tự tử|tự sát|muốn chết)/i,
  /(seizure|co giật)/i,
  /(anaphylaxis|sốc phản vệ|swollen (throat|tongue))/i,
];

export function emergencyPrecheck(prompt: string): string | null {
  for (const re of EMERGENCY_PATTERNS) {
    if (re.test(prompt)) {
      return 'Possible emergency detected. If this is happening right now, call your local emergency number immediately (115 in Vietnam, 911 in the US). The agents below provide general information only.';
    }
  }
  return null;
}

// ── Intent Parser ────────────────────────────────────────────

export class IntentParser {
  async parse(prompt: string, meta?: { jobId?: string }): Promise<ParsedPlan> {
    const emergencyBanner = emergencyPrecheck(prompt) ?? undefined;

    // Tier 1: grammar-constrained JSON (llama.cpp grammar guarantees shape)
    try {
      const plan = await completeJSON(
        'orchestrator',
        SYSTEM_PROMPT,
        `Plan the workflow for this request:\n\n"${prompt}"`,
        createPlanSchema,
        CREATE_PLAN_JSON_SCHEMA,
        { agentId: 'orchestrator', ...meta },
      );
      return {
        ...this.normalize(plan),
        confidence: 0.85,
        parser: 'json_schema',
        emergencyBanner,
      };
    } catch (err) {
      console.warn('[intent] planner failed, using keyword fallback:', err);
    }

    // Tier 2: keyword fallback — the demo can never hard-fail on parsing
    return { ...this.fallbackParse(prompt), emergencyBanner };
  }

  /** Clamp dependsOn + make sure a requested translation actually happens. */
  private normalize(plan: z.infer<typeof createPlanSchema>): Omit<ParsedPlan, 'confidence' | 'parser'> {
    const steps = plan.steps.map((s, i) => ({
      ...s,
      dependsOn: (s.dependsOn ?? []).filter((d) => d >= 0 && d < i),
    }));
    const translateTo = plan.translateTo?.toLowerCase() ?? null;
    // Small models sometimes set translateTo but forget the translator step
    if (translateTo && translateTo !== 'en' && !steps.some((s) => s.agent === 'translator')) {
      steps.push({
        agent: 'translator',
        instruction: `Translate the final summary into ${translateTo}.`,
        dependsOn: [steps.length - 1],
      });
    }
    return {
      urgency: plan.urgency,
      language: plan.language.toLowerCase(),
      translateTo,
      steps,
      summary: plan.summary,
    };
  }

  /** Simple keyword matching — the demo can never hard-fail on parsing. */
  private fallbackParse(prompt: string): ParsedPlan {
    const lower = prompt.toLowerCase();
    const viet = /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/i.test(prompt);
    const language = viet ? 'vi' : 'en';

    const physical = /(fetch|pick up|bring|grab|lấy|mang|đưa)/i.test(lower);
    if (physical) {
      return {
        urgency: 'routine',
        language,
        translateTo: viet ? 'vi' : null,
        steps: [
          { agent: 'robot-pilot', instruction: prompt, dependsOn: [] },
          { agent: 'scribe', instruction: 'Confirm what the robot did in one short paragraph.', dependsOn: [0] },
        ],
        summary: `Physical task: ${prompt.slice(0, 80)}`,
        confidence: 0.5,
        parser: 'keyword',
      };
    }

    const steps: PlanStep[] = [
      { agent: 'triage', instruction: `Triage these symptoms: ${prompt}`, dependsOn: [] },
      { agent: 'librarian', instruction: `Find guideline passages relevant to: ${prompt}`, dependsOn: [0] },
      { agent: 'clinician', instruction: `Analyze the case using the triage result and guideline context: ${prompt}`, dependsOn: [0, 1] },
      { agent: 'scribe', instruction: 'Write the final patient-friendly summary and care plan.', dependsOn: [2] },
    ];
    if (viet) {
      steps.push({ agent: 'translator', instruction: 'Translate the final summary into Vietnamese.', dependsOn: [3] });
    }
    const urgent = /(severe|intense|worst|dữ dội|nặng)/i.test(lower);
    return {
      urgency: urgent ? 'urgent' : 'routine',
      language,
      translateTo: viet ? 'vi' : null,
      steps,
      summary: `Health question: ${prompt.slice(0, 80)}`,
      confidence: 0.5,
      parser: 'keyword',
    };
  }
}
