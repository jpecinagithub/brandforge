/**
 * planRun — one LLM call (JSON mode) turning a goal into an AgentPlan.
 *
 * The model receives the tool catalog (name, description, category, JSON
 * schema of args) and must return ONLY the plan JSON. The result is
 * validated with AgentPlanSchema, then structurally validated (known tools,
 * valid dependsOn, no cycles, within maxSteps). One retry on failure, then
 * PlannerError — the run fails honestly instead of executing a bad plan.
 */
import { z } from 'zod';
import {
  AgentPlanSchema,
  type AgentPlan,
  type PlanStep,
} from '@brandforge/shared';
import type {
  ModelRouter,
  OpenRouterClient,
  ORChatMessage,
  ChatResult,
} from './types.js';
import type { ToolRegistry } from './tools/registry.js';
import { creativeStrategist } from './roles.js';
import { topologicalLevels, PlanGraphError } from './graph.js';

export class PlannerError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PlannerError';
  }
}

export interface PlanRunInput {
  goal: string;
  language: 'en' | 'es';
  brandKitSummary: string;
  projectMemory: Record<string, unknown>;
  maxSteps: number;
  /** Records every provider response, including an invalid response retried by the planner. */
  onUsage?: (result: ChatResult) => Promise<void>;
}

const MAX_PLANNER_TOKENS = 4000;
const PLANNER_TIMEOUT_MS = 120000;

export async function planRun(
  openrouter: OpenRouterClient,
  router: ModelRouter,
  registry: ToolRegistry,
  input: PlanRunInput,
): Promise<AgentPlan> {
  const model = await router.select('plan');
  const hasCurrentCampaign = Boolean(input.projectMemory.campaignBrief);
  const catalog = registry.list().filter((tool) => !(hasCurrentCampaign && tool.name === 'create_campaign')).map((tool) => ({
    name: tool.name,
    description: tool.description,
    category: tool.category,
    args: zodToJsonSchema(tool.schema),
  }));

  const system =
    creativeStrategist.systemPrompt(input.language) +
    '\n\n' +
    (input.language === 'es'
      ? `Formato de salida — devuelve EXACTAMENTE este JSON, sin nada más:
{"steps":[{"id":"s1","tool":"<nombre>","title":"<título breve>","args":{...},"dependsOn":[],"role":"<rol opcional>"}],"estimatedCostUsd":<número opcional>,"notes":"<opcional>"}
Reglas: 1..${input.maxSteps} pasos. Los ids son "s1","s2",... dependsOn solo puede referenciar ids anteriores. Si campaignBrief existe, trabaja siempre sobre esa campaña y reutiliza su campaignId; no crees otra. Si un argumento necesita un ID creado por un paso anterior, usa el id de ese paso como referencia (por ejemplo, {"campaignId":"s1"}) o la forma explícita "{{s1.campaignId}}", y declara la dependencia. El runtime resolverá el valor real: nunca inventes UUIDs. Usa los roles del catálogo cuando encajen.`
      : `Output format — return EXACTLY this JSON, nothing else:
{"steps":[{"id":"s1","tool":"<name>","title":"<short title>","args":{...},"dependsOn":[],"role":"<optional role>"}],"estimatedCostUsd":<optional number>,"notes":"<optional>"}
Rules: 1..${input.maxSteps} steps. Ids are "s1","s2",... dependsOn may only reference earlier ids. If campaignBrief exists, always work on that campaign and reuse its campaignId; do not create another one. When an argument needs an ID created by an earlier step, use that step id as a reference (for example, {"campaignId":"s1"}) or the explicit form "{{s1.campaignId}}", and declare the dependency. The runtime resolves the real value: never invent UUIDs. Use catalog roles when they fit.`);

  const userPayload = {
    goal: input.goal,
    brandKit: input.brandKitSummary || null,
    projectMemory: input.projectMemory,
    maxSteps: input.maxSteps,
    toolCatalog: catalog,
  };

  const messages: ORChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(userPayload) },
  ];

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await openrouter.chat({
        model,
        messages,
        maxTokens: MAX_PLANNER_TOKENS,
        temperature: 0.2,
        jsonMode: true,
        timeoutMs: PLANNER_TIMEOUT_MS,
      });
      await input.onUsage?.(result);
      return validatePlan(result.content, registry, input.maxSteps);
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      messages.push({
        role: 'user',
        content:
          input.language === 'es'
            ? `Tu plan anterior era inválido: ${detail}. Devuelve SOLO un JSON de plan corregido.`
            : `Your previous plan was invalid: ${detail}. Return ONLY a corrected JSON plan.`,
      });
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new PlannerError(
    `Planning failed after 2 attempts: ${detail}`,
    lastError,
  );
}

