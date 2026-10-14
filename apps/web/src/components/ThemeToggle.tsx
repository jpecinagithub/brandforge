import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from 'react-i18next';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const { t } = useTranslation();
  const dark = theme === 'dark';

  return (
    <button
      onClick={toggle}
      aria-label={dark ? t('common.light') : t('common.dark')}
      title={dark ? t('common.light') : t('common.dark')}
      className={`flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 ${className}`}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
