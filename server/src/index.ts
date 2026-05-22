import './types.js';

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { passport } from './auth.js';
import {
  getSettingsForUser,
  listPlansForUser,
  listRangesForUser,
  listTournamentsForUser,
  pushPlansForUser,
  pushRangesForUser,
  pushSettingsForUser,
  pushTournamentsForUser,
  type SyncItemInput,
  type SyncItemRow,
} from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = env.NODE_ENV === 'production';

const app = express();

// Render and most reverse proxies sit in front of the app — required for
// req.secure / cookie `secure: true` to behave correctly behind HTTPS.
app.set('trust proxy', 1);

// In production we serve the frontend from this same origin (see static
// middleware below), so CORS is effectively a no-op. In dev the frontend
// runs on :5173 and proxies through Vite, also same-origin.
// CORS is kept as a safety net for any cross-origin tooling.
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  }),
);

app.use(express.json());

app.use(
  session({
    name: 'hrm.sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  const u = req.user;
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
  });
});

app.get(
  '/auth/google',
  (req, _res, next) => {
    // Persist intended return path (e.g. /#/range) in session for redirect-after-login.
    const next_ = typeof req.query.next === 'string' ? req.query.next : '/';
    (req.session as unknown as { returnTo?: string }).returnTo = next_;
    next();
  },
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${env.FRONTEND_ORIGIN}/#/login?error=oauth_failed`,
  }),
  (req, res) => {
    const returnTo =
      (req.session as unknown as { returnTo?: string }).returnTo || '/';
    delete (req.session as unknown as { returnTo?: string }).returnTo;
    // Hash router lives entirely client-side; just bounce to the frontend origin.
    res.redirect(`${env.FRONTEND_ORIGIN}${returnTo.startsWith('/#') ? returnTo : '/'}`);
  },
);

app.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie('hrm.sid');
      res.json({ ok: true });
    });
  });
});

// --- Sync API -----------------------------------------------------------------
// 客户端模型：localStorage 是真相源（离线可用），登录后通过 LWW 与服务端镜像同步。
// 协议尽量薄：服务端不解读 payload 结构，只比 updatedAt（行级）做增量合并。

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}

function rowsToWire(rows: SyncItemRow[]): Array<{
  id: string;
  updatedAt: number;
  deleted: boolean;
  payload: unknown;
}> {
  return rows.map((r) => ({
    id: r.id,
    updatedAt: r.updated_at,
    deleted: r.deleted === 1,
    payload: r.deleted === 1 || r.payload == null ? null : safeJsonParse(r.payload),
  }));
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function readSyncItems(input: unknown): SyncItemInput[] {
  if (!Array.isArray(input)) return [];
  const out: SyncItemInput[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) continue;
    out.push({
      id: r.id,
      updatedAt: r.updatedAt,
      deleted: r.deleted === true,
      payload: r.payload,
    });
  }
  return out;
}

app.get('/api/sync/pull', requireAuth, (req, res) => {
  const userId = (req.user as { id: number }).id;
  const ranges = rowsToWire(listRangesForUser(userId));
  const tournaments = rowsToWire(listTournamentsForUser(userId));
  const plans = rowsToWire(listPlansForUser(userId));
  const settingsRow = getSettingsForUser(userId);
  const settings = settingsRow
    ? { payload: safeJsonParse(settingsRow.payload), updatedAt: settingsRow.updated_at }
    : null;
  res.json({ ranges, tournaments, plans, settings });
});

app.post('/api/sync/push', requireAuth, (req, res) => {
  const userId = (req.user as { id: number }).id;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const rangesResult = pushRangesForUser(userId, readSyncItems(body.ranges));
  const tournamentsResult = pushTournamentsForUser(userId, readSyncItems(body.tournaments));
  const plansResult = pushPlansForUser(userId, readSyncItems(body.plans));

  let settingsResult: 'applied' | 'skipped' | 'noop' = 'noop';
  const s = body.settings as { payload?: unknown; updatedAt?: number } | undefined;
  if (s && typeof s === 'object' && typeof s.updatedAt === 'number') {
    settingsResult = pushSettingsForUser(userId, s.payload, s.updatedAt);
  }

  res.json({
    ranges: rangesResult,
    tournaments: tournamentsResult,
    plans: plansResult,
    settings: settingsResult,
  });
});

// --- Static frontend (production only) ---------------------------------------
// During build the root project's `dist/` is copied to `server/public/`.
// We serve it here so the SPA and the API live on the same origin (cookies
// stay first-party, no CORS needed).
if (isProd) {
  const staticDir = resolve(__dirname, '../public');
  if (!existsSync(staticDir)) {
    console.warn(
      `[server] NODE_ENV=production but ${staticDir} is missing. ` +
        'Did you run "npm run build:render"? The API will still work.',
    );
  } else {
    app.use(
      express.static(staticDir, {
        index: false, // SPA fallback below decides what to send for "/"
        maxAge: '1h',
      }),
    );
    // SPA fallback: any non-API/auth GET that asks for HTML gets index.html.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
      res.sendFile(join(staticDir, 'index.html'));
    });
  }
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
  console.log(`[server] mode=${env.NODE_ENV} frontend_origin=${env.FRONTEND_ORIGIN}`);
});
