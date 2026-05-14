import { useEffect, useMemo } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import logoUrl from '@/assets/Logo.png';
import { api } from '@/lib/api';
import { refreshAuth, useAuth } from '@/store/useAuthStore';
import styles from '@/styles/loginPage.module.css';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: 'Google 授权失败或被取消，请重试。',
};

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Path the user originally tried to reach, preserved through the OAuth round-trip.
  const next = useMemo(() => {
    const fromState = (location.state as { next?: string } | null)?.next;
    return fromState ?? '/#/';
  }, [location.state]);

  const errorCode = searchParams.get('error');
  const errorMsg = errorCode ? ERROR_MESSAGES[errorCode] ?? '登录失败，请重试。' : null;

  useEffect(() => {
    if (auth.status === 'idle') {
      void refreshAuth();
    }
  }, [auth.status]);

  if (auth.status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const checking = auth.status === 'idle' || auth.status === 'loading';

  function handleGoogleLogin() {
    window.location.href = api.googleLoginUrl(next);
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <img src={logoUrl} alt="HRM" className={styles.logo} />
        <h1 className={styles.title}>登录到 HRM</h1>
        <p className={styles.subtitle}>
          Holdem Range Manager
          <br />
          使用 Google 账号继续
        </p>

        {errorMsg && <div className={styles.error}>{errorMsg}</div>}
        {auth.status === 'error' && (
          <div className={styles.error}>
            无法连接到服务器：{auth.error ?? '未知错误'}
          </div>
        )}

        <button
          type="button"
          className={styles.googleBtn}
          onClick={handleGoogleLogin}
          disabled={checking}
        >
          <GoogleIcon />
          {checking ? '正在检查登录状态…' : '使用 Google 账号登录'}
        </button>

        <div className={styles.footer}>
          登录即表示您同意我们将您的 Google 邮箱与头像
          <br />
          用于识别身份。仅本服务使用，不分享给第三方。
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  // Official multicolor "G" mark, inlined to avoid an extra network request.
  return (
    <svg className={styles.googleIcon} viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
