import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="BrandForge AI">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-sm font-bold text-white shadow-lg shadow-violet-600/30">
        BF
      </span>
      {!compact && (
        <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
          BrandForge <span className="text-violet-600 dark:text-violet-400">AI</span>
        </span>
      )}
    </Link>
  );
}
