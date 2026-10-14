import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, EmptyState, Spinner } from '@brandforge/ui';
import { ExternalLink, Globe2, Monitor, RefreshCw, Smartphone, Sparkles, Tablet } from 'lucide-react';
import { apiUrl, get } from '@/lib/api';
import type { LandingPage } from '@/lib/types';

type Device = 'desktop' | 'tablet' | 'mobile';

const frameWidths: Record<Device, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
};

const deviceIcons = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
};

export function LandingStudio({ projectId, onOpenChat }: { projectId: string; onOpenChat: () => void }) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const selected = useMemo(
    () => pages.find((page) => page.id === selectedId) ?? null,
    [pages, selectedId],
  );

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await get<{ landingPages: LandingPage[] }>(
        `/api/v1/projects/${projectId}/landing-pages`,
      );
      const nextPages = response.landingPages ?? [];
      setPages(nextPages);
      setSelectedId((current) =>
        current && nextPages.some((page) => page.id === current)
          ? current
          : nextPages.at(-1)?.id ?? null,
      );
    } catch {
      setError(true);
      setPages([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  useEffect(() => {
    if (!selectedId) {
      setHtml('');
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    setError(false);
    fetch(apiUrl(`/api/v1/landing-pages/${selectedId}/preview`), {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Preview request failed: ${response.status}`);
        return response.text();
      })
      .then(setHtml)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setError(true);
          setHtml('');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, refreshKey]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-violet-600"><Spinner size="lg" /></div>;
  }

  if (pages.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Globe2 size={28} />}
          title={t('workspace.landingEmpty')}
          description={error ? t('workspace.landingLoadError') : t('workspace.landingEmptyDescription')}
          action={<Button onClick={onOpenChat} icon={<Sparkles size={16} />}>{t('workspace.landingAskAgent')}</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{t('workspace.landingTitle')}</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('workspace.landingDescription')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
            {(['desktop', 'tablet', 'mobile'] as const).map((item) => {
              const Icon = deviceIcons[item];
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setDevice(item)}
                  aria-label={t(`workspace.landing${item[0].toUpperCase()}${item.slice(1)}`)}
                  aria-pressed={device === item}
                  className={`rounded-lg p-2 transition-colors ${device === item ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw size={15} />}
            onClick={() => setRefreshKey((key) => key + 1)}
          >
            {t('workspace.landingRefresh')}
          </Button>
          {selected && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ExternalLink size={15} />}
              onClick={() => window.open(
                apiUrl(`/api/v1/landing-pages/${selected.id}/preview`),
                '_blank',
                'noopener,noreferrer',
              )}
            >
              {t('workspace.landingOpen')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[190px_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-2">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {t('workspace.landingPagesLabel')}
            </p>
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setSelectedId(page.id)}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${selectedId === page.id ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                <span className="block truncate font-medium">{page.name}</span>
                <span className={`mt-0.5 block text-xs ${selectedId === page.id ? 'text-violet-100' : 'text-slate-400'}`}>
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(page.updatedAt ?? page.createdAt))}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-200/60 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="relative mx-auto min-h-[620px] overflow-hidden rounded-xl bg-white shadow-xl transition-[width] duration-300" style={{ width: frameWidths[device], maxWidth: '100%' }}>
            {previewLoading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-violet-600 backdrop-blur-sm"><Spinner size="lg" /></div>
            ) : null}
            {error ? (
              <div className="flex min-h-[620px] items-center justify-center p-8 text-center text-sm text-slate-500">{t('workspace.landingLoadError')}</div>
            ) : (
              <iframe
                title={selected?.name ?? t('workspace.landingTitle')}
                srcDoc={html}
                sandbox="allow-same-origin"
                className="h-[620px] w-full border-0 bg-white"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
