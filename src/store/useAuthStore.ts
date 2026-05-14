import { useSyncExternalStore } from 'react';
import { ApiError, api, type CurrentUser } from '@/lib/api';

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
 */
export function refreshAuth(): Promise<void> {
  if (inflight) return inflight;
  setState({ status: 'loading', error: null });
  inflight = api
    .me()
    .then((user) => {
      setState({ status: 'authenticated', user, error: null });
    })
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        setState({ status: 'unauthenticated', user: null, error: null });
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
  try {
    await api.logout();
  } finally {
    setState({ status: 'unauthenticated', user: null, error: null });
  }
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
