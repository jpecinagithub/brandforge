import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Modal, Spinner } from '@brandforge/ui';
import { Camera, Trash2, MonitorSmartphone } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme, Theme } from '@/context/ThemeContext';
import { del, get, mediaUrl, patch, post } from '@/lib/api';
import type { Session, User } from '@/lib/types';

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function Profile() {
  const { t, i18n } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [language, setLanguage] = useState(user?.language ?? 'en');
  const [themeChoice, setThemeChoice] = useState<Theme>(theme);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwDone, setPwDone] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deletePassword, setDeletePassword] = useState('');

  useEffect(() => {
    get<{ sessions: Session[] }>('/api/v1/users/me/sessions')
      .then((res) => setSessions(res.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await patch<{ user: User }>('/api/v1/users/me', {
        name: name.trim(),
        language,
        theme: themeChoice,
      });
      setUser(res.user);
      setTheme(themeChoice);
      void i18n.changeLanguage(res.user.language === 'es' ? 'es' : 'en');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const res = await post<{ user: User }>('/api/v1/users/me/avatar', form);
      setUser(res.user);
    } finally {
      setAvatarUploading(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwDone(false);
    if (newPassword.length < 8) return setPwError(t('validation.passwordMin'));
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return setPwError(t('validation.passwordStrength'));
    }
    setPwLoading(true);
    try {
      await post('/api/v1/users/me/change-password', { currentPassword, password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwDone(true);
    } catch {
      setPwError(t('errors.generic'));
    } finally {
      setPwLoading(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    if (!window.confirm(t('profile.revokeConfirm'))) return;
    setRevoking(sessionId);
    try {
      await del(`/api/v1/users/me/sessions/${sessionId}`);
      setSessions((s) => s.filter((x) => x.id !== sessionId));
    } finally {
      setRevoking(null);
    }
  };

  const deleteAccount = async () => {
    if (deleteEmail.trim().toLowerCase() !== user?.email.toLowerCase()) return;
    await del('/api/v1/users/me', { password: deletePassword });
    await logout();
    navigate('/login');
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">{t('profile.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('profile.subtitle')}</p>
      </div>

      <Section title={t('profile.personalInfo')}>
        <div className="flex items-center gap-4">
          <Avatar name={user.name} src={mediaUrl(user.avatarUrl)} size="lg" />
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {avatarUploading ? <Spinner size="sm" /> : <Camera size={15} />}
              {t('profile.avatarUpload')}
              <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={avatarUploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadAvatar(f);
                  e.target.value = '';
                }} />
            </label>
            <p className="mt-1.5 text-xs text-slate-400">{t('profile.avatarHint')}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <Input label={t('common.email')} value={user.email} readOnly disabled hint={t('profile.emailReadonly')} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{t('common.language')}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{t('common.theme')}</label>
            <select value={themeChoice} onChange={(e) => setThemeChoice(e.target.value as Theme)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              <option value="light">{t('common.light')}</option>
              <option value="dark">{t('common.dark')}</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={saveProfile} loading={saving}>{t('profile.saveChanges')}</Button>
          {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('profile.saved')}</span>}
        </div>
      </Section>

      <Section title={t('profile.security')}>
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-2">
          <Input label={t('profile.currentPassword')} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          <Input label={t('profile.newPassword')} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} hint={t('auth.passwordHint')} />
          {pwError && <p role="alert" className="sm:col-span-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{pwError}</p>}
          {pwDone && <p role="status" className="sm:col-span-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{t('profile.passwordChanged')}</p>}
          <div className="sm:col-span-2">
            <Button size="sm" type="submit" loading={pwLoading}>{t('profile.changePassword')}</Button>
          </div>
        </form>
      </Section>

      <Section title={t('profile.sessions')} desc={t('profile.sessionsDesc')}>
        {sessionsLoading ? (
          <div className="flex justify-center py-4 text-violet-600"><Spinner /></div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-slate-400">—</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <MonitorSmartphone size={17} className="shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {s.userAgent ?? '—'}
                      {s.current && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{t('profile.currentSession')}</span>}
                    </p>
                    <p className="text-xs text-slate-400">{s.ip ?? ''} · {new Date(s.lastSeenAt).toLocaleString()}</p>
                  </div>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" loading={revoking === s.id} onClick={() => void revokeSession(s.id)}>
                    {t('profile.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Card className="border-red-200 dark:border-red-500/30">
        <CardHeader>
          <CardTitle className="text-red-700 dark:text-red-300">{t('profile.dangerZone')}</CardTitle>
          <CardDescription>{t('profile.dangerDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="danger" size="sm" icon={<Trash2 size={15} />} onClick={() => { setDeleteEmail(''); setDeletePassword(''); setDeleteOpen(true); }}>
            {t('profile.deleteAccount')}
          </Button>
        </CardContent>
      </Card>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('profile.deleteModalTitle')}>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('profile.deleteModalDesc')}</p>
        <div className="mt-4 space-y-4">
          <Input label={t('common.email')} placeholder={t('profile.typeEmailPlaceholder')} value={deleteEmail} onChange={(e) => setDeleteEmail(e.target.value)} />
          <Input label={t('profile.currentPassword')} type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              disabled={deleteEmail.trim().toLowerCase() !== user.email.toLowerCase() || !deletePassword}
              onClick={() => void deleteAccount()}
            >
              {t('profile.deleteConfirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
