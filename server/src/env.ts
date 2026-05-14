import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`[env] Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  GOOGLE_CLIENT_ID: required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  GOOGLE_CALLBACK_URL:
    process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3001/auth/google/callback',
  SESSION_SECRET: required('SESSION_SECRET'),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  PORT: Number(process.env.PORT ?? 3001),
  DB_PATH: process.env.DB_PATH ?? './data/hrm.db',
  NODE_ENV: process.env.NODE_ENV ?? 'development',
};
