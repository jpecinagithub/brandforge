/**
 * ChatPanel — project agent chat with live, persisted run progress.
 *
 * Send flow per the agent contract:
 *  1. POST /api/v1/conversations/:id/messages {content}
 *     → { message, run: AgentRun|null, reply?: {content, notice?} }
 *  2. If `run` is present → the backend started an agentic run: append the
 *     user message, render a live <AgentRunCard/> (SSE progress), hide the
 *     availability warning.
 *  3. Else if `reply` is present → append the assistant message. When
 *     `reply.notice` explains whether configuration or quota prevented a run.
 *  4. On run.finished → reload the thread (the backend already persisted the
 *     final assistant message) and refresh the runs history; the card stays
 *     in the thread, marked done.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spinner } from '@brandforge/ui';
import { CheckCircle2, Info, Send } from 'lucide-react';
import { get, post } from '@/lib/api';
import type { AgentAvailability, Conversation, ConversationMessage } from '@/lib/types';
import type { AgentRun } from '@brandforge/shared';
import { AgentRunCard } from './AgentRunCard';
import { AgentRunsHistory } from './AgentRunsHistory';
import { isRunActive } from './agentUi';

const AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED';
const AI_QUOTA_UNAVAILABLE = 'AI_QUOTA_UNAVAILABLE';
type AgentStatus = 'unknown' | 'available' | 'not_configured' | 'quota_exhausted';

interface ChatMsg extends ConversationMessage {
  notice?: string;
}

interface SendMessageResponse {
  message: ConversationMessage;
  run?: AgentRun | null;
  reply?: {
    id?: string;
    role?: string;
    content: string;
    createdAt?: string;
    notice?: string;
  };
}

interface ChatDraftRequest {
  id: number;
  text: string;
}

export function ChatPanel({ projectId, draftRequest }: { projectId: string; draftRequest?: ChatDraftRequest | null }) {
  const { t, i18n } = useTranslation();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('unknown');
  const [liveRuns, setLiveRuns] = useState<AgentRun[]>([]);
  const [runsRefreshKey, setRunsRefreshKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = useCallback(async () => {
    const res = await get<{ conversation: Conversation; messages: ConversationMessage[]; agent: AgentAvailability }>(
      `/api/v1/projects/${projectId}/conversation`,
    );
    setConversation(res.conversation);
    setMessages(res.messages ?? []);
    setAgentStatus(res.agent.available ? 'available' : (res.agent.reason ?? 'not_configured'));
  }, [projectId]);

  const fetchActiveRuns = useCallback(async () => {
    const res = await get<{ runs: AgentRun[] }>(`/api/v1/projects/${projectId}/agent/runs`);
    const activeRuns = (res.runs ?? []).filter((run) => isRunActive(run.state));
    setLiveRuns((current) => {
      const activeIds = new Set(activeRuns.map((run) => run.id));
      const finishedFromThisView = current.filter((run) => !isRunActive(run.state) && !activeIds.has(run.id));
      return [...finishedFromThisView, ...activeRuns];
    });
  }, [projectId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLiveRuns([]);
    void Promise.allSettled([
      fetchMessages().catch(() => {
        setConversation(null);
        setMessages([]);
        setAgentStatus('unknown');
      }),
      fetchActiveRuns().catch(() => setLiveRuns([])),
    ]).then(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [fetchActiveRuns, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveRuns]);

  useEffect(() => {
    if (!draftRequest) return;
    setInput((current) => current.trim() ? current : draftRequest.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [draftRequest]);

  const handleRunFinished = useCallback(
    (_runId: string) => {
      // The backend persisted the final assistant message — reload the thread
      // and refresh the history list. The card itself stays, marked done.
      setRunsRefreshKey((k) => k + 1);
      fetchMessages().catch(() => {
        /* keep the existing thread on reload failure */
      });
    },
    [fetchMessages],
  );

  const send = async () => {
    const content = input.trim();
    if (!content || !conversation || sending) return;
    setSending(true);
    setInput('');
    try {
      const res = await post<SendMessageResponse>(`/api/v1/conversations/${conversation.id}/messages`, {
        content,
        language: i18n.language.startsWith('es') ? 'es' : 'en',
      });
      setMessages((m) => [...m, res.message]);
      if (res.run) {
        setAgentStatus('available');
        setLiveRuns((runs) => runs.some((run) => run.id === res.run?.id) ? runs : [...runs, res.run as AgentRun]);
      } else if (res.reply) {
        const notice = res.reply.notice;
        if (notice === AI_NOT_CONFIGURED) setAgentStatus('not_configured');
        if (notice === AI_QUOTA_UNAVAILABLE) setAgentStatus('quota_exhausted');
        setMessages((m) => [
          ...m,
          {
            id: res.reply?.id ?? `reply-${res.message.id}`,
            role: 'assistant',
            content: res.reply?.content ?? '',
            createdAt: res.reply?.createdAt ?? new Date().toISOString(),
            notice,
          },
        ]);
      }
    } catch {
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('workspace.chatTitle')}</h3>
          {agentStatus === 'available' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={13} aria-hidden="true" />
              {t('workspace.agentAvailable')}
            </span>
          )}
        </div>
        {(agentStatus === 'not_configured' || agentStatus === 'quota_exhausted') && (
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t(agentStatus === 'quota_exhausted' ? 'workspace.agentQuotaUnavailable' : 'workspace.agentUnavailable')}</span>
          </div>
        )}
      </div>

      <AgentRunsHistory projectId={projectId} refreshKey={runsRefreshKey} />

      <div className="slim-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center text-violet-600"><Spinner /></div>
        ) : messages.length === 0 && liveRuns.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">{t('workspace.chatEmpty')}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  m.role === 'user'
                    ? 'rounded-br-md bg-violet-600 text-white'
                    : 'rounded-bl-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === 'assistant' && (m.notice === AI_NOT_CONFIGURED || m.notice === AI_QUOTA_UNAVAILABLE) && (
                  <p className="mt-1.5 text-[11px] italic text-slate-400 dark:text-slate-500">{t('workspace.chatReplyNotice')}</p>
                )}
              </div>
            </div>
          ))
        )}
        {liveRuns.map((run) => (
          <AgentRunCard key={run.id} run={run} onFinished={handleRunFinished} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={t('workspace.chatPlaceholder')}
            aria-label={t('workspace.chatTitle')}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <Button size="sm" onClick={() => void send()} disabled={!input.trim() || sending} aria-label={t('common.send')} className="px-3">
            {sending ? <Spinner size="sm" /> : <Send size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
