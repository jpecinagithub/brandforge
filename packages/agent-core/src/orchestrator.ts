/**
 * Orchestrator — drives an agent run from its current state to a terminal
 * state (completed / failed / cancelled) or a parked state (waiting_approval).
 *
 * - The agent_runs table IS the queue (ADR-0006); HTTP handlers only mutate
 *   rows via startRun / cancelRun / resumeRun / approveRun, the worker calls
 *   executeRun(runId).
 * - Every state transition goes through assertTransition (illegal ones throw).
 * - Steps run in topological levels; independent steps in a level run
 *   concurrently (Promise.allSettled). Each step: timeout, 2 retries with
 *   backoff, tool-call idempotency on (stepId, tool, argsHash).
 * - Budget guard: the planner's estimate is checked before running, every
 *   generate-category step is checked before executing, and generate_image
 *   checks again inside the tool. Over budget → waiting_approval, never a
 *   silent spend.
 * - No infinite loops: maxSteps (planner), maxAttempts (resume),
 *   stepTimeoutMs / runTimeoutMs (timeouts).
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  AgentPlanSchema,
  type AgentEventType,
  type AgentPlan,
  type PlanStep,
  type RunState,
} from '@brandforge/shared';
import {
  agentRuns,
  agentSteps,
  agentToolCalls,
  brandKits,
  campaigns,
  projects,
  type AgentRun as AgentRunRow,
  type Db,
} from '@brandforge/database';
import { assertTransition } from './state-machine.js';
import { closeRunningAgentSteps } from './run-lifecycle.js';
import { topologicalLevels } from './graph.js';
import { planRun, PlannerError } from './planner.js';
import { BUDGET_NOT_AFFORDABLE, stableHash } from './tools/helpers.js';
import type {
  AgentTool,
  BudgetPort,
  ConversationPort,
  MemoryStore,
  ModelRouter,
  OpenRouterClient,
  OrchestratorConfig,
  OrchestratorDeps,
  PortFactories,
  StoragePort,
  ToolContext,
  ToolRegistry,
  ToolResult,
  TokenUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export class RunNotFoundError extends OrchestratorError {
  constructor(runId: string) {
    super(`Agent run not found: ${runId}`);
    this.name = 'RunNotFoundError';
  }
}

export class ResumeLimitError extends OrchestratorError {
  constructor(maxAttempts: number) {
    super(`Run exceeded the maximum of ${maxAttempts} attempts`);
    this.name = 'ResumeLimitError';
  }
}

export class StepFailedError extends OrchestratorError {
  constructor(message: string) {
    super(message);
    this.name = 'StepFailedError';
  }
}

/** Internal control-flow signals (never escape executeRun). */
class RunCancelledSignal extends Error {
  constructor() {
    super('Run was cancelled');
    this.name = 'RunCancelledSignal';
  }
}
class BudgetParkedSignal extends Error {
  constructor() {
    super('Run parked in waiting_approval');
    this.name = 'BudgetParkedSignal';
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
type EmitFn = (type: AgentEventType, payload: Record<string, unknown>) => Promise<void>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OrchestratorError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function publicStepFailure(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'No se pudo completar esta comprobación interna. Todo lo creado hasta ahora se ha conservado.'
    : 'This internal check could not be completed. Everything created so far has been preserved.';
}

function publicRunFailure(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'La ejecución se ha detenido de forma segura y se han conservado todos los resultados creados.'
    : 'The run stopped safely and all created results have been preserved.';
}

function publicBudgetPause(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'Este paso está pausado hasta que apruebes el presupuesto solicitado.'
    : 'This step is paused until you approve the requested budget.';
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxSteps: 25,
  stepTimeoutMs: 120000,
  runTimeoutMs: 300000,
  defaultBudgetUsd: 2,
  maxAttempts: 3,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export interface StartRunParams {
  userId: string;
  workspaceId: string;
  projectId: string;
  conversationId?: string;
  input: string;
  idempotencyKey?: string;
  maxSteps?: number;
  budgetUsd?: number;
  language?: 'en' | 'es';
}

interface StepExecutionContext {
  db: Db;
  userId: string;
  workspaceId: string;
  projectId: string;
  runId: string;
  language: 'en' | 'es';
  openrouter: OpenRouterClient;
  router: ModelRouter;
  budget: BudgetPort;
  storage: StoragePort;
  conversation: ConversationPort;
  memory: MemoryStore;
}

export class Orchestrator {
  private readonly db: Db;
  private readonly openrouter: OpenRouterClient;
  private readonly router: ModelRouter;
  private readonly registry: ToolRegistry;
  private readonly config: OrchestratorConfig;
  private readonly ports: PortFactories;
  private readonly emitGlobal: OrchestratorDeps['emitGlobal'];
  private readonly emitters = new Map<string, EmitFn>();

  constructor(deps: OrchestratorDeps) {
    this.db = deps.db;
    this.openrouter = deps.openrouter;
    this.router = deps.router;
    this.registry = deps.registry;
    this.config = deps.config;
    this.ports = deps.ports;
    this.emitGlobal = deps.emitGlobal;
  }

  /** Per-run emitter: persists via the backend port, then broadcasts globally. */
  private emitFor(runId: string): EmitFn {
    let emitter = this.emitters.get(runId);
    if (!emitter) {
      const perRun = this.ports.makeEmit(runId);
      const emitGlobal = this.emitGlobal;
      emitter = async (type, payload) => {
        await perRun(type, payload);
        await emitGlobal(runId, type, payload);
      };
      this.emitters.set(runId, emitter);
    }
    return emitter;
  }

  private async loadRun(runId: string): Promise<AgentRunRow> {
    const [run] = await this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));
    if (!run) throw new RunNotFoundError(runId);
    return run;
  }

  private async transitionTo(
    run: AgentRunRow,
    to: RunState,
    emit: EmitFn,
  ): Promise<AgentRunRow> {
    assertTransition(run.status as RunState, to);
    const now = new Date();
    const patch: Partial<AgentRunRow> = { status: to, updatedAt: now };
    if (to === 'running' && !run.startedAt) patch.startedAt = now;
    if (to === 'completed' || to === 'failed' || to === 'cancelled') {
      patch.finishedAt = now;
    }
    await this.db.update(agentRuns).set(patch).where(eq(agentRuns.id, run.id));
    await emit('run.state', { from: run.status, to });
    return { ...run, ...patch };
  }

  // -----------------------------------------------------------------------
  // startRun — idempotent run creation (HTTP entry point)
  // -----------------------------------------------------------------------
  async startRun(
    p: StartRunParams,
  ): Promise<{ id: string; state: RunState; deduped: boolean }> {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, p.projectId));
    if (!project || project.workspaceId !== p.workspaceId) {
      throw new OrchestratorError('Project not found in this workspace');
    }
    const language = p.language ?? 'en';

