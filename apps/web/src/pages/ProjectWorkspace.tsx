import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, CardContent, EmptyState, Input, Modal, Spinner } from '@brandforge/ui';
import {
  ArrowLeft, Check, Download, FolderKanban, ImagePlus, Megaphone,
  Pencil, Plus, Star, Trash2,
} from 'lucide-react';
import { del, get, patch, post, put, assetUrl, ApiError } from '@/lib/api';
import type { Asset, BrandKit, Campaign, Project } from '@/lib/types';

type Tab = 'overview' | 'campaigns' | 'brandkit' | 'assets' | 'landing';
type MobileView = 'sidebar' | 'canvas' | 'chat';

const tabs: Tab[] = ['overview', 'campaigns', 'brandkit', 'assets', 'landing'];

const tabLabels: Record<Tab, string> = {
  overview: 'workspace.tabOverview',
  campaigns: 'workspace.tabCampaigns',
  brandkit: 'workspace.tabBrandKit',
  assets: 'workspace.tabAssets',
  landing: 'workspace.tabLanding',
};

import { ChatPanel } from '@/components/chat/ChatPanel';
import { LandingStudio } from '@/components/workspace/LandingStudio';

/* ------------------------------ Campaigns tab ------------------------------ */

function CampaignsTab({ projectId, onCountChange }: { projectId: string; onCountChange: () => void }) {
  const { t } = useTranslation();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ campaigns: Campaign[] }>(`/api/v1/projects/${projectId}/campaigns`);
      setCampaigns(res.campaigns ?? []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (name.trim().length < 2 || creating) return;
    setCreating(true);
    try {
      const res = await post<{ campaign: Campaign }>(`/api/v1/projects/${projectId}/campaigns`, {
        name: name.trim(),
        objective: objective.trim() || undefined,
      });
      setCampaigns((c) => [res.campaign, ...c]);
      setName('');
      setObjective('');
      onCountChange();
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('workspace.deleteCampaignConfirm'))) return;
    setDeletingId(id);
    try {
      await del(`/api/v1/campaigns/${id}`);
      setCampaigns((c) => c.filter((x) => x.id !== id));
      onCountChange();
    } finally {
      setDeletingId(null);
    }
  };

  const toggleFavorite = async (campaign: Campaign) => {
    if (favoriteId) return;
    const favorite = !campaign.isFavorite;
    setFavoriteId(campaign.id);
    setCampaigns((current) => current.map((item) => item.id === campaign.id ? { ...item, isFavorite: favorite } : item));
    try {
      const response = await patch<{ campaign: Campaign }>(`/api/v1/campaigns/${campaign.id}`, { isFavorite: favorite });
      setCampaigns((current) => current.map((item) => item.id === campaign.id ? response.campaign : item));
    } catch {
      setCampaigns((current) => current.map((item) => item.id === campaign.id ? campaign : item));
    } finally {
      setFavoriteId(null);
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-violet-600"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('newCampaignModal.projectNamePlaceholder')} />
          <Input label={`${t('workspace.campaignObjective')} (${t('common.optional')})`} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={t('newCampaignModal.objectivePlaceholder')} />
          <Button onClick={create} loading={creating} icon={<Plus size={16} />} className="sm:mb-0.5">{t('workspace.campaignsNew')}</Button>
        </div>
      </CardContent></Card>

      {campaigns.length === 0 ? (
        <Card><EmptyState icon={<Megaphone size={26} />} title={t('workspace.campaignsEmpty')} /></Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((c) => (
            <Card key={c.id}><CardContent className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
                {c.objective && <p className="mt-0.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{c.objective}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleFavorite(c)}
                  disabled={favoriteId !== null}
                  aria-pressed={c.isFavorite}
                  aria-label={t(c.isFavorite ? 'workspace.unfavoriteCampaign' : 'workspace.favoriteCampaign', { name: c.name })}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 dark:hover:bg-amber-400/10"
                >
                  {favoriteId === c.id ? <Spinner size="sm" /> : <Star size={17} className={c.isFavorite ? 'fill-amber-400 text-amber-400' : ''} />}
                </button>
                <Badge tone={c.status === 'active' ? 'emerald' : 'slate'}>{c.status}</Badge>
                <button
                  onClick={() => void remove(c.id)}
                  disabled={deletingId === c.id}
                  aria-label={t('common.delete')}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
                  {deletingId === c.id ? <Spinner size="sm" /> : <Trash2 size={16} />}
                </button>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Brand kit tab ------------------------------ */

const emptyBrandKit: BrandKit = { brandName: '', tagline: '', description: '', colors: [], fonts: [], tone: '', audience: '' };

function BrandKitTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [kit, setKit] = useState<BrandKit>(emptyBrandKit);
  const [colorsText, setColorsText] = useState('');
  const [fontsText, setFontsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    get<{ brandKit: BrandKit }>(`/api/v1/projects/${projectId}/brand-kit`)
      .then((res) => {
        setKit({ ...emptyBrandKit, ...res.brandKit });
        setColorsText((res.brandKit.colors ?? []).join(', '));
        setFontsText((res.brandKit.fonts ?? []).join(', '));
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 404)) {
          // keep empty form; other errors surfaced by retry below
        }
        setKit(emptyBrandKit);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const payload = {
        ...kit,
        colors: colorsText.split(',').map((s) => s.trim()).filter(Boolean),
        fonts: fontsText.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const res = await put<{ brandKit: BrandKit }>(`/api/v1/projects/${projectId}/brand-kit`, payload);
      setKit({ ...emptyBrandKit, ...res.brandKit });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-violet-600"><Spinner /></div>;

  const set = (k: keyof BrandKit, v: string) => setKit((prev) => ({ ...prev, [k]: v }));
  const hasBrandKit = Boolean(
    kit.id || kit.brandName || kit.tagline || kit.description || kit.tone || kit.audience
      || colorsText.trim() || fontsText.trim(),
  );
  const colorSwatches = colorsText
    .split(',')
    .map((color) => color.trim())
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color));

  return (
    <Card><CardContent className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {t(hasBrandKit ? 'workspace.brandKitHint' : 'workspace.brandKitEmpty')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('workspace.brandKitBrandName')} value={kit.brandName ?? ''} onChange={(e) => set('brandName', e.target.value)} />
        <Input label={t('workspace.brandKitTagline')} value={kit.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{t('workspace.brandKitDescription')}</label>
        <textarea rows={3} value={kit.description ?? ''} onChange={(e) => set('description', e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Input label={t('workspace.brandKitColors')} value={colorsText} onChange={(e) => setColorsText(e.target.value)} placeholder="#7C3AED, #F59E0B" />
          {colorSwatches.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" aria-hidden="true">
              {colorSwatches.map((color) => (
                <span key={color} className="h-7 w-7 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: color }} />
              ))}
            </div>
          )}
        </div>
        <Input label={t('workspace.brandKitFonts')} value={fontsText} onChange={(e) => setFontsText(e.target.value)} placeholder="Inter, Georgia" />
        <Input label={t('workspace.brandKitTone')} value={kit.tone ?? ''} onChange={(e) => set('tone', e.target.value)} />
        <Input label={t('workspace.brandKitAudience')} value={kit.audience ?? ''} onChange={(e) => set('audience', e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving} icon={!saving ? <Check size={16} /> : undefined}>{t('workspace.brandKitSave')}</Button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('workspace.brandKitSaved')}</span>}
      </div>
    </CardContent></Card>
  );
}

/* ------------------------------ Assets tab ------------------------------ */

function AssetsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ assets: Asset[] }>(`/api/v1/projects/${projectId}/assets`);
      setAssets(res.assets ?? []);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('projectId', projectId);
      form.append('file', file);
      const res = await post<{ asset: Asset }>('/api/v1/assets', form);
      setAssets((a) => [res.asset, ...a]);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="flex h-40 items-center justify-center text-violet-600"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <Card><CardContent>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{t('workspace.assetsHint')}</p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-600/25 transition-colors hover:bg-violet-500">
          {uploading ? <Spinner size="sm" /> : <ImagePlus size={16} />}
          {t('workspace.assetsUpload')}
          <input type="file" className="hidden" disabled={uploading} onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }} />
        </label>
      </CardContent></Card>

      {assets.length === 0 ? (
        <Card><EmptyState icon={<ImagePlus size={26} />} title={t('workspace.assetsEmpty')} /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((a) => (
            <Card key={a.id} className="overflow-hidden">
              <a href={assetUrl(a)} target="_blank" rel="noreferrer" className="block">
                {a.mime.startsWith('image/') ? (
                  <img src={assetUrl(a)} alt={a.originalName} className="h-32 w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-32 items-center justify-center bg-slate-100 text-slate-400 dark:bg-slate-800">
                    <ImagePlus size={28} />
                  </div>
                )}
                <p className="truncate px-3 py-2 text-xs text-slate-600 dark:text-slate-300" title={a.originalName}>{a.originalName}</p>
              </a>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Workspace page ------------------------------ */

export function ProjectWorkspace() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [siblings, setSiblings] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [mobileView, setMobileView] = useState<MobileView>('canvas');
  const [chatDraftRequest, setChatDraftRequest] = useState<{ id: number; text: string } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadProject = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ project: Project }>(`/api/v1/projects/${id}`);
      setProject(res.project);
      setNameDraft(res.project.name);
      setDescDraft(res.project.description ?? '');
      const sib = await get<{ projects: Project[] }>(`/api/v1/projects?workspaceId=${res.project.workspaceId}`);
      setSiblings(sib.projects ?? []);
    } catch {
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadProject(); }, [loadProject]);

  const saveProject = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const res = await patch<{ project: Project }>(`/api/v1/projects/${project.id}`, {
        name: nameDraft.trim() || project.name,
        description: descDraft.trim(),
      });
      setProject(res.project);
      setNameDraft(res.project.name);
      setDescDraft(res.project.description ?? '');
      setEditingName(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const createProject = async () => {
    if (!project || newProjectName.trim().length < 2) return;
    const res = await post<{ project: Project }>('/api/v1/projects', {
      workspaceId: project.workspaceId,
      name: newProjectName.trim(),
    });
    setNewProjectOpen(false);
    setNewProjectName('');
    navigate(`/app/projects/${res.project.id}`);
  };

  const deleteProject = async () => {
    if (!project) return;
    await del(`/api/v1/projects/${project.id}`);
    navigate('/app');
  };

  const prepareLandingRequest = () => {
    setChatDraftRequest({ id: Date.now(), text: t('workspace.landingAgentPrompt') });
    setMobileView('chat');
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-violet-600"><Spinner size="lg" /></div>;
  }

  if (!project) {
    return (
      <Card><EmptyState
        icon={<FolderKanban size={26} />}
        title={t('errors.notFound')}
        action={<Link to="/app"><Button variant="secondary">{t('common.back')}</Button></Link>}
      /></Card>
    );
  }

  const sidebar = (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('workspace.projects')}</h3>
        <button onClick={() => setNewProjectOpen(true)} aria-label={t('workspace.newProject')}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800">
          <Plus size={17} />
        </button>
      </div>
      <div className="slim-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {siblings.map((p) => (
          <Link
            key={p.id}
            to={`/app/projects/${p.id}`}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              p.id === project.id
                ? 'bg-violet-600/10 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <FolderKanban size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );

  const canvas = (
    <div className="flex h-full min-h-0 flex-col">
      {/* Topbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-slate-800">
        <Link to="/app" aria-label={t('common.back')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <ArrowLeft size={17} />
        </Link>
        {editingName ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} aria-label={t('workspace.projectNameLabel')} className="!py-1.5" />
            <Button size="sm" onClick={saveProject} loading={saving} icon={!saving ? <Check size={15} /> : undefined}>{t('workspace.save')}</Button>
          </div>
        ) : (
          <button onClick={() => setEditingName(true)} className="group flex min-w-0 flex-1 items-center gap-2 text-left" title={t('common.edit')}>
            <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{project.name}</h2>
            <Pencil size={14} className="shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-slate-600" />
          </button>
        )}
        <div className="flex items-center gap-1.5">
          {savedTick && <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('workspace.saved')}</span>}
          <span title={t('workspace.exportTooltip')}>
            <Button size="sm" variant="secondary" icon={<Download size={15} />} disabled className="cursor-not-allowed">
              {t('workspace.export')}
            </Button>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:px-5 dark:border-slate-800" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              tab === tb
                ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t(tabLabels[tb])}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="slim-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
        {tab === 'overview' && (
          <div className="space-y-4">
            <Card><CardContent className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{t('workspace.overviewDescription')}</label>
                <textarea rows={3} value={descDraft} onChange={(e) => setDescDraft(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              </div>
              <Button size="sm" onClick={saveProject} loading={saving}>{t('common.save')}</Button>
            </CardContent></Card>
            <div className="grid grid-cols-2 gap-3">
              <Card><CardContent className="text-center">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{project.campaignCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('workspace.overviewCampaigns')}</p>
              </CardContent></Card>
              <Card><CardContent className="text-center">
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{project.assetCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('workspace.overviewAssets')}</p>
              </CardContent></Card>
            </div>
            <Card><CardContent>
              <button onClick={() => setDeleteOpen(true)} className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-500 dark:text-red-400">
                <Trash2 size={15} /> {t('workspace.deleteProject')}
              </button>
            </CardContent></Card>
          </div>
        )}
        {tab === 'campaigns' && <CampaignsTab projectId={project.id} onCountChange={loadProject} />}
        {tab === 'brandkit' && <BrandKitTab projectId={project.id} />}
        {tab === 'assets' && <AssetsTab projectId={project.id} />}
        {tab === 'landing' && <LandingStudio projectId={project.id} onOpenChat={prepareLandingRequest} />}
      </div>
    </div>
  );

  const chat = <ChatPanel projectId={project.id} draftRequest={chatDraftRequest} />;

  const mobileTabs: { key: MobileView; label: string }[] = [
    { key: 'sidebar', label: t('workspace.mobileSidebar') },
    { key: 'canvas', label: t('workspace.mobileCanvas') },
    { key: 'chat', label: t('workspace.mobileChat') },
  ];

  return (
    <div className="min-w-0 overflow-hidden -m-4 sm:-m-6 lg:-m-8">
      {/* Mobile column switcher */}
      <div className="flex gap-1 border-b border-slate-200 bg-white p-2 lg:hidden dark:border-slate-800 dark:bg-slate-950" role="tablist" aria-label="Workspace views">
        {mobileTabs.map((mv) => (
          <button
            key={mv.key}
            role="tab"
            aria-selected={mobileView === mv.key}
            onClick={() => setMobileView(mv.key)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              mobileView === mv.key
                ? 'bg-violet-600 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {mv.label}
          </button>
        ))}
      </div>

      {/* Desktop 3-column grid */}
      <div className="hidden h-[calc(100vh-4rem-3.5rem)] min-h-[560px] lg:grid lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        <div className="min-h-0 border-r border-slate-200 dark:border-slate-800">{sidebar}</div>
        <div className="min-h-0 min-w-0">{canvas}</div>
        <div className="min-h-0 border-l border-slate-200 dark:border-slate-800"><Card className="h-full !rounded-none !border-0">{chat}</Card></div>
      </div>

      {/* Mobile single column */}
      <div className="h-[calc(100dvh-4rem-3.5rem-3.25rem)] min-h-[480px] lg:hidden">
        {mobileView === 'sidebar' && sidebar}
        {mobileView === 'canvas' && canvas}
        {mobileView === 'chat' && chat}
      </div>

      <Modal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} title={t('workspace.newProjectTitle')}>
        <div className="space-y-4">
          <Input label={t('workspace.projectNameLabel')} value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') void createProject(); }} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewProjectOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={createProject}>{t('common.create')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('workspace.deleteProject')}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('workspace.deleteProjectConfirm')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => void deleteProject()} icon={<Trash2 size={15} />}>{t('common.delete')}</Button>
        </div>
      </Modal>
    </div>
  );
}
