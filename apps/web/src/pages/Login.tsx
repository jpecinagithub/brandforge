import { useState, FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Input } from '@brandforge/ui';
import { FlaskConical } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';

function friendlyError(t: (k: string) => string, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return t('errors.unauthorized');
    return err.message;
  }
  return t('errors.network');
}

export function Login() {
  const { t } = useTranslation();
  const { login, startDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendlyError(t, err));
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      await startDemo();
      navigate('/app', { replace: true });
    } catch (err) {
      setError(friendlyError(t, err));
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <CardContent className="sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.loginSubtitle')}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Input
              label={t('common.email')}
              type="email"
              required
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label={t('auth.passwordLabel')}
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              {t('auth.loginSubmit')}
            </Button>
          </form>

          <div className="mt-3 flex justify-end">
            <Link to="/forgot-password" className="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
              {t('auth.forgotPassword')}
            </Link>
          </div>

          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs font-medium text-slate-400">or</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('auth.tryDemoTitle')}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('auth.tryDemoDesc')}</p>
            <Button variant="secondary" className="mt-3 w-full" icon={<FlaskConical size={16} />} loading={demoLoading} onClick={handleDemo}>
              {t('nav.tryDemo')}
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
              {t('auth.createOne')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
