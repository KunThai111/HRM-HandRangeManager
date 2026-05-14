import './types.js';

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { passport } from './auth.js';

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
