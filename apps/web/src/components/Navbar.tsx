import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@brandforge/ui';
import { Logo } from './Logo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';

export function Navbar() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl dark:border-slate-800/60 dark:bg-slate-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex dark:text-slate-300" aria-label="Primary">
          <a href="#features" className="transition-colors hover:text-violet-600 dark:hover:text-violet-400">{t('nav.features')}</a>
          <a href="#examples" className="transition-colors hover:text-violet-600 dark:hover:text-violet-400">{t('nav.examples')}</a>
          <a href="#pricing" className="transition-colors hover:text-violet-600 dark:hover:text-violet-400">{t('nav.pricing')}</a>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher className="hidden sm:flex" />
          <ThemeToggle />
          <Link to="/login" className="hidden sm:block">
            <Button variant="ghost" size="sm">{t('nav.login')}</Button>
          </Link>
          <Link to="/register">
            <Button size="sm">{t('nav.startCreating')}</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
