import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { consumePwaUpdatedNotice } from '@/pwa';

export function PwaUpdatedNotice() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(consumePwaUpdatedNotice);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-5 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-800 shadow-xl dark:border-emerald-500/20 dark:bg-slate-900 dark:text-emerald-200"
      role="status"
      aria-live="polite"
    >
      <CheckCircle2 size={17} className="shrink-0" />
      <span>{t('common.appUpdated')}</span>
    </div>
  );
}
