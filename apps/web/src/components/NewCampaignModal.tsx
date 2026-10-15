import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal } from '@brandforge/ui';
import { FileImage, Image as ImageIcon, LayoutTemplate, Palette, Sparkles, Upload, X } from 'lucide-react';
import { get, post } from '@/lib/api';
import type { Campaign, CampaignDeliverable, Workspace } from '@/lib/types';

interface NewCampaignModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (campaignId: string) => void;
}

const deliverableOptions: Array<{ id: CampaignDeliverable; icon: typeof Sparkles; labelKey: string; descriptionKey: string }> = [
  { id: 'logo', icon: Sparkles, labelKey: 'newCampaignModal.logo', descriptionKey: 'newCampaignModal.logoDesc' },
  { id: 'brand_kit', icon: Palette, labelKey: 'newCampaignModal.brandKit', descriptionKey: 'newCampaignModal.brandKitDesc' },
  { id: 'print_assets', icon: ImageIcon, labelKey: 'newCampaignModal.printAssets', descriptionKey: 'newCampaignModal.printAssetsDesc' },
  { id: 'landing_page', icon: LayoutTemplate, labelKey: 'newCampaignModal.landing', descriptionKey: 'newCampaignModal.landingDesc' },
];

export function NewCampaignModal({ open, onClose, onCreated }: NewCampaignModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [brief, setBrief] = useState('');
  const [audience, setAudience] = useState('');
  const [deliverables, setDeliverables] = useState<CampaignDeliverable[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(''); setObjective(''); setBrief(''); setAudience('');
    setDeliverables([]); setFiles([]); setError('');
  }, [open]);

  const toggleDeliverable = (id: CampaignDeliverable) => {
    setDeliverables((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const images = Array.from(selected).filter((file) => ['image/png', 'image/jpeg'].includes(file.type));
    setFiles((current) => [...current, ...images].slice(0, 12));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2 || objective.trim().length < 5) {
      setError(t('newCampaignModal.requiredError'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { workspaces } = await get<{ workspaces: Workspace[] }>('/api/v1/workspaces');
      const workspace = workspaces[0];
      if (!workspace) throw new Error(t('errors.generic'));
      const { campaign } = await post<{ campaign: Campaign }>('/api/v1/campaigns', {
        workspaceId: workspace.id,
        name: name.trim(),
        objective: objective.trim(), brief: brief.trim(), audience: audience.trim(), deliverables,
      });
      await Promise.all(files.map(async (file) => {
        const form = new FormData();
        form.append('campaignId', campaign.id);
        form.append('file', file);
        await post('/api/v1/assets', form);
      }));
      onClose();
      onCreated(campaign.id);
    } catch {
      setError(t('newCampaignModal.createError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('newCampaignModal.title')} maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} className="max-h-[75vh] space-y-6 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('newCampaignModal.nameLabel')} placeholder={t('newCampaignModal.namePlaceholder')} value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <Input label={t('newCampaignModal.objectiveLabel')} placeholder={t('newCampaignModal.objectivePlaceholder')} value={objective} onChange={(event) => setObjective(event.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextArea id="campaign-brief" label={t('newCampaignModal.briefLabel')} hint={t('newCampaignModal.briefHint')} value={brief} onChange={setBrief} rows={5} />
          <TextArea id="campaign-audience" label={t('newCampaignModal.audienceLabel')} hint={t('newCampaignModal.audienceHint')} value={audience} onChange={setAudience} rows={5} />
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-900 dark:text-white">{t('newCampaignModal.deliverablesLabel')}</legend>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('newCampaignModal.deliverablesHint')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {deliverableOptions.map((option) => {
              const selected = deliverables.includes(option.id);
              const Icon = option.icon;
              return (
                <button key={option.id} type="button" aria-pressed={selected} onClick={() => toggleDeliverable(option.id)} className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-violet-500 bg-violet-50 text-violet-950 ring-2 ring-violet-500/15 dark:bg-violet-500/10 dark:text-violet-100' : 'border-slate-200 bg-white text-slate-800 hover:border-violet-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'}`}>
                  <span className={`rounded-xl p-2 ${selected ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}><Icon size={18} /></span>
                  <span><span className="block text-sm font-semibold">{t(option.labelKey)}</span><span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(option.descriptionKey)}</span></span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('newCampaignModal.assetsLabel')}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('newCampaignModal.assetsHint')}</p>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-600 transition-colors hover:border-violet-400 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            <Upload size={18} /> {t('newCampaignModal.assetsSelect')}
            <input type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
          </label>
          {files.length > 0 ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <FileImage size={15} className="shrink-0 text-violet-500" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('newCampaignModal.removeAsset')} className="rounded p-1 hover:bg-slate-200 dark:hover:bg-slate-700"><X size={14} /></button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {error ? <p role="alert" className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">{error}</p> : null}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white pt-4 dark:border-slate-700 dark:bg-slate-900">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={loading}>{t('newCampaignModal.submit')}</Button>
        </div>
      </form>
    </Modal>
  );
}

function TextArea({ id, label, hint, value, onChange, rows }: { id: string; label: string; hint: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      <textarea id={id} rows={rows} placeholder={hint} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500" />
    </div>
  );
}
