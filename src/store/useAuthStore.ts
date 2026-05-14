import { useSyncExternalStore } from 'react';
import { ApiError, api, type CurrentUser } from '@/lib/api';
import { disableAutoSync, enableAutoSync, flushPush } from '@/lib/sync';

type Status = 'idle' | 'loading' | 'authenticated' | 'unauthenticated' | 'error';

interface AuthState {
  status: Status;
  user: CurrentUser | null;
  error: string | null;
}

let state: AuthState = {
  status: 'idle',
  user: null,
  error: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): AuthState {
  return state;
}

let inflight: Promise<void> | null = null;

/**
 * Hits /api/me. Resolves regardless of outcome; updates state.
 * Multiple concurrent calls share a single request.
 *
 * 当首次确认 authenticated 时会触发 enableAutoSync（拉远端 → LWW 合并 → 推回去），
 * 后续 store 的任何变更都自动 debounce 同步到服务端。
 */
export function refreshAuth(): Promise<void> {
  if (inflight) return inflight;
  const wasAuthed = state.status === 'authenticated';
  setState({ status: 'loading', error: null });
  inflight = api
    .me()
    .then((user) => {
      setState({ status: 'authenticated', user, error: null });
      if (!wasAuthed) {
        // 不阻塞 auth 状态返回：同步在后台跑，UI 先进入 app
        void enableAutoSync();
      }
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        setState({ status: 'unauthenticated', user: null, error: null });
        disableAutoSync();
      } else {
        const msg = err instanceof Error ? err.message : 'unknown error';
        setState({ status: 'error', user: null, error: msg });
      }
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function logout(): Promise<void> {
  // 先把没推完的本地变更冲一次（包括正在 debounce 的）
  try {
    await flushPush();
  } catch {
    /* 忽略，登出不应被同步阻塞 */
  }
  try {
    await api.logout();
  } finally {
    disableAutoSync();
    setState({ status: 'unauthenticated', user: null, error: null });
  }
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
