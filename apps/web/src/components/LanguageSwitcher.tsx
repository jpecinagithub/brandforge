import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = i18n.language.startsWith('es') ? 'es' : 'en';

  return (
    <div className={`flex items-center gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-700 ${className}`} role="group" aria-label="Language">
      <Globe size={14} className="ml-1 text-slate-400" aria-hidden="true" />
      {(['en', 'es'] as const).map((lng) => (
        <button
          key={lng}
          onClick={() => void i18n.changeLanguage(lng)}
          aria-pressed={current === lng}
          className={`rounded-lg px-2 py-1 text-xs font-semibold transition-colors ${
            current === lng
              ? 'bg-violet-600 text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
          }`}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
