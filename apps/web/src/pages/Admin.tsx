import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Button, Card, CardContent, CardHeader, EmptyState, Input, Spinner } from '@brandforge/ui';
import { Users, UserCheck, UserX, FlaskConical, Megaphone, Cpu, AlertTriangle, Search, ShieldCheck } from 'lucide-react';
import { get, patch, post } from '@/lib/api';
import type { AdminOverview, AdminUser, AuditLog } from '@/lib/types';

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone: 'violet' | 'emerald' | 'red' | 'amber' | 'sky' }) {
  const tones: Record<string, string> = {
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  };
  return (
    <Card><CardContent className="flex items-center gap-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </CardContent></Card>
  );
}

export function Admin() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const limit = 10;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, us, lg] = await Promise.all([
        get<AdminOverview>('/api/v1/admin/overview'),
        get<{ users: AdminUser[]; total: number }>(`/api/v1/admin/users?search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`),
        get<{ logs: AuditLog[] }>('/api/v1/admin/audit-logs?limit=20'),
      ]);
      setOverview(ov);
      setUsers(us.users ?? []);
      setTotal(us.total ?? 0);
      setLogs(lg.logs ?? []);
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setActing(id);
    try {
      await fn();
      await load();
    } finally {
      setActing(null);
    }
  };

  const toggleBlock = (u: AdminUser) =>
    act(u.id, () =>
      window.confirm(t('admin.blockConfirm'))
        ? post(`/api/v1/admin/users/${u.id}/${u.status === 'blocked' ? 'unblock' : 'block'}`)
        : Promise.resolve(),
    );

  const toggleAdmin = (u: AdminUser) =>
    act(u.id, () => patch(`/api/v1/admin/users/${u.id}/admin`, { isAdmin: !u.isAdmin }));

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">{t('admin.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('admin.subtitle')}</p>
        <div className="mt-3 inline-flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" />
          {t('admin.phase5Note')}
        </div>
      </div>

      {loading && !overview ? (
        <div className="flex h-40 items-center justify-center text-violet-600"><Spinner size="lg" /></div>
      ) : overview ? (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{t('admin.overview')}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon={<Users size={18} />} label={t('admin.usersTotal')} value={overview.usersTotal} tone="violet" />
              <StatCard icon={<UserCheck size={18} />} label={t('admin.usersActive')} value={overview.usersActive} tone="emerald" />
              <StatCard icon={<UserX size={18} />} label={t('admin.usersBlocked')} value={overview.usersBlocked} tone="red" />
              <StatCard icon={<FlaskConical size={18} />} label={t('admin.demoActive')} value={overview.demoActive} tone="amber" />
              <StatCard icon={<Megaphone size={18} />} label={t('admin.campaignsTotal')} value={overview.campaignsTotal} tone="violet" />
              <StatCard icon={<Cpu size={18} />} label={t('admin.agentRunsTotal')} value={overview.agentRunsTotal} tone="emerald" />
              <StatCard icon={<AlertTriangle size={18} />} label={t('admin.errorsLast24h')} value={overview.errorsLast24h} tone="red" />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{t('admin.usersTitle')}</h2>
            <Card>
              <CardHeader>
                <form
                  className="flex max-w-sm items-center gap-2"
                  onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }}
                >
                  <Input placeholder={t('admin.searchPlaceholder')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label={t('common.search')} />
                  <Button type="submit" size="sm" variant="secondary" aria-label={t('common.search')}><Search size={16} /></Button>
                </form>
              </CardHeader>
              <CardContent className="!pt-0">
                {/* Desktop table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-slate-800">
                        <th className="pb-2 pr-4 font-medium">{t('admin.colUser')}</th>
                        <th className="pb-2 pr-4 font-medium">{t('admin.colStatus')}</th>
                        <th className="pb-2 pr-4 font-medium">{t('admin.colRole')}</th>
                        <th className="pb-2 pr-4 font-medium">{t('admin.colCreated')}</th>
                        <th className="pb-2 text-right font-medium">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={u.name} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900 dark:text-white">{u.name}</p>
                                <p className="truncate text-xs text-slate-400">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge tone={u.status === 'blocked' ? 'red' : u.status === 'active' ? 'emerald' : 'slate'}>{u.status}</Badge>
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex gap-1">
                              {u.isAdmin && <Badge tone="violet">{t('admin.roleAdmin')}</Badge>}
                              {u.isDemo && <Badge tone="amber">{t('admin.roleDemo')}</Badge>}
                              {!u.isAdmin && !u.isDemo && <Badge tone="slate">{t('admin.roleUser')}</Badge>}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" variant="ghost" loading={acting === u.id} onClick={() => void toggleBlock(u)}>
                                {u.status === 'blocked' ? t('admin.unblock') : t('admin.block')}
                              </Button>
                              <Button size="sm" variant="ghost" loading={acting === u.id} onClick={() => void toggleAdmin(u)}>
                                {u.isAdmin ? t('admin.removeAdmin') : t('admin.makeAdmin')}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {users.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{t('admin.noUsers')}</p>}
                </div>

                {/* Mobile cards */}
                <div className="space-y-3 md:hidden">
                  {users.map((u) => (
                    <div key={u.id} className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-700">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{u.name}</p>
                          <p className="truncate text-xs text-slate-400">{u.email}</p>
                        </div>
                        <Badge tone={u.status === 'blocked' ? 'red' : u.status === 'active' ? 'emerald' : 'slate'}>{u.status}</Badge>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="secondary" className="flex-1" loading={acting === u.id} onClick={() => void toggleBlock(u)}>
                          {u.status === 'blocked' ? t('admin.unblock') : t('admin.block')}
                        </Button>
                        <Button size="sm" variant="secondary" className="flex-1" loading={acting === u.id} onClick={() => void toggleAdmin(u)}>
                          {u.isAdmin ? t('admin.removeAdmin') : t('admin.makeAdmin')}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {users.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{t('admin.noUsers')}</p>}
                </div>

                {pages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>←</Button>
                    <span className="text-xs text-slate-400">{page} / {pages}</span>
                    <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>→</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{t('admin.auditTitle')}</h2>
            <Card>
              {logs.length === 0 ? (
                <EmptyState title={t('admin.auditEmpty')} />
              ) : (
                <ul className="divide-y divide-slate-100 px-5 dark:divide-slate-800">
                  {logs.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="truncate font-mono text-xs text-slate-600 dark:text-slate-300">{l.action}</span>
                      <span className="shrink-0 text-xs text-slate-400">{new Date(l.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}
