import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, CardContent, CardIcon, EmptyState, Spinner } from '@brandforge/ui';
import { FolderKanban, Megaphone, Coins, Plus, Star, ArrowRight, Coffee, Rocket, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { get } from '@/lib/api';
import type { Campaign, Project, Workspace } from '@/lib/types';
import { NewCampaignModal } from '@/components/NewCampaignModal';

interface RecentCampaign extends Campaign {
  projectName: string;
  projectId: string;
}

const templateMeta = [
  { key: 'template1', icon: <Coffee size={20} /> },
  { key: 'template2', icon: <Rocket size={20} /> },
  { key: 'template3', icon: <UtensilsCrossed size={20} /> },
];

export function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recent, setRecent] = useState<RecentCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { workspaces } = await get<{ workspaces: Workspace[] }>('/api/v1/workspaces');
      const ws = workspaces[0] ?? null;
      setWorkspace(ws);
      if (!ws) {
        setProjects([]);
        setRecent([]);
        return;
      }
      const { projects } = await get<{ projects: Project[] }>(`/api/v1/projects?workspaceId=${ws.id}`);
      setProjects(projects);
      const all: RecentCampaign[] = [];
      for (const p of projects) {
        try {
          const { campaigns } = await get<{ campaigns: Campaign[] }>(`/api/v1/projects/${p.id}/campaigns`);
          for (const c of campaigns) all.push({ ...c, projectName: p.name, projectId: p.id });
        } catch {
          // one failing project must not break the dashboard
        }
      }
      all.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      setRecent(all.slice(0, 5));
    } catch {
      setProjects([]);
      setRecent([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const favorites = useMemo(() => projects.filter((p) => p.isFavorite), [projects]);
  const campaignCount = useMemo(() => projects.reduce((n, p) => n + (p.campaignCount ?? 0), 0), [projects]);
  const demoProjectId = projects[0]?.id;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-violet-600">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            {t('dashboard.greeting', { name: user?.name.split(' ')[0] ?? '' })}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {workspace ? `${t('dashboard.workspaceLabel')}: ${workspace.name}` : t('dashboard.subtitle')}
          </p>
        </div>
        <Button icon={<Plus size={17} />} onClick={() => setModalOpen(true)}>
          {t('dashboard.newCampaign')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-4">
          <CardIcon tone="violet"><FolderKanban size={20} /></CardIcon>
          <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{projects.length}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.statsProjects')}</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4">
          <CardIcon tone="amber"><Megaphone size={20} /></CardIcon>
          <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{campaignCount}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.statsCampaigns')}</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4" title={t('dashboard.creditsHint')}>
          <CardIcon tone="emerald"><Coins size={20} /></CardIcon>
          <div><p className="text-2xl font-bold text-slate-400 dark:text-slate-500">{t('dashboard.creditsPlaceholder')}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.statsCredits')}</p></div>
        </CardContent></Card>
      </div>

      {/* Templates */}
      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('dashboard.templatesTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {templateMeta.map((tpl, i) => (
            <Card key={tpl.key} className="p-5 transition-transform hover:-translate-y-0.5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                {tpl.icon}
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t(`dashboard.${tpl.key}Title`)}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t(`dashboard.${tpl.key}Desc`)}</p>
              {i === 0 && demoProjectId ? (
                <Link to={`/app/projects/${demoProjectId}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
                  {t('dashboard.openDemoProject')} <ArrowRight size={15} />
                </Link>
              ) : (
                <button onClick={() => setModalOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
                  {t('dashboard.useTemplate')} <ArrowRight size={15} />
                </button>
              )}
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent campaigns */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('dashboard.recentCampaigns')}</h2>
          <Card>
            {recent.length === 0 ? (
              <EmptyState icon={<Megaphone size={26} />} title={t('dashboard.noCampaigns')} description={t('dashboard.noCampaignsDesc')} action={<Button size="sm" icon={<Plus size={15} />} onClick={() => setModalOpen(true)}>{t('dashboard.newCampaign')}</Button>} />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {recent.map((c) => (
                  <li key={c.id}>
                    <Link to={`/app/projects/${c.projectId}`} className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{c.name}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.projectName}</p>
                      </div>
                      <Badge tone={c.status === 'active' ? 'emerald' : 'slate'}>{c.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* Favorites */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('dashboard.favorites')}</h2>
          <Card>
            {favorites.length === 0 ? (
              <EmptyState icon={<Star size={26} />} title={t('dashboard.noFavorites')} description={t('dashboard.noFavoritesDesc')} />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {favorites.map((p) => (
                  <li key={p.id}>
                    <Link to={`/app/projects/${p.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Star size={15} className="shrink-0 fill-amber-400 text-amber-400" />
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{p.name}</p>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t('dashboard.viewWorkspace')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <NewCampaignModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={(id) => navigate(`/app/projects/${id}`)} />
    </div>
  );
}
