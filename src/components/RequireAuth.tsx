import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { refreshAuth, useAuth } from '@/store/useAuthStore';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (auth.status === 'idle') {
      void refreshAuth();
    }
  }, [auth.status]);

  if (auth.status === 'idle' || auth.status === 'loading') {
    return <FullScreenStatus label="正在验证登录…" />;
  }

  if (auth.status === 'error') {
    return (
      <FullScreenStatus
        label={`无法连接到服务器：${auth.error ?? '未知错误'}`}
        tone="error"
      />
    );
  }

  if (auth.status === 'unauthenticated') {
    const next = `/#${location.pathname}${location.search}`;
    return <Navigate to="/login" state={{ next }} replace />;
  }

  return <Outlet />;
}

function FullScreenStatus({
  label,
  tone = 'info',
}: {
  label: string;
  tone?: 'info' | 'error';
}) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: tone === 'error' ? 'var(--danger)' : 'var(--text-1)',
        fontSize: 14,
      }}
    >
      {label}
    </div>
  );
}
