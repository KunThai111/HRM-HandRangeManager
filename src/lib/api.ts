/**
 * Thin wrapper around fetch for talking to the auth/api server.
 * Always sends cookies (credentials: 'include') so the session sticks.
 *
 * In dev, requests go through Vite's proxy (`/api`, `/auth` -> :3001).
 * In prod, set `VITE_API_BASE` to the deployed server origin.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }

  return body as T;
}

export interface CurrentUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * 与 server/src/index.ts 的 /api/sync/* 路由对齐的线上数据形态。
 * - `payload` 不被服务端解读，纯透传；deleted=true 时为 null。
 */
export interface SyncItemDTO<T = unknown> {
  id: string;
  updatedAt: number;
  deleted: boolean;
  payload: T | null;
}

export interface SyncSettingsDTO<T = unknown> {
  payload: T | null;
  updatedAt: number;
}

export interface SyncPullResponse<R = unknown, T = unknown, S = unknown> {
  ranges: SyncItemDTO<R>[];
  tournaments: SyncItemDTO<T>[];
  settings: SyncSettingsDTO<S> | null;
}

export interface SyncPushBody<R = unknown, T = unknown, S = unknown> {
  ranges?: Array<{
    id: string;
    updatedAt: number;
    deleted?: boolean;
    payload?: R | null;
  }>;
  tournaments?: Array<{
    id: string;
    updatedAt: number;
    deleted?: boolean;
    payload?: T | null;
  }>;
  settings?: { payload: S; updatedAt: number };
}

export interface SyncPushResponse {
  ranges: Record<string, 'applied' | 'skipped'>;
  tournaments: Record<string, 'applied' | 'skipped'>;
  settings: 'applied' | 'skipped' | 'noop';
}

export const api = {
  me: () => request<CurrentUser>('/api/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  /** Returns the absolute URL the browser should navigate to in order to start OAuth. */
  googleLoginUrl: (next?: string) => {
    const search = next ? `?next=${encodeURIComponent(next)}` : '';
    return `${API_BASE}/auth/google${search}`;
  },
  syncPull: <R = unknown, T = unknown, S = unknown>() =>
    request<SyncPullResponse<R, T, S>>('/api/sync/pull'),
  syncPush: <R = unknown, T = unknown, S = unknown>(body: SyncPushBody<R, T, S>) =>
    request<SyncPushResponse>('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
