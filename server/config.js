import 'dotenv/config';
import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('change-me'))) {
  throw new Error('JWT_SECRET must be set to a strong secret in production');
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  // In dev without a secret, a random one is generated per boot (sessions reset on restart).
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  accessMode: process.env.ACCESS_MODE === 'blacklist' ? 'blacklist' : 'whitelist',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  devLogin: !isProd && process.env.DEV_LOGIN === 'true',
  sessionCookie: 'ot_session',
  sessionDays: 14,
};
