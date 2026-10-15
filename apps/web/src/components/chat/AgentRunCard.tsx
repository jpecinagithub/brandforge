/**
 * AgentRunCard — live progress card for a Phase-3 agent run, rendered inline
 * in the chat thread.
 *
 * On mount it hydrates from GET /api/v1/agent/runs/:runId (best-effort) and
 * subscribes to GET /api/v1/agent/runs/:runId/events via EventSource
 * (cookie session → withCredentials: true). Every SSE frame is
 * `data: {id, runId, seq, type, payload, createdAt}`; payloads are narrowed
 * defensively (unknown shapes never crash the card).
 *
 * Contract coverage: run.started, run.state, run.progress, step.started,
 * step.completed, step.failed, tool.started, tool.completed,
 * run.waiting_approval, usage, run.finished.
 *
 * Stream errors close the EventSource deliberately and fall back to polling
 * the persisted run state. On run.finished the card stays visible in the
 * "done" state and the parent reloads the thread (the backend already wrote
 * the final assistant message).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Input, Spinner } from '@brandforge/ui';
import { AlertCircle, Check, Circle, RefreshCw, Wrench, X, XCircle } from 'lucide-react';
import { apiUrl, get, post } from '@/lib/api';
import type { AgentRun, AgentStep, RunState } from '@brandforge/shared';
import { isKnownRunState, isRunActive, runStateLabelKey, runStateTone } from './agentUi';

type StepState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface StepView {
  key: string;
  title: string;
  tool?: string;
  state: StepState;
  error?: string;
}

interface ToolLine {
  tool: string;
  summary: string;
  ok: boolean;
}

interface UsageView {
  model?: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function stepStateOf(s: string): StepState {
  return s === 'completed'
    ? 'completed'
    : s === 'failed'
      ? 'failed'
      : s === 'cancelled'
        ? 'cancelled'
        : s === 'running'
          ? 'running'
          : 'pending';
}

function settleVisibleSteps(steps: StepView[], state: RunState): StepView[] {
  if (state !== 'failed' && state !== 'cancelled') return steps;
  return steps.map((step) => step.state === 'running' ? { ...step, state } : step);
}

interface AgentRunCardProps {
  run: AgentRun;
  onFinished: (runId: string) => void;
}

export function AgentRunCard({ run: initialRun, onFinished }: AgentRunCardProps) {
  const { t } = useTranslation();
  const runId = initialRun.id;

  const [runState, setRunState] = useState<RunState>(initialRun.state);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [completedSteps, setCompletedSteps] = useState(initialRun.completedSteps);
  const [totalSteps, setTotalSteps] = useState(initialRun.totalSteps);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolLine[]>([]);
  const [usage, setUsage] = useState<UsageView>({ tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const [approval, setApproval] = useState<{ reason: string; requestedBudgetUsd: number } | null>(
    initialRun.approval
      ? { reason: initialRun.approval.reason, requestedBudgetUsd: initialRun.approval.requestedBudgetUsd }
      : null,
  );
  const [error, setError] = useState<string | null>(initialRun.error);
  const [summary, setSummary] = useState<string | null>(null);
  const [streamError, setStreamError] = useState(false);
  const [acting, setActing] = useState<'approve' | 'reject' | 'cancel' | null>(null);
  const [budgetInput, setBudgetInput] = useState('');

  const esRef = useRef<EventSource | null>(null);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  /* ------------------------------ SSE events ------------------------------ */

  const handleEvent = useCallback(
    (raw: string) => {
      let ev: { type?: unknown; payload?: unknown };
      try {
        ev = JSON.parse(raw) as { type?: unknown; payload?: unknown };
      } catch {
        return;
      }
      const type = typeof ev.type === 'string' ? ev.type : '';
      const p = (ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as Record<string, unknown>;

      switch (type) {
        case 'run.started':
          setRunState('planning');
          setError(null);
          break;
        case 'run.state': {
          const s = str(p.to) ?? str(p.state);
          if (s && isKnownRunState(s)) {
            setRunState(s);
            if (s !== 'waiting_approval') setApproval(null);
          }
          break;
        }
        case 'run.progress': {
          const c = num(p.completedSteps);
          const total = num(p.totalSteps);
          if (c !== undefined) setCompletedSteps(c);
          if (total !== undefined) setTotalSteps(total);
          setCurrentStepId(str(p.currentStep) ?? null);
          break;
        }
        case 'step.started': {
          const stepId = str(p.stepId);
          if (!stepId) break;
          setSteps((prev) => {
            const found = prev.find((s) => s.key === stepId);
            const next: StepView = {
              key: stepId,
              title: str(p.title) ?? found?.title ?? stepId,
              tool: str(p.tool) ?? found?.tool,
              state: 'running',
            };
            return found ? prev.map((s) => (s.key === stepId ? next : s)) : [...prev, next];
          });
          break;
        }
        case 'step.completed': {
          const stepId = str(p.stepId);
          if (!stepId) break;
          setSteps((prev) =>
            prev.map((s) => (s.key === stepId ? { ...s, state: 'completed', title: str(p.title) ?? s.title } : s)),
          );
          break;
        }
        case 'step.failed': {
          const stepId = str(p.stepId);
          if (!stepId) break;
          const err = str(p.error);
          setSteps((prev) =>
            prev.map((s) =>
              s.key === stepId ? { ...s, state: 'failed', title: str(p.title) ?? s.title, error: err } : s,
            ),
          );
          if (err) setError(err);
          break;
        }
        case 'tool.completed': {
          setTools((prev) => [
            ...prev,
            { tool: str(p.tool) ?? 'tool', summary: str(p.summary) ?? '', ok: p.ok !== false },
          ]);
          break;
        }
        case 'run.waiting_approval': {
          setApproval({
            reason: str(p.reason) ?? '',
            requestedBudgetUsd: num(p.requestedBudgetUsd) ?? 0,
          });
          setRunState('waiting_approval');
          break;
        }
        case 'usage': {
          setUsage((prev) => ({
            model: str(p.model) ?? prev.model,
            tokensIn: prev.tokensIn + (num(p.tokensIn) ?? 0),
            tokensOut: prev.tokensOut + (num(p.tokensOut) ?? 0),
            costUsd: prev.costUsd + (num(p.costUsd) ?? 0),
          }));
          break;
        }
        case 'run.finished': {
          const s = str(p.status) ?? str(p.state);
          finishedRef.current = true;
          esRef.current?.close();
          esRef.current = null;
          if (s && isKnownRunState(s)) {
            setRunState(s);
            setSteps((current) => settleVisibleSteps(current, s));
          }
          setSummary(str(p.summary) ?? null);
          setApproval(null);
          setStreamError(false);
          onFinishedRef.current(runId);
          break;
        }
        default:
          // tool.started and any future event types are ignored deliberately.
          break;
      }
    },
    [runId],
  );

  /* --------------------------- hydrate + subscribe --------------------------- */

  const hydrate = useCallback(async () => {
    try {
      const res = await get<{ run: AgentRun; steps: AgentStep[] }>(`/api/v1/agent/runs/${runId}`);
      if (res.run.state && isKnownRunState(res.run.state)) {
        setRunState(res.run.state);
        // Run already terminal: don't subscribe to SSE (server closes it
        // immediately, which EventSource reports as an error).
        if (!isRunActive(res.run.state)) {
          const firstTerminalRefresh = !finishedRef.current;
          finishedRef.current = true;
          esRef.current?.close();
          esRef.current = null;
          setStreamError(false);
          if (firstTerminalRefresh) onFinishedRef.current(runId);
        }
      }
      setCompletedSteps(res.run.completedSteps);
      setTotalSteps(res.run.totalSteps);
      setError(res.run.error);
      setApproval(
        res.run.approval
          ? { reason: res.run.approval.reason, requestedBudgetUsd: res.run.approval.requestedBudgetUsd }
          : null,
      );
      const hydratedSteps = (res.steps ?? []).map((s) => ({
          key: s.id,
          title: s.title,
          tool: s.tool || undefined,
          state: stepStateOf(s.state),
          error: s.error ?? undefined,
        }));
      setSteps(settleVisibleSteps(hydratedSteps, res.run.state));
    } catch {
      // SSE is the source of truth; hydrate is best-effort (e.g. endpoint
      // not deployed yet — the card still works from streamed events).
    }
  }, [runId]);

  const subscribe = useCallback(() => {
    if (finishedRef.current) return;
    esRef.current?.close();
    setStreamError(false);
    const es = new EventSource(apiUrl(`/api/v1/agent/runs/${runId}/events`), { withCredentials: true });
    esRef.current = es;
    es.onmessage = (e) => handleEvent(e.data);
    es.onerror = () => {
      if (finishedRef.current) return;
      // Stop the browser's built-in infinite retry; the user retries manually.
      es.close();
      esRef.current = null;
      setStreamError(true);
    };
  }, [runId, handleEvent]);

  useEffect(() => {
    void hydrate();
    subscribe();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [hydrate, subscribe]);

  useEffect(() => {
    if (!streamError || finishedRef.current) return;
    let polling = false;
    const poll = async () => {
      if (polling || finishedRef.current) return;
      polling = true;
      try {
        await hydrate();
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => window.clearInterval(timer);
  }, [hydrate, streamError]);

  /* --------------------------------- actions --------------------------------- */

  const decide = async (approved: boolean) => {
    setActing(approved ? 'approve' : 'reject');
    try {
      const budget = parseFloat(budgetInput);
      await post(`/api/v1/agent/runs/${runId}/approve`, {
        approved,
        ...(approved && Number.isFinite(budget) && budget > 0 ? { budgetUsd: budget } : {}),
      });
      // The server continues (or stops) the run; SSE will move the state.
      // Clear the prompt optimistically so a double-click can't double-send.
      setApproval(null);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setActing(null);
    }
  };

  const cancel = async () => {
    setActing('cancel');
    try {
      await post(`/api/v1/agent/runs/${runId}/cancel`);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setActing(null);
    }
  };

  /* ---------------------------------- render ---------------------------------- */

  const active = isRunActive(runState);
  const done = runState === 'completed' || runState === 'failed' || runState === 'cancelled';
  const currentTitle = currentStepId ? steps.find((s) => s.key === currentStepId)?.title : null;
  const tokensTotal = usage.tokensIn + usage.tokensOut;

  return (
    <div
      data-testid="agent-run-card"
      data-run-id={runId}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-800/60"
    >
      {/* Header: state badge + cancel */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {active && !streamError && <Spinner size="sm" />}
          <Badge
            tone={runStateTone[runState]}
            className={active ? 'px-3 py-1 text-sm font-semibold' : undefined}
          >
            {t(runStateLabelKey[runState])}
          </Badge>
        </div>
        {active && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void cancel()}
            disabled={acting !== null}
            aria-label={t('agent.cancel')}
            className="!px-2.5"
          >
            {acting === 'cancel' ? <Spinner size="sm" /> : <X size={14} />}
            <span className="text-xs">{t('agent.cancel')}</span>
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mt-2.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-valuenow={Math.min(completedSteps, totalSteps)}
          >
            <div
              className="h-full rounded-full bg-violet-600 transition-all"
              style={{ width: `${Math.min(100, (completedSteps / totalSteps) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('agent.progressSteps', { completed: Math.min(completedSteps, totalSteps), total: totalSteps })}
            {currentTitle ? ` · ${currentTitle}` : ''}
          </p>
        </div>
      )}

      {/* Live step list */}
      {steps.length > 0 && (
        <ul className="mt-2.5 space-y-1.5" aria-label={t('agent.stepsLabel')}>
          {steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-xs">
              {s.state === 'completed' ? (
                <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" aria-label={t('agent.completed')} />
              ) : s.state === 'failed' ? (
                <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" aria-label={t('agent.failed')} />
              ) : s.state === 'cancelled' ? (
                <X size={14} className="mt-0.5 shrink-0 text-slate-400" aria-label={t('agent.cancelled')} />
              ) : s.state === 'running' ? (
                <Spinner size="sm" />
              ) : (
                <Circle size={14} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />
              )}
              <div className="min-w-0">
                <p className="break-words text-slate-700 dark:text-slate-200">{s.title}</p>
                {s.tool && <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{s.tool}</p>}
                {s.error && <p className="break-words text-red-600 dark:text-red-400">{s.error}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Tool summaries */}
      {tools.length > 0 && (
        <ul className="mt-2 space-y-1">
          {tools.map((tl, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Wrench size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                <span className="font-mono">{tl.tool}</span>
                {tl.summary ? `: ${tl.summary}` : ''}
                {!tl.ok && ` (${t('agent.failed')})`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Usage line */}
      {(tokensTotal > 0 || usage.costUsd > 0) && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {usage.model && <span className="font-medium">{usage.model} · </span>}
          {t('agent.tokens', { tokens: tokensTotal })}
          {usage.costUsd > 0 && (
            <>
              {' · '}
              {t('agent.cost')}: ${usage.costUsd.toFixed(4)}
            </>
          )}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400" role="alert">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{error}</span>
        </p>
      )}

      {/* Approval request */}
      {approval && active && (
        <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{t('agent.approveReason')}</p>
          {approval.reason && <p className="mt-1 break-words text-xs text-amber-700 dark:text-amber-200">{approval.reason}</p>}
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">
            {t('agent.requestedBudget')}: ${approval.requestedBudgetUsd}
          </p>
          <div className="mt-2">
            <Input
              label={t('agent.budgetLabel')}
              type="number"
              min="0"
              step="0.01"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="!py-1.5 !text-xs"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void decide(true)} disabled={acting !== null}>
              {acting === 'approve' && <Spinner size="sm" />}
              {t('agent.approve')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void decide(false)} disabled={acting !== null}>
              {acting === 'reject' && <Spinner size="sm" />}
              {t('agent.reject')}
            </Button>
          </div>
        </div>
      )}

      {/* SSE can be interrupted by proxies; polling keeps progress durable. */}
      {streamError && active && (
        <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50/80 p-3 dark:border-sky-400/20 dark:bg-sky-400/[0.08]" role="status">
          <RefreshCw size={15} className="mt-0.5 shrink-0 animate-spin text-sky-600 dark:text-sky-300" aria-hidden="true" />
          <p className="min-w-0 text-xs leading-relaxed text-sky-900 dark:text-sky-100">{t('agent.retryNote')}</p>
        </div>
      )}

      {/* Final summary when done */}
      {done && summary && (
        <p className="mt-2.5 break-words text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold">{t('agent.summary')}: </span>
          {summary}
        </p>
      )}
    </div>
  );
}
