import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Input } from '@brandforge/ui';
import { AuthLayout } from '@/components/AuthLayout';
import { post } from '@/lib/api';

export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await post('/api/v1/auth/forgot-password', { email: email.trim() });
    } catch {
      // Neutral response on purpose — never reveal whether the email exists.
    } finally {
      setLoading(false);
      setDone(true);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <CardContent className="sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.forgotTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.forgotDesc')}</p>
          {done ? (
            <p role="status" className="mt-6 rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {t('auth.forgotNeutral')}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Input label={t('common.email')} type="email" required placeholder={t('auth.emailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" className="w-full" loading={loading}>{t('auth.forgotSubmit')}</Button>
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
