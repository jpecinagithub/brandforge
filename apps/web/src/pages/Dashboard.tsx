import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, CardContent, CardIcon, EmptyState, Spinner } from '@brandforge/ui';
import { Image as ImageIcon, Megaphone, Plus, Star, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { del, get, patch } from '@/lib/api';
import type { Campaign, Project, Workspace } from '@/lib/types';
import { NewCampaignModal } from '@/components/NewCampaignModal';

interface RecentCampaign extends Campaign {
  projectId: string;
}

export function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [campaigns, setCampaigns] = useState<RecentCampaign[]>([]);
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
        setCampaigns([]);
        return;
      }
      const { projects } = await get<{ projects: Project[] }>(`/api/v1/projects?workspaceId=${ws.id}`);
      setProjects(projects);
      const perProject = await Promise.all(projects.map(async (p) => {
        try {
          const response = await get<{ campaigns: Campaign[] }>(`/api/v1/projects/${p.id}/campaigns`);
          const campaign = response.campaigns[0];
          return campaign ? [{ ...campaign, projectId: p.id }] : [];
        } catch {
          return [];
        }
      }));
      const all = perProject.flat();
      all.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      setCampaigns(all);
    } catch {
      setProjects([]);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const favorites = useMemo(() => campaigns.filter((campaign) => campaign.isFavorite), [campaigns]);
  const assetCount = useMemo(() => projects.reduce((total, project) => total + (project.assetCount ?? 0), 0), [projects]);
  const toggleCampaignFavorite = async (campaign: RecentCampaign) => {
    const favorite = !campaign.isFavorite;
    setCampaigns((current) => current.map((item) => item.id === campaign.id ? { ...item, isFavorite: favorite } : item));
    try {
      const response = await patch<{ campaign: Campaign }>(`/api/v1/campaigns/${campaign.id}`, { isFavorite: favorite });
      setCampaigns((current) => current.map((item) => item.id === campaign.id ? { ...item, ...response.campaign } : item));
    } catch {
      setCampaigns((current) => current.map((item) => item.id === campaign.id ? { ...item, isFavorite: campaign.isFavorite } : item));
    }
  };

  const deleteCampaign = async (campaign: RecentCampaign) => {
    if (!window.confirm(t('dashboard.deleteCampaignConfirm', { name: campaign.name }))) return;
    try {
      await del(`/api/v1/projects/${campaign.projectId}`);
      setCampaigns((current) => current.filter((item) => item.projectId !== campaign.projectId));
      setProjects((current) => current.filter((project) => project.id !== campaign.projectId));
    } catch {
      window.alert(t('dashboard.deleteCampaignError'));
    }
  };

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
          <CardIcon tone="violet"><Megaphone size={20} /></CardIcon>
          <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{campaigns.length}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.statsCampaigns')}</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4">
          <CardIcon tone="amber"><ImageIcon size={20} /></CardIcon>
          <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{assetCount}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.statsAssets')}</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4">
          <CardIcon tone="emerald"><Star size={20} /></CardIcon>
          <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{favorites.length}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.statsFavorites')}</p></div>
        </CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent campaigns */}
        <section>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">{t('dashboard.allCampaigns')}</h2>
          <Card>
            {campaigns.length === 0 ? (
              <EmptyState icon={<Megaphone size={26} />} title={t('dashboard.noCampaigns')} description={t('dashboard.noCampaignsDesc')} action={<Button size="sm" icon={<Plus size={15} />} onClick={() => setModalOpen(true)}>{t('dashboard.newCampaign')}</Button>} />
            ) : (
              <ul className="slim-scroll max-h-[30rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {campaigns.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Link to={`/app/campaigns/${c.projectId}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{c.name}</p>
                        {c.objective ? <p className="truncate text-xs text-slate-500 dark:text-slate-400">{c.objective}</p> : null}
                      </div>
                      <Badge tone={c.status === 'active' ? 'emerald' : 'slate'}>{c.status}</Badge>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void toggleCampaignFavorite(c)}
                      aria-pressed={c.isFavorite}
                      aria-label={t(c.isFavorite ? 'workspace.unfavoriteCampaign' : 'workspace.favoriteCampaign', { name: c.name })}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-amber-400/10"
                    >
                      <Star size={17} className={c.isFavorite ? 'fill-amber-400 text-amber-400' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCampaign(c)}
                      aria-label={t('dashboard.deleteCampaign', { name: c.name })}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    >
                      <Trash2 size={17} />
                    </button>
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
                {favorites.map((campaign) => (
                  <li key={campaign.id} className="flex items-center gap-2 px-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Link to={`/app/campaigns/${campaign.projectId}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2 py-3.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Star size={15} className="shrink-0 fill-amber-400 text-amber-400" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{campaign.name}</p>
                          {campaign.objective ? <p className="truncate text-xs text-slate-500 dark:text-slate-400">{campaign.objective}</p> : null}
                        </div>
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={() => void toggleCampaignFavorite(campaign)}
                      aria-label={t('workspace.unfavoriteCampaign', { name: campaign.name })}
                      className="rounded-lg p-2 text-amber-500 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-amber-400/10"
                    >
                      <Star size={17} className="fill-amber-400 text-amber-400" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      <NewCampaignModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={(id) => navigate(`/app/campaigns/${id}`)} />
    </div>
  );
}