    if (p.idempotencyKey) {
      const candidates = await this.db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.idempotencyKey, p.idempotencyKey));
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const projectRows = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.workspaceId, p.workspaceId));
      const workspaceProjectIds = new Set(projectRows.map((r) => r.id));
      const existing = candidates.find(
        (r) =>
          workspaceProjectIds.has(r.projectId) &&
          r.createdAt.getTime() >= cutoff,
      );
      if (existing) {
        return { id: existing.id, state: existing.status as RunState, deduped: true };
      }
    }

    const [row] = await this.db
      .insert(agentRuns)
      .values({
        projectId: p.projectId,
        userId: p.userId,
        conversationId: p.conversationId ?? null,
        input: p.input,
        status: 'pending',
        // Run-scoped metadata co-located in the plan jsonb until planning
        // replaces it with the real plan (no migration needed).
        plan: { language },
        maxSteps: p.maxSteps ?? this.config.maxSteps,
        budgetUsd: p.budgetUsd != null ? String(p.budgetUsd) : null,
        idempotencyKey: p.idempotencyKey ?? null,
      })
      .returning({ id: agentRuns.id });
    return { id: row.id, state: 'pending', deduped: false };
  }

  // -----------------------------------------------------------------------
  // executeRun — worker entry point
  // -----------------------------------------------------------------------
  async executeRun(runId: string): Promise<void> {
    let run = await this.loadRun(runId);
    const status = run.status as RunState;
    if (
      status === 'cancelled' ||
      status === 'completed' ||
      status === 'failed' ||
      status === 'waiting_approval'
    ) {
      return; // terminal or parked: nothing to do
    }
    const emit = this.emitFor(runId);

    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, run.projectId));
    if (!project) {
      await this.failRun(run, emit, 'Project for this run no longer exists', 'en');
      return;
    }
    const workspaceId = project.workspaceId;
    const language: 'en' | 'es' =
      (run.plan as { language?: unknown } | null)?.language === 'es' ? 'es' : 'en';

    if (status === 'pending') {
      run = await this.transitionTo(run, 'planning', emit);
      await emit('run.started', { runId, input: run.input });
    }

    if ((run.status as RunState) === 'planning') {
      run = await this.runPlanning(run, { workspaceId, language, emit });
      if ((run.status as RunState) !== 'running') return; // parked or failed
    }

    await this.runExecution(run, { workspaceId, language, emit });
  }

  // -----------------------------------------------------------------------
  // Planning
  // -----------------------------------------------------------------------
  private async runPlanning(
    run: AgentRunRow,
    ctx: { workspaceId: string; language: 'en' | 'es'; emit: EmitFn },
  ): Promise<AgentRunRow> {
    const { language, emit } = ctx;
    const memory = this.ports.makeMemory();
    const planningBudget = this.ports.makeBudget({ runId: run.id, workspaceId: ctx.workspaceId });

    let projectMemory: Record<string, unknown> = {};
    let brandKitSummary = '';
    try {
      projectMemory = await memory.getProjectMemory(run.projectId);
      const [[kit], [campaign]] = await Promise.all([
        this.db.select().from(brandKits).where(eq(brandKits.projectId, run.projectId)),
        this.db.select().from(campaigns).where(eq(campaigns.projectId, run.projectId)),
      ]);
      if (campaign) {
        const deliverables = Array.isArray(campaign.deliverables) ? campaign.deliverables.join(', ') : '';
        projectMemory = {
          ...projectMemory,
          campaignBrief: {
            campaignId: campaign.id,
            name: campaign.name,
            objective: campaign.objective,
            brief: campaign.brief,
            audience: campaign.audience,
            deliverables,
          },
        };
      }
      if (kit) {
        brandKitSummary =
          `Brand: ${kit.brandName}. Tagline: ${kit.tagline}. Tone: ${kit.tone}. Audience: ${kit.audience}.`.slice(0, 500);
      }
    } catch {
      // Planning proceeds without memory rather than failing the run.
    }

    let plan: AgentPlan;
    let planningCost = 0;
    try {
      plan = await withTimeout(
        planRun(this.openrouter, this.router, this.registry, {
          goal: run.input,
          language,
          brandKitSummary,
          projectMemory,
          maxSteps: run.maxSteps,
          onUsage: async (result) => {
            const costUsd = result.usage.costUsd ?? 0;
            planningCost += costUsd;
            await planningBudget.recordUsage({
              model: result.model,
              tool: 'agent_planner',
              tokensIn: result.usage.tokensIn,
              tokensOut: result.usage.tokensOut,
              costUsd,
              durationMs: result.durationMs,
            });
            await emit('usage', {
              model: result.model,
              tool: 'agent_planner',
              tokensIn: result.usage.tokensIn,
              tokensOut: result.usage.tokensOut,
              costUsd,
            });
          },
        }),
        this.config.runTimeoutMs,
        `Planning timed out after ${this.config.runTimeoutMs}ms`,
      );
    } catch (err) {
      if (planningCost > 0) {
        await this.db
          .update(agentRuns)
          .set({ costUsd: String(Number(run.costUsd ?? 0) + planningCost), updatedAt: new Date() })
          .where(eq(agentRuns.id, run.id));
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.failRun(run, emit, message, language);
      return { ...run, status: 'failed' as RunState };
    }

    const planJson = { ...plan, language };
    const costAfterPlanning = Number(run.costUsd ?? 0) + planningCost;
    await this.db
      .update(agentRuns)
      .set({ plan: planJson, totalSteps: plan.steps.length, costUsd: String(costAfterPlanning), updatedAt: new Date() })
      .where(eq(agentRuns.id, run.id));
    run = { ...run, plan: planJson, totalSteps: plan.steps.length, costUsd: String(costAfterPlanning) };
    await emit('run.plan', {
      totalSteps: plan.steps.length,
      steps: plan.steps.map((step) => ({
        id: step.id,
        title: step.title,
        tool: step.tool,
        dependsOn: step.dependsOn,
      })),
    });

    const budgetUsd =
      run.budgetUsd != null ? Number(run.budgetUsd) : this.config.defaultBudgetUsd;
    const estimated = plan.estimatedCostUsd ?? this.estimatePlanCost(plan);
    if (estimated > budgetUsd) {
      const reason =
        `Estimated cost $${estimated.toFixed(2)} exceeds the approved budget of ` +
        `$${budgetUsd.toFixed(2)}`;
      const parked = await this.transitionTo(run, 'waiting_approval', emit);
      await this.db
        .update(agentRuns)
        .set({
          approval: { reason, requestedBudgetUsd: estimated },
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, run.id));
      await emit('run.waiting_approval', { reason, requestedBudgetUsd: estimated });
      return { ...parked, status: 'waiting_approval' as RunState };
    }

    return this.transitionTo(run, 'running', emit);
  }

  private estimatePlanCost(plan: AgentPlan): number {
    return plan.steps.reduce(
      (sum, step) => sum + this.registry.get(step.tool).estimateUsd(step.args),
      0,
    );
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------
  private async runExecution(
    run: AgentRunRow,
    ctx: { workspaceId: string; language: 'en' | 'es'; emit: EmitFn },
  ): Promise<void> {
    const { workspaceId, language, emit } = ctx;
    const plan = run.plan as unknown;
    if (!plan || typeof plan !== 'object' || !('steps' in plan)) {
      await this.failRun(run, emit, 'Run has no plan to execute', language);
      return;
    }
    let parsed: AgentPlan;
    try {
      parsed = AgentPlanSchema.parse(plan);
    } catch (err) {
      await this.failRun(
        run,
        emit,
        `Stored plan is invalid: ${err instanceof Error ? err.message : String(err)}`,
        language,
      );
      return;
    }

    let levels: PlanStep[][];
    try {
      levels = topologicalLevels(parsed.steps);
    } catch (err) {
      await this.failRun(
        run,
        emit,
        `Invalid step graph: ${err instanceof Error ? err.message : String(err)}`,
        language,
      );
      return;
    }

    const base: StepExecutionContext = {
      db: this.db,
      userId: run.userId,
      workspaceId,
      projectId: run.projectId,
      runId: run.id,
      language,
      openrouter: this.openrouter,
      router: this.router,
      // Each parallel step receives its own reservation state below.
      budget: this.ports.makeBudget({ runId: run.id, workspaceId }),
      storage: this.ports.makeStorage({ workspaceId }),
      conversation: this.ports.makeConversation(),
      memory: this.ports.makeMemory(),
    };

    for (const level of levels) {
      const settled = await Promise.allSettled(
        level.map((step) =>
          this.executeStep(step, parsed.steps.indexOf(step), parsed.steps, base, emit),
        ),
      );
      for (const s of settled) {
        if (s.status === 'fulfilled') continue;
        const err = s.reason;
        if (err instanceof RunCancelledSignal || err instanceof BudgetParkedSignal) {
          return; // stopped quietly / already parked
        }
        const message = err instanceof Error ? err.message : String(err);
        await this.failRun(await this.loadRun(run.id), emit, message, language);
        return;
      }
    }

    await this.finishRun(run.id, { workspaceId, language, emit });
  }

  private async executeStep(
    step: PlanStep,
    stepNo: number,
    planSteps: PlanStep[],
    base: StepExecutionContext,
    emit: EmitFn,
  ): Promise<'completed' | 'skipped'> {
    const run = await this.loadRun(base.runId);
    if ((run.status as RunState) === 'cancelled') {
      throw new RunCancelledSignal();
    }

    // Find-or-create the step row (same row reused across resume attempts).
    const existing = await this.db
      .select()
      .from(agentSteps)
      .where(and(eq(agentSteps.runId, base.runId), eq(agentSteps.stepNo, stepNo)));
    let stepRow = existing[0];
    if (stepRow && stepRow.status === 'completed') {
      return 'skipped'; // resume: completed steps are never re-executed
    }
    if (!stepRow) {
      [stepRow] = await this.db
        .insert(agentSteps)
        .values({
          runId: base.runId,
          stepNo,
          kind: step.tool,
          title: step.title,
          status: 'running',
          detail: { planStepId: step.id },
          startedAt: new Date(),
        })
        .returning();
    } else {
      await this.db
        .update(agentSteps)
        .set({
          status: 'running',
          detail: {
            ...(stepRow.detail && typeof stepRow.detail === 'object'
              ? stepRow.detail as Record<string, unknown>
              : {}),
            planStepId: step.id,
          },
          startedAt: new Date(),
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(agentSteps.id, stepRow.id));
      stepRow = { ...stepRow, status: 'running' };
    }
    await emit('step.started', { stepId: step.id, title: step.title, tool: step.tool });

    const tool = this.registry.get(step.tool);
    let resolvedArgs: Record<string, unknown>;
    try {
      resolvedArgs = await this.resolveStepArgs(step, planSteps, base.runId);
    } catch (err) {
      const internalError = err instanceof Error ? err.message : String(err);
      const message = publicStepFailure(base.language);
      await this.markStepFailed(stepRow.id, step, message, emit, internalError);
      throw new StepFailedError(message);
    }
    const argsHash = stableHash(resolvedArgs);
    const ctx: ToolContext = {
      ...base,
      budget: this.ports.makeBudget({ runId: base.runId, workspaceId: base.workspaceId }),
      stepId: stepRow.id,
      emit: (type, payload) => emit(type, { ...payload, stepId: step.id }),
    };

    // Tool-call idempotency: a completed call for (stepId, tool, argsHash)
    // is reused instead of re-executed.
    const priorCalls = await this.db
      .select()
      .from(agentToolCalls)
      .where(
        and(
          eq(agentToolCalls.stepId, stepRow.id),
          eq(agentToolCalls.tool, step.tool),
          eq(agentToolCalls.argsHash, argsHash),
        ),
      );
    const completedPrior = priorCalls.find((c) => c.status === 'completed');

    let result: ToolResult;
    if (completedPrior?.result) {
      result = completedPrior.result as unknown as ToolResult;
      await emit('tool.completed', {
        stepId: step.id,
        tool: step.tool,
        cached: true,
        ok: result.ok,
        summary: result.summary,
      });
    } else {
      try {
        result = await this.runToolCall(
          tool,
          ctx,
          step,
          resolvedArgs,
          stepRow.id,
          argsHash,
          priorCalls[0]?.id,
          emit,
        );
      } catch (err) {
        const internalError = err instanceof Error ? err.message : String(err);
        const message = publicStepFailure(base.language);
        await this.markStepFailed(stepRow.id, step, message, emit, internalError);
        throw new StepFailedError(message);
      }
    }

    // Tool-level budget refusal → park the run for approval.
    const resultCode =
      result.data !== null && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>).code
        : undefined;
    if (!result.ok && resultCode === BUDGET_NOT_AFFORDABLE) {
      const data = result.data as { reason?: string; requestedUsd?: number };
      await this.markStepFailed(
        stepRow.id,
        step,
        publicBudgetPause(base.language),
        emit,
        result.summary,
      );
      await this.parkForBudget(
        base.runId,
        emit,
        data.reason ?? result.summary,
        data.requestedUsd ?? 0,
      );
      throw new BudgetParkedSignal();
    }
    if (!result.ok) {
      const internalError = result.summary || `Tool ${step.tool} failed`;
      const message = publicStepFailure(base.language);
      await this.markStepFailed(stepRow.id, step, message, emit, internalError);
      throw new StepFailedError(message);
    }

    await this.recordStepUsage(base, step, stepRow.id, result, emit);
    return 'completed';
  }

  /**
   * Planner step ids are references, not business ids. Resolve values such as
   * `{ campaignId: "s1" }` from the completed result of step s1 before the
   * tool schema sees them. Explicit `{{s1.campaignId}}` references are also
   * supported for unambiguous plans.
   */
  private async resolveStepArgs(
    step: PlanStep,
    planSteps: PlanStep[],
    runId: string,
  ): Promise<Record<string, unknown>> {
    const byId = new Map(planSteps.map((candidate, index) => [candidate.id, { candidate, index }]));
    const ancestors = new Set<string>();
    const visitDependencies = (candidate: PlanStep): void => {
      for (const dependencyId of candidate.dependsOn) {
        if (ancestors.has(dependencyId)) continue;
        ancestors.add(dependencyId);
        const dependency = byId.get(dependencyId)?.candidate;
        if (dependency) visitDependencies(dependency);
      }
    };
    visitDependencies(step);

    const resultData = new Map<string, Record<string, unknown>>();
    const loadResultData = async (referenceId: string): Promise<Record<string, unknown>> => {
      const cached = resultData.get(referenceId);
      if (cached) return cached;
      const referenced = byId.get(referenceId);
      if (!referenced) {
        throw new OrchestratorError(`Step '${step.id}' references unknown step '${referenceId}'`);
      }
      if (!ancestors.has(referenceId)) {
        throw new OrchestratorError(
          `Step '${step.id}' references '${referenceId}' without a dependency path`,
        );
      }
      const [referencedRow] = await this.db
        .select()
        .from(agentSteps)
        .where(
          and(
            eq(agentSteps.runId, runId),
            eq(agentSteps.stepNo, referenced.index),
          ),
        );
      if (!referencedRow || referencedRow.status !== 'completed') {
        throw new OrchestratorError(
          `Step '${step.id}' needs the completed output of '${referenceId}'`,
        );
      }
      const calls = await this.db
        .select()
        .from(agentToolCalls)
        .where(eq(agentToolCalls.stepId, referencedRow.id));
      const completed = [...calls]
        .reverse()
        .find((call) => call.status === 'completed' && call.result);
      const result = completed?.result as ToolResult | null | undefined;
      if (!result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
        throw new OrchestratorError(
          `Completed step '${referenceId}' did not produce referenceable data`,
        );
      }
      const data = result.data as Record<string, unknown>;
      resultData.set(referenceId, data);
      return data;
    };

    const readPath = (source: Record<string, unknown>, path: string): unknown => {
      let current: unknown = source;
      for (const segment of path.split('.')) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[segment];
      }
      return current;
    };

    const resolveReference = async (
      referenceId: string,
      fieldName: string | undefined,
      explicitPath?: string,
    ): Promise<unknown> => {
      const data = await loadResultData(referenceId);
      const requestedPath = explicitPath ?? fieldName;
      if (requestedPath) {
        const value = readPath(data, requestedPath);
        if (value !== undefined) return value;
        // An explicit field reference is content, not an ID request. Falling
        // back to the only *Id output here previously put designDocumentId
        // UUIDs into landing headlines and poster copy.
        if (explicitPath !== undefined) {
          throw new OrchestratorError(
            `Step '${referenceId}' has no output at '${explicitPath}'`,
          );
        }
      }
      const idEntries = Object.entries(data).filter(
        ([key, value]) => key.endsWith('Id') && typeof value === 'string',
      );
      if (idEntries.length === 1) return idEntries[0][1];
      throw new OrchestratorError(
        `Step '${referenceId}' has no output for argument '${requestedPath ?? 'unknown'}'`,
      );
    };

    const resolveValue = async (value: unknown, fieldName?: string): Promise<unknown> => {
      if (typeof value === 'string') {
        const explicit = value.match(/^\{\{([^{}.]+)(?:\.([^{}]+))?\}\}$/);
        if (explicit && byId.has(explicit[1])) {
          return resolveReference(explicit[1], fieldName, explicit[2]);
        }
        if (byId.has(value)) return resolveReference(value, fieldName);
        return value;
      }
      if (Array.isArray(value)) {
        return Promise.all(value.map((item) => resolveValue(item, fieldName)));
      }
      if (value && typeof value === 'object') {
        const entries = await Promise.all(
          Object.entries(value as Record<string, unknown>).map(async ([key, child]) => [
            key,
            await resolveValue(child, key),
          ] as const),
        );
        return Object.fromEntries(entries);
      }
      return value;
    };

    return (await resolveValue(step.args)) as Record<string, unknown>;
  }

  private async runToolCall(
    tool: AgentTool,
    ctx: ToolContext,
    step: PlanStep,
    args: Record<string, unknown>,
    dbStepId: string,
    argsHash: string,
    priorCallId: string | undefined,
    emit: EmitFn,
  ): Promise<ToolResult> {
    // Orchestrator-level budget guard for generate-category steps.
    if (tool.category === 'generate') {
      const estimate = tool.estimateUsd(args);
      const check = await ctx.budget.checkAffordable(estimate);
      if (!check.ok) {
        return {
          ok: false,
          summary: `Budget check failed: ${check.reason ?? 'insufficient budget'}`,
          data: {
            code: BUDGET_NOT_AFFORDABLE,
            reason: check.reason ?? 'Insufficient budget',
            requestedUsd: estimate,
          },
        };
      }
    }

    await emit('tool.started', { stepId: step.id, tool: step.tool });
    const startedAt = Date.now();

    let callId = priorCallId;
    if (!callId) {
      const [created] = await this.db
        .insert(agentToolCalls)
        .values({
          stepId: dbStepId,
          tool: step.tool,
          args,
          argsHash,
          status: 'running',
        })
        .returning({ id: agentToolCalls.id });
      callId = created.id;
    } else {
      await this.db
        .update(agentToolCalls)
        .set({ status: 'running', error: null, updatedAt: new Date() })
        .where(eq(agentToolCalls.id, callId));
    }

    try {
      const result = await this.executeWithRetry(tool, ctx, args);
      const durationMs = Date.now() - startedAt;
      const costUsd = result.costUsd ?? result.usage?.costUsd ?? 0;
      await this.db
        .update(agentToolCalls)
        .set({
          status: 'completed',
          result: result as unknown as Record<string, unknown>,
          durationMs,
          costUsd: String(costUsd),
          updatedAt: new Date(),
        })
        .where(eq(agentToolCalls.id, callId));
      await emit('tool.completed', {
        stepId: step.id,
        tool: step.tool,
        durationMs,
        ok: result.ok,
        summary: result.summary,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(agentToolCalls)
        .set({
          status: 'failed',
          error: message,
          durationMs: Date.now() - startedAt,
          updatedAt: new Date(),
        })
        .where(eq(agentToolCalls.id, callId));
      throw err instanceof Error ? err : new OrchestratorError(message);
    }
  }

  private async executeWithRetry(
    tool: AgentTool,
    ctx: ToolContext,
    args: unknown,
  ): Promise<ToolResult> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await withTimeout(
          tool.execute(ctx, args),
          this.config.stepTimeoutMs,
          `Tool ${tool.name} timed out after ${this.config.stepTimeoutMs}ms`,
        );
      } catch (err) {
        lastError = err;
        if (attempt < 2) await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new OrchestratorError(String(lastError));
  }

  private async markStepFailed(
    dbStepId: string,
    step: PlanStep,
    message: string,
    emit: EmitFn,
    internalError?: string,
  ): Promise<void> {
    const [current] = await this.db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.id, dbStepId));
    const currentDetail =
      current?.detail && typeof current.detail === 'object'
        ? (current.detail as Record<string, unknown>)
        : {};
    await this.db
      .update(agentSteps)
      .set({
        status: 'failed',
        error: message,
        detail: internalError
          ? { ...currentDetail, internalError, internalErrorAt: new Date().toISOString() }
          : currentDetail,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentSteps.id, dbStepId));
    await emit('step.failed', { stepId: step.id, tool: step.tool, error: message });
  }

  private async recordStepUsage(
    base: StepExecutionContext,
    step: PlanStep,
    dbStepId: string,
    result: ToolResult,
    emit: EmitFn,
  ): Promise<void> {
    const usage: TokenUsage | undefined = result.usage;
    const costUsd = result.costUsd ?? usage?.costUsd ?? 0;
    const model =
      result.data !== null && typeof result.data === 'object'
        ? String((result.data as Record<string, unknown>).model ?? 'unknown')
        : 'unknown';

    if (usage) {
      await base.budget.recordUsage({
        model,
        tool: step.tool,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costUsd,
        durationMs: 0,
      });
      await emit('usage', {
        model,
        tool: step.tool,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costUsd,
      });
    }

    // Atomic increments are required because independent steps in the same
    // topological level complete concurrently.
    const [progress] = await this.db
      .update(agentRuns)
      .set({
        costUsd: sql`${agentRuns.costUsd} + ${String(costUsd)}`,
        completedSteps: sql`${agentRuns.completedSteps} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, base.runId))
      .returning({
        costUsd: agentRuns.costUsd,
        completedSteps: agentRuns.completedSteps,
        totalSteps: agentRuns.totalSteps,
      });
    const newCost = Number(progress.costUsd ?? 0);
    const newCompleted = progress.completedSteps;
    await this.db
      .update(agentSteps)
      .set({
        status: 'completed',
        detail: { planStepId: step.id, costUsd },
        tokensIn: usage?.tokensIn ?? 0,
        tokensOut: usage?.tokensOut ?? 0,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentSteps.id, dbStepId));
    await emit('step.completed', { stepId: step.id, tool: step.tool });
    await emit('run.progress', {
      completedSteps: newCompleted,
      totalSteps: progress.totalSteps,
      costUsd: newCost,
    });
  }

  private async parkForBudget(
    runId: string,
    emit: EmitFn,
    reason: string,
    requestedUsd: number,
  ): Promise<void> {
    const run = await this.loadRun(runId);
    if ((run.status as RunState) === 'waiting_approval') return;
    await this.transitionTo(run, 'waiting_approval', emit);
    await this.db
      .update(agentRuns)
      .set({
        approval: { reason, requestedBudgetUsd: requestedUsd },
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));
    await emit('run.waiting_approval', { reason, requestedBudgetUsd: requestedUsd });
  }

  // -----------------------------------------------------------------------
  // Terminal states
  // -----------------------------------------------------------------------
  private async failRun(
    run: AgentRunRow,
    emit: EmitFn,
    internalError: string,
    language: 'en' | 'es',
  ): Promise<void> {
    const fresh = await this.loadRun(run.id).catch(() => run);
    const error = publicRunFailure(language);
    const stepError = publicStepFailure(language);
    console.error(`[agent-run:${run.id}] ${internalError}`);
    await closeRunningAgentSteps(this.db, run.id, 'failed', stepError);
    await this.db
      .update(agentRuns)
      .set({ error, updatedAt: new Date() })
      .where(eq(agentRuns.id, run.id));
    await this.transitionTo({ ...fresh, error }, 'failed', emit);
    await emit('run.finished', { status: 'failed', error });
    if (fresh.conversationId) {
      const message =
        language === 'es'
          ? `No pude terminar la tarea, pero todo lo creado se ha conservado. Puedes reanudarla sin repetir los pasos completados.`
          : `I couldn't finish the task, but everything created has been preserved. You can resume it without repeating completed steps.`;
      try {
        await this.ports
          .makeConversation()
          .appendAssistantMessage(fresh.conversationId, message, { runId: run.id });
      } catch {
        // The honest message is best-effort; the run state is authoritative.
      }
    }
  }

  private async finishRun(
    runId: string,
    ctx: { workspaceId: string; language: 'en' | 'es'; emit: EmitFn },
  ): Promise<void> {
    const { workspaceId, language, emit } = ctx;
    const run = await this.loadRun(runId);
    const steps = await this.db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.runId, runId));

    let summary: string;
    try {
      const summaryBudget = this.ports.makeBudget({ runId, workspaceId });
      const affordable = await summaryBudget.checkAffordable(0.02);
      if (!affordable.ok) throw new Error('Insufficient credits for run summary');
      const model = await this.router.select('review');
      const result = await withTimeout(
        this.openrouter.chat({
          model,
          messages: [
            { role: 'system', content: summarySystemPrompt(language) },
            {
              role: 'user',
              content: JSON.stringify({
                goal: run.input,
                steps: steps.map((s) => ({
                  title: s.title,
                  tool: s.kind,
                  status: s.status,
                })),
              }),
            },
          ],
          maxTokens: 600,
          temperature: 0.3,
          timeoutMs: 60000,
        }),
        this.config.runTimeoutMs,
        'Summary timed out',
      );
      const summaryCost = result.usage.costUsd ?? 0;
      await summaryBudget.recordUsage({
        model: result.model,
        tool: 'agent_summary',
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        costUsd: summaryCost,
        durationMs: result.durationMs,
      });
      await this.db
        .update(agentRuns)
        .set({ costUsd: String(Number(run.costUsd ?? 0) + summaryCost), updatedAt: new Date() })
        .where(eq(agentRuns.id, runId));
      await emit('usage', {
        model: result.model,
        tool: 'agent_summary',
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        costUsd: summaryCost,
      });
      summary = result.content;
    } catch {
      // Honest fallback: report what actually happened, never invent.
      const done = steps.filter((s) => s.status === 'completed').length;
      summary =
        language === 'es'
          ? `Tarea completada: ${done}/${steps.length} pasos ejecutados correctamente.`
          : `Task completed: ${done}/${steps.length} steps executed successfully.`;
    }

    if (run.conversationId) {
      try {
        await this.ports
          .makeConversation()
          .appendAssistantMessage(run.conversationId, summary, { runId });
      } catch {
        // Best-effort; run state is authoritative.
      }
    }
    try {
      await this.ports.makeMemory().setProjectMemory(
        run.projectId,
        'last_run_summary',
        { runId, summary: summary.slice(0, 500), at: new Date().toISOString() },
        'Latest agent run summary',
      );
    } catch {
      // Memory is best-effort.
    }

    await this.transitionTo(run, 'completed', emit);
    await emit('run.finished', { status: 'completed', summary: summary.slice(0, 2000) });
  }

  // -----------------------------------------------------------------------
  // HTTP control plane: cancel / resume / approve
  // -----------------------------------------------------------------------
  async cancelRun(runId: string): Promise<{ id: string; state: RunState }> {
    const run = await this.loadRun(runId);
    const status = run.status as RunState;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      return { id: run.id, state: status }; // terminal: idempotent no-op
    }
    const emit = this.emitFor(runId);
    await closeRunningAgentSteps(this.db, run.id, 'cancelled', null);
    await this.transitionTo(run, 'cancelled', emit);
    await emit('run.finished', { status: 'cancelled' });
    return { id: run.id, state: 'cancelled' };
  }

  async resumeRun(runId: string): Promise<{ id: string; state: RunState }> {
    const run = await this.loadRun(runId);
    const status = run.status as RunState;
    if (status !== 'failed' && status !== 'cancelled') {
      throw new OrchestratorError(`Cannot resume a run in state '${status}'`);
    }
    if (run.attempts >= this.config.maxAttempts) {
      throw new ResumeLimitError(this.config.maxAttempts);
    }
    const emit = this.emitFor(runId);
    const parsedPlan = AgentPlanSchema.safeParse(run.plan);
    const target: RunState = parsedPlan.success && run.totalSteps > 0 ? 'running' : 'pending';
    await this.db
      .update(agentRuns)
      .set({
        error: null,
        claimedBy: null,
        heartbeatAt: null,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));
    await this.transitionTo(
      { ...run, error: null, claimedBy: null, heartbeatAt: null, finishedAt: null },
      target,
      emit,
    );
    return { id: run.id, state: target };
  }

  async approveRun(
    runId: string,
    approved: boolean,
    budgetUsd?: number,
  ): Promise<{ id: string; state: RunState }> {
    const run = await this.loadRun(runId);
    if ((run.status as RunState) !== 'waiting_approval') {
      throw new OrchestratorError(
        `Cannot approve a run in state '${run.status}'`,
      );
    }
    const emit = this.emitFor(runId);
    if (!approved) {
      await this.transitionTo(run, 'cancelled', emit);
      await emit('run.finished', { status: 'cancelled', reason: 'approval_rejected' });
      return { id: run.id, state: 'cancelled' };
    }
    await this.db
      .update(agentRuns)
      .set({
        budgetUsd: budgetUsd != null ? String(budgetUsd) : run.budgetUsd,
        approval: null,
        updatedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));
    await this.transitionTo(run, 'running', emit);
    return { id: run.id, state: 'running' };
  }
}

// ---------------------------------------------------------------------------
// Summary prompt (final honest recap)
// ---------------------------------------------------------------------------
function summarySystemPrompt(language: 'en' | 'es'): string {
  return language === 'es'
    ? 'Eres el asistente de BrandForge AI. Resume de forma honesta y breve qué se ha hecho en esta tarea a partir de la lista de pasos ejecutados. No inventes resultados: menciona solo lo que los pasos confirman. Termina con los artefactos creados, si los hay.'
    : 'You are the BrandForge AI assistant. Honestly and briefly summarize what was accomplished in this task from the executed step list. Do not invent results: mention only what the steps confirm. End with the artifacts created, if any.';
}

// Re-exported for unit tests (PlannerError is thrown by runPlanning).
export { PlannerError };
