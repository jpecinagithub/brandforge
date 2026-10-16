import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, EmptyState, Input, Modal, Spinner } from '@brandforge/ui';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Download, Eye, ImagePlus, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { del, get, patch, post, put, assetDownloadUrl, assetUrl, ApiError } from '@/lib/api';
import type { Asset, BrandKit, Campaign, CampaignDeliverable } from '@/lib/types';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { NewCampaignModal } from '@/components/NewCampaignModal';
import { LandingStudio } from '@/components/workspace/LandingStudio';

type Tab = 'briefing' | 'brandkit' | 'assets' | 'landing';
type MobileView = 'sidebar' | 'canvas' | 'chat';

const tabs: Tab[] = ['briefing', 'brandkit', 'assets', 'landing'];
const tabLabels: Record<Tab, string> = {
  briefing: 'workspace.tabBriefing', brandkit: 'workspace.tabBrandKit', assets: 'workspace.tabAssets', landing: 'workspace.tabLanding',
};

const deliverableIds: CampaignDeliverable[] = ['logo', 'brand_kit', 'print_assets', 'landing_page'];
const deliverableLabels: Record<CampaignDeliverable, string> = {
  logo: 'newCampaignModal.logo', brand_kit: 'newCampaignModal.brandKit', print_assets: 'newCampaignModal.printAssets', landing_page: 'newCampaignModal.landing',
};

const emptyBrandKit: BrandKit = { brandName: '', tagline: '', description: '', colors: [], fonts: [], tone: '', audience: '' };

function BrandKitTab({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const { t } = useTranslation();
  const [kit, setKit] = useState<BrandKit>(emptyBrandKit);
  const [colorsText, setColorsText] = useState('');
  const [fontsText, setFontsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    get<{ brandKit: BrandKit }>(`/api/v1/campaigns/${campaignId}/brand-kit`)
      .then((response) => {
        setKit({ ...emptyBrandKit, ...response.brandKit });
        setColorsText((response.brandKit.colors ?? []).join(', '));
        setFontsText((response.brandKit.fonts ?? []).join(', '));
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiError && error.status === 404)) return;
        setKit(emptyBrandKit); setColorsText(''); setFontsText('');
      })
      .finally(() => setLoading(false));
  }, [campaignId, refreshKey]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      const response = await put<{ brandKit: BrandKit }>(`/api/v1/campaigns/${campaignId}/brand-kit`, {
        ...kit,
        colors: colorsText.split(',').map((value) => value.trim()).filter(Boolean),
        fonts: fontsText.split(',').map((value) => value.trim()).filter(Boolean),
      });
      setKit({ ...emptyBrandKit, ...response.brandKit });
      setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  };

  if (loading) return <Loading />;
  const set = (key: keyof BrandKit, value: string) => setKit((current) => ({ ...current, [key]: value }));
  const hasBrandKit = Boolean(kit.id || kit.brandName || kit.tagline || kit.description || kit.tone || kit.audience || colorsText || fontsText);
  const swatches = colorsText.split(',').map((value) => value.trim()).filter((value) => /^#[0-9a-f]{6}$/i.test(value));

  return (
    <Card><CardContent className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">{t(hasBrandKit ? 'workspace.brandKitHint' : 'workspace.brandKitEmpty')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('workspace.brandKitBrandName')} value={kit.brandName ?? ''} onChange={(event) => set('brandName', event.target.value)} />
        <Input label={t('workspace.brandKitTagline')} value={kit.tagline ?? ''} onChange={(event) => set('tagline', event.target.value)} />
      </div>
      <TextArea label={t('workspace.brandKitDescription')} value={kit.description ?? ''} onChange={(value) => set('description', value)} rows={3} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Input label={t('workspace.brandKitColors')} value={colorsText} onChange={(event) => setColorsText(event.target.value)} placeholder="#7C3AED, #F59E0B" />
          {swatches.length > 0 ? <div className="mt-2 flex flex-wrap gap-2" aria-hidden="true">{swatches.map((color) => <span key={color} className="h-7 w-7 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: color }} />)}</div> : null}
        </div>
        <Input label={t('workspace.brandKitFonts')} value={fontsText} onChange={(event) => setFontsText(event.target.value)} placeholder="Inter, Georgia" />
        <Input label={t('workspace.brandKitTone')} value={kit.tone ?? ''} onChange={(event) => set('tone', event.target.value)} />
        <Input label={t('workspace.brandKitAudience')} value={kit.audience ?? ''} onChange={(event) => set('audience', event.target.value)} />
      </div>
      <div className="flex items-center gap-3"><Button onClick={save} loading={saving} icon={!saving ? <Check size={16} /> : undefined}>{t('workspace.brandKitSave')}</Button>{saved ? <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('workspace.brandKitSaved')}</span> : null}</div>
    </CardContent></Card>
  );
}

function AssetsTab({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [verification, setVerification] = useState({ total: 0, available: 0, checkedAt: '' });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await get<{ assets: Asset[]; verification: { total: number; available: number; checkedAt: string } }>(`/api/v1/campaigns/${campaignId}/assets`);
      setAssets(response.assets ?? []);
      setVerification(response.verification ?? { total: 0, available: 0, checkedAt: '' });
    } catch {
      setAssets([]);
      setVerification({ total: 0, available: 0, checkedAt: '' });
    } finally { setLoading(false); }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const created = await Promise.all(files.map(async (file) => {
        const form = new FormData(); form.append('campaignId', campaignId); form.append('file', file);
        return (await post<{ asset: Asset }>('/api/v1/assets', form)).asset;
      }));
      setAssets((current) => [...created, ...current]);
      setVerification((current) => ({ ...current, total: current.total + created.length, available: current.available + created.length, checkedAt: new Date().toISOString() }));
    } finally { setUploading(false); }
  };
  if (loading) return <Loading />;
  return <div className="space-y-4">
    <Card><CardContent><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-500 dark:text-slate-400">{t('workspace.assetsHint')}</p>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${verification.total === verification.available ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300'}`}>
        {verification.total === verification.available ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
        {t('workspace.assetsVerified', { available: verification.available, total: verification.total })}
      </span></div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-600/25 hover:bg-violet-500">
        {uploading ? <Spinner size="sm" /> : <ImagePlus size={16} />}{t('workspace.assetsUpload')}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" disabled={uploading} onChange={(event) => { const selected = Array.from(event.target.files ?? []); void uploadFiles(selected); event.target.value = ''; }} />
      </label>
    </CardContent></Card>
    {assets.length === 0 ? <Card><EmptyState icon={<ImagePlus size={26} />} title={t('workspace.assetsEmpty')} /></Card> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} labels={{ ready: t('workspace.assetReady'), unavailable: t('workspace.assetUnavailable'), preview: t('workspace.assetPreview'), download: t('workspace.assetDownload') }} />)}</div>}
  </div>;
}

