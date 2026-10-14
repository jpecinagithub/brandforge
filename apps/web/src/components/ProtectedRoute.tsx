import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@brandforge/ui';
import { useAuth } from '@/context/AuthContext';

export function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-violet-600 dark:bg-slate-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export function AdminRoute({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-violet-600 dark:bg-slate-950">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return <Navigate to="/app" replace />;
  }

  return children;
}
