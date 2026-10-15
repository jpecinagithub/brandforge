import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Button } from '@brandforge/ui';
import { LayoutDashboard, User, ShieldCheck, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Logo } from '@/components/Logo';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DemoBanner } from '@/components/DemoBanner';
import { mediaUrl } from '@/lib/api';

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { to: '/app', label: t('nav.dashboard'), icon: <LayoutDashboard size={18} />, end: true },
    { to: '/app/profile', label: t('nav.profile'), icon: <User size={18} /> },
    ...(user?.isAdmin ? [{ to: '/app/admin', label: t('nav.admin'), icon: <ShieldCheck size={18} /> }] : []),
  ];

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-violet-600/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
    }`;

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Slim sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex dark:border-slate-800 dark:bg-slate-900">
        <Logo />
        <nav className="mt-8 flex flex-col gap-1" aria-label="App">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkCls}>
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-4">
          <LanguageSwitcher />
          <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">{t('common.developedBy')}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/80 backdrop-blur-xl dark:border-slate-800/60 dark:bg-slate-950/80">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={() => setMenuOpen(true)}
                aria-label="Menu"
              >
                <Menu size={20} />
              </button>
              <div className="lg:hidden"><Logo compact /></div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              {user && (
                <div className="relative">
                  <Link to="/app/profile" className="flex items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Avatar name={user.name} src={mediaUrl(user.avatarUrl)} size="sm" />
                    <span className="hidden max-w-32 truncate text-sm font-medium text-slate-700 sm:block dark:text-slate-200">
                      {user.name}
                    </span>
                  </Link>
                </div>
              )}
              <Button variant="ghost" size="sm" icon={<LogOut size={15} />} onClick={handleLogout} className="hidden sm:inline-flex">
                {t('nav.logout')}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="sm:hidden" aria-label={t('nav.logout')}>
                <LogOut size={17} />
              </Button>
            </div>
          </div>
          <DemoBanner />
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
          <div className="mx-auto min-w-0 max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white p-4 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <Logo />
              <button
                onClick={() => setMenuOpen(false)}
                aria-label={t('common.close')}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="mt-6 flex flex-col gap-1" aria-label="App">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={linkCls} onClick={() => setMenuOpen(false)}>
                  {item.icon}
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
