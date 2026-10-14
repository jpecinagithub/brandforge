import { useState, FormEvent, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Modal } from '@brandforge/ui';
import { get, post } from '@/lib/api';
import type { Campaign, Project, Workspace } from '@/lib/types';

interface NewCampaignModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export function NewCampaignModal({ open, onClose, onCreated }: NewCampaignModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setObjective('');
      setError('');
    }
  }, [open ]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError(t('validation.required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { workspaces } = await get<{ workspaces: Workspace[] }>('/api/v1/workspaces');
      const workspace = workspaces[0];
      if (!workspace) throw new Error(t('errors.generic'));
      const { project } = await post<{ project: Project }>('/api/v1/projects', {
        workspaceId: workspace.id,
        name: name.trim(),
      });
      await post<{ campaign: Campaign }>(`/api/v1/projects/${project.id}/campaigns`, {
        name: name.trim(),
        objective: objective.trim() || undefined,
      });
      onClose();
      onCreated(project.id);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('newCampaignModal.title')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label={t('newCampaignModal.projectNameLabel')}
          placeholder={t('newCampaignModal.projectNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div>
          <label htmlFor="campaign-objective" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t('newCampaignModal.objectiveLabel')} <span className="font-normal text-slate-400">({t('common.optional')})</span>
          </label>
          <textarea
            id="campaign-objective"
            rows={3}
            placeholder={t('newCampaignModal.objectivePlaceholder')}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={loading}>{t('newCampaignModal.submit')}</Button>
        </div>
      </form>
    </Modal>
  );
}