function AssetCard({ asset, labels }: { asset: Asset; labels: { ready: string; unavailable: string; preview: string; download: string } }) {
  const [imageFailed, setImageFailed] = useState(false);
  const available = asset.available && !imageFailed;
  return (
    <Card className="overflow-hidden">
      <div className="relative h-44 bg-slate-100 dark:bg-slate-900">
        {available ? (
          <img src={assetUrl(asset)} alt={asset.originalName} className="h-full w-full object-contain" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-amber-700 dark:text-amber-300"><AlertTriangle size={24} /><span className="text-xs">{labels.unavailable}</span></div>
        )}
        <span className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold shadow-sm ${available ? 'bg-emerald-50/95 text-emerald-700' : 'bg-amber-50/95 text-amber-700'}`}>
          {available ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{available ? labels.ready : labels.unavailable}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100" title={asset.originalName}>{asset.originalName}</p>
        <p className="text-xs text-slate-400">{asset.mime} · {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB</p>
        <div className="flex gap-2">
          {available ? <>
            <a href={assetUrl(asset)} target="_blank" rel="noreferrer" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><Eye size={13} />{labels.preview}</a>
            <a href={assetDownloadUrl(asset)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-violet-500"><Download size={13} />{labels.download}</a>
          </> : <>
            <span aria-disabled="true" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-400 opacity-50 dark:border-slate-700"><Eye size={13} />{labels.preview}</span>
            <span aria-disabled="true" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-2 py-1.5 text-xs font-medium text-white opacity-40"><Download size={13} />{labels.download}</span>
          </>}
        </div>
      </div>
    </Card>
  );
}

export function CampaignWorkspace() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [siblings, setSiblings] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('briefing');
  const [mobileView, setMobileView] = useState<MobileView>('canvas');
  const [chatDraftRequest, setChatDraftRequest] = useState<{ id: number; text: string } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [briefDraft, setBriefDraft] = useState('');
  const [audienceDraft, setAudienceDraft] = useState('');
  const [deliverablesDraft, setDeliverablesDraft] = useState<CampaignDeliverable[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resultsRefreshKey, setResultsRefreshKey] = useState(0);

  const loadCampaign = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const { campaign: loaded } = await get<{ campaign: Campaign }>(`/api/v1/campaigns/${id}`);
      const { campaigns: related } = await get<{ campaigns: Campaign[] }>(`/api/v1/campaigns?workspaceId=${loaded.workspaceId}`);
      setCampaign(loaded); setSiblings(related);
      setNameDraft(loaded.name); setObjectiveDraft(loaded.objective ?? ''); setBriefDraft(loaded.brief ?? '');
      setAudienceDraft(loaded.audience ?? ''); setDeliverablesDraft(loaded.deliverables ?? []);
    } catch { if (showLoading) setCampaign(null); }
    finally { if (showLoading) setLoading(false); }
  }, [id]);
  useEffect(() => { void loadCampaign(); }, [loadCampaign]);

  const saveCampaign = async () => {
    if (!campaign) return;
    setSaving(true); setSaved(false);
    try {
      const { campaign: updated } = await patch<{ campaign: Campaign }>(`/api/v1/campaigns/${campaign.id}`, { name: nameDraft.trim() || campaign.name, objective: objectiveDraft.trim(), brief: briefDraft.trim(), audience: audienceDraft.trim(), deliverables: deliverablesDraft });
      setCampaign(updated); setNameDraft(updated.name);
      setEditingName(false); setSaved(true); window.setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const deleteCampaign = async () => { if (!campaign) return; await del(`/api/v1/campaigns/${campaign.id}`); navigate('/app'); };
  const prepareLandingRequest = () => { setChatDraftRequest({ id: Date.now(), text: t('workspace.landingAgentPrompt') }); setMobileView('chat'); };
  const refreshAgentResults = useCallback(() => { setResultsRefreshKey((key) => key + 1); void loadCampaign(false); }, [loadCampaign]);

  if (loading) return <Loading large />;
  if (!campaign) return <Card><EmptyState icon={<Megaphone size={26} />} title={t('errors.notFound')} action={<Link to="/app"><Button variant="secondary">{t('common.back')}</Button></Link>} /></Card>;

  const sidebar = <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3"><h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('workspace.campaigns')}</h3><button type="button" onClick={() => setNewCampaignOpen(true)} aria-label={t('dashboard.newCampaign')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800"><Plus size={17} /></button></div>
    <div className="slim-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">{siblings.map((sibling) => <Link key={sibling.id} to={`/app/campaigns/${sibling.id}`} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${sibling.id === campaign.id ? 'bg-violet-600/10 font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Megaphone size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{sibling.name}</span></Link>)}</div>
  </div>;

  const canvas = <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-5 dark:border-slate-800">
      <Link to="/app" aria-label={t('common.back')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><ArrowLeft size={17} /></Link>
      {editingName ? <div className="flex min-w-0 flex-1 items-center gap-2"><Input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} aria-label={t('workspace.campaignNameLabel')} className="!py-1.5" /><Button size="sm" onClick={saveCampaign} loading={saving} icon={!saving ? <Check size={15} /> : undefined}>{t('workspace.save')}</Button></div> : <button type="button" onClick={() => setEditingName(true)} className="group flex min-w-0 flex-1 items-center gap-2 text-left" title={t('common.edit')}><h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{campaign.name}</h2><Pencil size={14} className="shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 dark:text-slate-600" /></button>}
      <div className="flex items-center gap-1.5">{saved ? <span className="text-xs text-emerald-600 dark:text-emerald-400">{t('workspace.saved')}</span> : null}<span title={t('workspace.exportTooltip')}><Button size="sm" variant="secondary" icon={<Download size={15} />} disabled>{t('workspace.export')}</Button></span></div>
    </div>
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:px-5 dark:border-slate-800" role="tablist">{tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${tab === item ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>{t(tabLabels[item])}</button>)}</div>
    <div className="slim-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5">
      {tab === 'briefing' ? <div className="space-y-4">
        <Card><CardContent className="space-y-4"><TextArea label={t('workspace.campaignObjective')} value={objectiveDraft} onChange={setObjectiveDraft} rows={2} /><TextArea label={t('workspace.campaignBrief')} value={briefDraft} onChange={setBriefDraft} rows={5} /><TextArea label={t('workspace.campaignAudience')} value={audienceDraft} onChange={setAudienceDraft} rows={3} />
          <fieldset><legend className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('workspace.campaignDeliverables')}</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{deliverableIds.map((deliverable) => <label key={deliverable} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${deliverablesDraft.includes(deliverable) ? 'border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-500/10 dark:text-violet-200' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}><input type="checkbox" checked={deliverablesDraft.includes(deliverable)} onChange={() => setDeliverablesDraft((current) => current.includes(deliverable) ? current.filter((item) => item !== deliverable) : [...current, deliverable])} className="accent-violet-600" />{t(deliverableLabels[deliverable])}</label>)}</div></fieldset>
          <Button onClick={saveCampaign} loading={saving}>{t('common.save')}</Button>
        </CardContent></Card>
        <Card><CardContent><button type="button" onClick={() => setDeleteOpen(true)} className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-500 dark:text-red-400"><Trash2 size={15} />{t('workspace.deleteCampaign')}</button></CardContent></Card>
      </div> : null}
      {tab === 'brandkit' ? <BrandKitTab campaignId={campaign.id} refreshKey={resultsRefreshKey} /> : null}
      {tab === 'assets' ? <AssetsTab campaignId={campaign.id} refreshKey={resultsRefreshKey} /> : null}
      {tab === 'landing' ? <LandingStudio campaignId={campaign.id} onOpenChat={prepareLandingRequest} refreshKey={resultsRefreshKey} /> : null}
    </div>
  </div>;

  const chat = <ChatPanel campaignId={campaign.id} draftRequest={chatDraftRequest} onResultsChanged={refreshAgentResults} />;
  const mobileTabs: Array<{ key: MobileView; label: string }> = [{ key: 'sidebar', label: t('workspace.mobileSidebar') }, { key: 'canvas', label: t('workspace.mobileCanvas') }, { key: 'chat', label: t('workspace.mobileChat') }];

  return <div className="min-w-0 overflow-hidden -m-4 sm:-m-6 lg:-m-8">
    <div className="flex gap-1 border-b border-slate-200 bg-white p-2 lg:hidden dark:border-slate-800 dark:bg-slate-950" role="tablist" aria-label={t('workspace.mobileViews')}>{mobileTabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={mobileView === item.key} onClick={() => setMobileView(item.key)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${mobileView === item.key ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>{item.label}</button>)}</div>
    <div className="hidden h-[calc(100vh-4rem-3.5rem)] min-h-[560px] lg:grid lg:grid-cols-[240px_minmax(0,1fr)_340px]"><div className="min-h-0 border-r border-slate-200 dark:border-slate-800">{sidebar}</div><div className="min-h-0 min-w-0">{canvas}</div><div className="min-h-0 border-l border-slate-200 dark:border-slate-800"><Card className="h-full !rounded-none !border-0">{chat}</Card></div></div>
    <div className="h-[calc(100dvh-4rem-3.5rem-3.25rem)] min-h-[480px] lg:hidden">{mobileView === 'sidebar' ? sidebar : null}{mobileView === 'canvas' ? canvas : null}{mobileView === 'chat' ? chat : null}</div>
    <NewCampaignModal open={newCampaignOpen} onClose={() => setNewCampaignOpen(false)} onCreated={(campaignId) => navigate(`/app/campaigns/${campaignId}`)} />
    <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('workspace.deleteCampaign')}><p className="text-sm text-slate-600 dark:text-slate-300">{t('workspace.deleteCampaignConfirmAll')}</p><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button><Button variant="danger" onClick={() => void deleteCampaign()} icon={<Trash2 size={15} />}>{t('common.delete')}</Button></div></Modal>
  </div>;
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span><textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" /></label>;
}

function Loading({ large = false }: { large?: boolean }) { return <div className="flex h-40 items-center justify-center text-violet-600"><Spinner size={large ? 'lg' : 'md'} /></div>; }
