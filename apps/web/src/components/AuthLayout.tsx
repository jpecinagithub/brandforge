import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-md flex-col px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center py-10">
          <div className="w-full">{children}</div>
        </div>
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          <Link to="/" className="hover:text-violet-600 dark:hover:text-violet-400">BrandForge AI</Link>
        </p>
      </div>
    </div>
  );
}
