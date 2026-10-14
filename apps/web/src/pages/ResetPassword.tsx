import { useState, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Input } from '@brandforge/ui';
import { CheckCircle2 } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { post, ApiError } from '@/lib/api';

export function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError(t('validation.passwordMin'));
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return setError(t('validation.passwordStrength'));
    }
    if (password !== confirm) return setError(t('validation.passwordsMismatch'));
    setLoading(true);
    try {
      await post('/api/v1/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('errors.network'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <CardContent className="sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.resetTitle')}</h1>
          {done ? (
            <div className="mt-6 text-center">
              <CheckCircle2 size={44} className="mx-auto text-emerald-500" />
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t('auth.resetSuccess')}</p>
              <Link to="/login" className="mt-5 inline-block"><Button>{t('auth.goToLogin')}</Button></Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Input label={t('auth.newPasswordLabel')} type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={t('auth.passwordHint')} />
              <Input label={t('auth.confirmPasswordLabel')} type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {error && (
                <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
              )}
              <Button type="submit" className="w-full" loading={loading}>{t('auth.resetSubmit')}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
