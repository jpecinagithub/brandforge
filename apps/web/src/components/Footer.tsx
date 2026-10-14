import { useTranslation } from 'react-i18next';
import { Logo } from './Logo';

export function Footer() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-slate-500 dark:text-slate-400">{t('landing.footerTagline')}</p>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{t('landing.footerProduct')}</h4>
            <ul className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
              <li><a href="#features" className="hover:text-violet-600 dark:hover:text-violet-400">{t('nav.features')}</a></li>
              <li><a href="#pricing" className="hover:text-violet-600 dark:hover:text-violet-400">{t('nav.pricing')}</a></li>
              <li><a href="#examples" className="hover:text-violet-600 dark:hover:text-violet-400">{t('nav.examples')}</a></li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{t('landing.footerContact')}</h4>
            <ul className="space-y-2 text-sm text-slate-500 dark:text-slate-400">
              <li><a href="mailto:jpecina@gmail.com" className="hover:text-violet-600 dark:hover:text-violet-400">jpecina@gmail.com</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500 sm:flex-row dark:border-slate-800 dark:text-slate-500">
          <span>© {year} BrandForge AI. {t('common.rights')}</span>
          <span className="font-medium">{t('common.developedBy')}</span>
        </div>
      </div>
    </footer>
  );
}
