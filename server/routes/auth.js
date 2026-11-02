import { Router } from 'express';
import { config } from '../config.js';
import { publicUser } from '../db/index.js';
import { verifyGoogleCredential, upsertUser, issueSession, clearSession, httpError } from '../auth.js';

export const authRouter = Router();

// Public client config (no secrets).
authRouter.get('/config', (_req, res) => {
  res.json({ googleClientId: config.googleClientId, devLogin: config.devLogin });
});

authRouter.post('/auth/google', async (req, res, next) => {
  try {
    const { credential } = req.body || {};
    if (typeof credential !== 'string') throw httpError(400, 'Missing credential');
    const identity = await verifyGoogleCredential(credential).catch((err) => {
      throw err.status ? err : httpError(401, 'Invalid Google credential');
    });
    const user = await upsertUser(identity);
    if (user.status === 'banned') throw httpError(403, 'This account has been banned');
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// Development-only login that skips Google. Disabled when NODE_ENV=production.
authRouter.post('/auth/dev', async (req, res, next) => {
  try {
    if (!config.devLogin) throw httpError(404, 'Not found');
    const name = String(req.body?.name || '').trim().slice(0, 24);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'Name and a valid email are required');
    const user = await upsertUser({ googleId: null, email, name, avatar: null });
    if (user.status === 'banned') throw httpError(403, 'This account has been banned');
    issueSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

authRouter.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
