import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export function DemoBanner() {
  const { user } = useAuth();
  const { t } = useTranslation();

  if (!user?.isDemo) return null;

  return (
    <div className="border-b border-amber-300/60 bg-amber-100 px-4 py-2.5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="inline-flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <FlaskConical size={15} aria-hidden="true" />
        {t('demo.banner')}
      </p>
    </div>
  );
}
