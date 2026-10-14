import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Input } from '@brandforge/ui';
import { MailCheck } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';

function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 10) issues.push('min');
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) issues.push('strength');
  return issues;
}

export function Register() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (name.trim().length < 2) next.name = t('validation.nameMin');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = t('validation.emailInvalid');
    const issues = passwordIssues(password);
    if (issues.includes('min')) next.password = t('validation.passwordMin');
    else if (issues.includes('strength')) next.password = t('validation.passwordStrength');
    if (confirm !== password) next.confirm = t('validation.passwordsMismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password);
      setDoneEmail(email.trim());
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('errors.network'));
    } finally {
      setLoading(false);
    }
  };

  if (doneEmail) {
    return (
      <AuthLayout>
        <Card>
          <CardContent className="py-10 text-center sm:p-10">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <MailCheck size={26} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.checkEmailTitle')}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              {t('auth.checkEmailDesc', { email: doneEmail })}
            </p>
            <p className="mx-auto mt-3 max-w-sm rounded-xl bg-slate-100 px-3.5 py-2.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {t('auth.checkEmailDevHint')}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Link to="/login"><Button className="w-full">{t('auth.goToLogin')}</Button></Link>
              <Link to="/resend-verification" className="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
                {t('auth.resendLink')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <CardContent className="sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.registerTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.registerSubtitle')}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            <Input label={t('auth.nameLabel')} placeholder={t('auth.namePlaceholder')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
            <Input label={t('common.email')} type="email" placeholder={t('auth.emailPlaceholder')} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
            <Input label={t('auth.passwordLabel')} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={t('auth.passwordHint')} />
            <Input label={t('auth.confirmPasswordLabel')} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
            {serverError && (
              <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {serverError}
              </p>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              {t('auth.registerSubmit')}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
              {t('auth.signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
