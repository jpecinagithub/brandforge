import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Input } from '@brandforge/ui';
import { AuthLayout } from '@/components/AuthLayout';
import { post, ApiError } from '@/lib/api';

export function ResendVerification() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await post('/api/v1/auth/resend-verification', { email: email.trim() });
      setSent(true);
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.resendTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.resendDesc')}</p>
          {sent ? (
            <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              {t('auth.resendSent')}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Input label={t('common.email')} type="email" required placeholder={t('auth.emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} />
              {error && (
                <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
              )}
              <Button type="submit" className="w-full" loading={loading}>{t('auth.resendSubmit')}</Button>
            </form>
          )}
          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">{t('common.back')}</Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
