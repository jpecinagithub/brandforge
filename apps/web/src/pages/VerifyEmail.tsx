import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Spinner } from '@brandforge/ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { post } from '@/lib/api';

export function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    post('/api/v1/auth/verify-email', { token })
      .then(() => setState('success'))
      .catch(() => setState('error'));
  }, [token]);

  return (
    <AuthLayout>
      <Card>
        <CardContent className="py-10 text-center sm:p-10">
          {state === 'loading' && (
            <>
              <Spinner size="lg" className="mx-auto text-violet-600" />
              <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">{t('auth.verifyTitle')}</h1>
            </>
          )}
          {state === 'success' && (
            <>
              <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
              <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">{t('auth.verifySuccess')}</h1>
              <Link to="/login" className="mt-6 inline-block"><Button>{t('auth.goToLogin')}</Button></Link>
            </>
          )}
          {state === 'error' && (
            <>
              <XCircle size={48} className="mx-auto text-red-500" />
              <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">{t('auth.verifyError')}</h1>
              <div className="mt-6 flex flex-col items-center gap-2">
                <Link to="/resend-verification"><Button variant="secondary">{t('auth.resendTitle')}</Button></Link>
                <Link to="/login" className="text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
                  {t('auth.goToLogin')}
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