function validatePlan(
  content: string,
  registry: ToolRegistry,
  maxSteps: number,
): AgentPlan {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(content));
  } catch {
    throw new PlannerError('Planner did not return valid JSON');
  }
  let plan: AgentPlan;
  try {
    plan = AgentPlanSchema.parse(json);
  } catch (err) {
    const detail =
      err instanceof z.ZodError
        ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : String(err);
    throw new PlannerError(`Plan schema validation failed: ${detail}`, err);
  }
  if (plan.steps.length > maxSteps) {
    throw new PlannerError(
      `Plan has ${plan.steps.length} steps, but maxSteps is ${maxSteps}`,
    );
  }
  const ids = new Set(plan.steps.map((s) => s.id));
  for (const step of plan.steps) {
    try {
      registry.get(step.tool);
    } catch {
      throw new PlannerError(
        `Step '${step.id}' uses unknown tool '${step.tool}'`,
      );
    }
    for (const dep of step.dependsOn) {
      if (!ids.has(dep)) {
        throw new PlannerError(
          `Step '${step.id}' depends on unknown step '${dep}'`,
        );
      }
    }
  }
  try {
    topologicalLevels(plan.steps);
  } catch (err) {
    if (err instanceof PlanGraphError) {
      throw new PlannerError(`Invalid step graph: ${err.message}`, err);
    }
    throw err;
  }
  return plan;
}

/** Strips markdown fences and extracts the JSON object payload. */
function extractJson(content: string): string {
  const withoutFences = content
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new PlannerError('Planner did not return valid JSON');
  }
  return withoutFences.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Minimal Zod → JSON Schema summary (dependency-free; enough for the planner
// prompt — it documents shapes, it does not validate).
// ---------------------------------------------------------------------------
export function zodToJsonSchema(schema: z.ZodTypeAny): unknown {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  const described = withDescription(schema, {});
  switch (def.typeName) {
    case 'ZodString':
      return withDescription(schema, { type: 'string' });
    case 'ZodNumber':
      return withDescription(schema, { type: 'number' });
    case 'ZodBoolean':
      return withDescription(schema, { type: 'boolean' });
    case 'ZodEnum':
      return withDescription(schema, {
        type: 'string',
        enum: (schema as unknown as { _def: { values: string[] } })._def.values,
      });
    case 'ZodLiteral':
      return withDescription(schema, {
        const: (schema as unknown as { _def: { value: unknown } })._def.value,
      });
    case 'ZodArray': {
      const inner = (schema as unknown as { _def: { type: unknown } })._def.type;
      return withDescription(schema, {
        type: 'array',
        items: zodToJsonSchema(inner as z.ZodTypeAny),
      });
    }
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(field);
        if (!isOptional(field)) required.push(key);
      }
      return withDescription(schema, {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      });
    }
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable': {
      const inner = (schema as unknown as { _def: { innerType: unknown } })._def
        .innerType;
      return zodToJsonSchema(inner as z.ZodTypeAny);
    }
    case 'ZodRecord': {
      const valueType = (schema as unknown as { _def: { valueType: unknown } })
        ._def.valueType;
      return withDescription(schema, {
        type: 'object',
        additionalProperties: zodToJsonSchema(valueType as z.ZodTypeAny),
      });
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (schema as unknown as { _def: { options: unknown[] } })
        ._def.options;
      return withDescription(schema, {
        anyOf: options.map((o) => zodToJsonSchema(o as z.ZodTypeAny)),
      });
    }
    default:
      return described;
  }
}

function withDescription(
  schema: z.ZodTypeAny,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const description = (schema as unknown as { description?: string }).description;
  return description ? { ...base, description } : base;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema as unknown as { _def: { typeName: string } })._def
    .typeName;
  return (
    typeName === 'ZodOptional' ||
    typeName === 'ZodDefault' ||
    typeName === 'ZodNullable'
  );
}

export type { PlanStep };
