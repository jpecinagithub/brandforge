/**
 * AgentRunsHistory — collapsible run history for the campaign, rendered above
 * the chat thread (works in the desktop chat column and the mobile chat view).
 *
 * - List: GET /api/v1/campaigns/:campaignId/agent/runs → {runs: AgentRun[]}
 *   with a state badge + cost per run; refreshes when `refreshKey` changes
 *   (e.g. after a run finishes in the chat).
 * - Click a run → modal with GET /api/v1/agent/runs/:runId → {run, steps}.
 *
 * Both fetches degrade to an honest empty state when the endpoints are not
 * deployed yet (404 → "no runs"), never a crash.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, EmptyState, Modal, Spinner } from '@brandforge/ui';
import { Bot, Check, ChevronDown, Circle, XCircle } from 'lucide-react';
import { get, post } from '@/lib/api';
import type { AgentRun, AgentStep } from '@brandforge/shared';
import { runStateLabelKey, runStateTone } from './agentUi';

interface AgentRunsHistoryProps {
  campaignId: string;
  refreshKey: number;
}

export function AgentRunsHistory({ campaignId, refreshKey }: AgentRunsHistoryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [detail, setDetail] = useState<{ run: AgentRun; steps: AgentStep[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await get<{ runs: AgentRun[] }>(`/api/v1/campaigns/${campaignId}/agent/runs`);
      setRuns(res.runs ?? []);
    } catch {
      setRuns([]);
    }
  }, [campaignId]);

  const decide = useCallback(async (runId: string, approved: boolean) => {
    setDeciding(true);
    try {
      await post(`/api/v1/agent/runs/${runId}/approve`, { approved });
      setDetail(null);
      void load();
    } finally {
      setDeciding(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const openDetail = async (runId: string) => {
    setDetailLoading(true);
    try {
      const res = await get<{ run: AgentRun; steps: AgentStep[] }>(`/api/v1/agent/runs/${runId}`);
      setDetail({ run: res.run, steps: res.steps ?? [] });
    } catch {
      // keep the modal closed on failure — nothing honest to show
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
          <Bot size={15} className="text-violet-500" aria-hidden="true" />
          {t('agent.runsTitle')}
          {runs && runs.length > 0 && <Badge tone="slate">{runs.length}</Badge>}
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="slim-scroll max-h-56 space-y-1 overflow-y-auto px-3 pb-3">
          {runs === null ? (
            <div className="flex justify-center py-3 text-violet-600"><Spinner size="sm" /></div>
          ) : runs.length === 0 ? (
            <p className="py-2 text-center text-xs text-slate-400 dark:text-slate-500">{t('agent.noRuns')}</p>
          ) : (
            runs.map((r) => (
              <button
                key={r.id}
                onClick={() => void openDetail(r.id)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone={runStateTone[r.state]}>{t(runStateLabelKey[r.state])}</Badge>
                  <span className="truncate text-slate-500 dark:text-slate-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </span>
                {r.costUsd && (
                  <span className="shrink-0 font-mono text-slate-500 dark:text-slate-400">${r.costUsd}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      <Modal
        open={detailLoading || detail !== null}
        onClose={() => setDetail(null)}
        title={t('agent.runDetail')}
        maxWidth="max-w-lg"
      >
        {detailLoading || !detail ? (
          <div className="flex justify-center py-6 text-violet-600"><Spinner /></div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={runStateTone[detail.run.state]}>{t(runStateLabelKey[detail.run.state])}</Badge>
              {detail.run.costUsd && (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t('agent.totalCost')}: ${detail.run.costUsd}
                </span>
              )}
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {new Date(detail.run.createdAt).toLocaleString()}
              </span>
            </div>
            {detail.run.error && (
              <p className="break-words text-xs text-red-600 dark:text-red-400" role="alert">
                {detail.run.error}
              </p>
            )}
            {detail.run.approval && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="break-words text-xs font-semibold text-amber-800 dark:text-amber-300">
                  {t('agent.approveReason')}: {detail.run.approval.reason}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => void decide(detail.run.id, true)} disabled={deciding}>
                    {deciding && <Spinner size="sm" />}
                    {t('agent.approve')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void decide(detail.run.id, false)} disabled={deciding}>
                    {t('agent.reject')}
                  </Button>
                </div>
              </div>
            )}
            {detail.steps.length === 0 ? (
              <EmptyState title={t('agent.noSteps')} />
            ) : (
              <ol className="space-y-1.5">
                {detail.steps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60">
                    {s.state === 'completed' ? (
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    ) : s.state === 'failed' ? (
                      <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                    ) : (
                      <Circle size={14} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="break-words text-slate-700 dark:text-slate-200">{s.title}</p>
                      {s.tool && <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{s.tool}</p>}
                      {s.error && <p className="break-words text-red-600 dark:text-red-400">{s.error}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
