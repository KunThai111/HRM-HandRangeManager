/**
 * Thin wrapper around fetch for talking to the auth/api server.
 * Always sends cookies (credentials: 'include') so the session sticks.
 *
 * In dev, requests go through Vite's proxy (`/api`, `/auth` -> :3001).
 * In prod, set `VITE_API_BASE` to the deployed server origin.
 *
 * Debug 模式（VITE_DEBUG_NO_AUTH=1）：
 * - 不需要起 server，所有 /api/* 请求被短路成本地 mock。
 * - me() 直接返回固定的「Debug User」；sync 全部返回空，写本地即生效。
 * - 用法：`npm run dev:debug`
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';
export const DEBUG_NO_AUTH = import.meta.env.VITE_DEBUG_NO_AUTH === '1';

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

const DEBUG_USER: CurrentUser = {
  id: 0,
  email: 'debug@local',
  name: 'Debug User',
  picture: null,
};

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
  me: () =>
    DEBUG_NO_AUTH
      ? Promise.resolve({ ...DEBUG_USER })
      : request<CurrentUser>('/api/me'),
  logout: () =>
    DEBUG_NO_AUTH
      ? Promise.resolve({ ok: true } as const)
      : request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  /** Returns the absolute URL the browser should navigate to in order to start OAuth. */
  googleLoginUrl: (next?: string) => {
    const search = next ? `?next=${encodeURIComponent(next)}` : '';
    return `${API_BASE}/auth/google${search}`;
  },
  syncPull: <R = unknown, T = unknown, S = unknown>() =>
    DEBUG_NO_AUTH
      ? Promise.resolve({
          ranges: [],
          tournaments: [],
          settings: null,
        } as SyncPullResponse<R, T, S>)
      : request<SyncPullResponse<R, T, S>>('/api/sync/pull'),
  syncPush: <R = unknown, T = unknown, S = unknown>(body: SyncPushBody<R, T, S>) =>
    DEBUG_NO_AUTH
      ? Promise.resolve({
          ranges: {},
          tournaments: {},
          settings: 'noop',
        } as SyncPushResponse)
      : request<SyncPushResponse>('/api/sync/push', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
};
