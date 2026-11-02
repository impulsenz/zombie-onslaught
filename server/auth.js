// Session handling, Google ID-token verification and access middleware.
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { db, newUserDefaults } from './db/index.js';

const googleClient = new OAuth2Client();

export async function verifyGoogleCredential(credential) {
  if (!config.googleClientId) throw httpError(500, 'GOOGLE_CLIENT_ID is not configured');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw httpError(401, 'Google account email is not verified');
  return { googleId: p.sub, email: p.email.toLowerCase(), name: p.name || p.email.split('@')[0], avatar: p.picture || null };
}

// Finds or creates the user for a verified identity and applies bootstrap admin rules.
export async function upsertUser({ googleId, email, name, avatar }) {
  const isBootstrapAdmin = config.adminEmails.includes(email);
  let user = (googleId && await db.getUserByGoogleId(googleId)) || await db.getUserByEmail(email);
  const now = new Date().toISOString();

  if (!user) {
    const accessMode = (await db.getSetting('accessMode')) || config.accessMode;
    user = await db.createUser({
      ...newUserDefaults(),
      googleId, email, name, avatar,
      status: isBootstrapAdmin || accessMode === 'blacklist' ? 'approved' : 'pending',
      role: isBootstrapAdmin ? 'admin' : 'user',
    });
    return user;
  }

  const patch = { lastLoginAt: now, name, avatar: avatar ?? user.avatar };
  if (googleId && !user.googleId) patch.googleId = googleId;
  if (isBootstrapAdmin) Object.assign(patch, { role: 'admin', status: 'approved' });
  return db.updateUser(user.id, patch);
}

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionDays * 86400_000,
  });
}

export function clearSession(res) { res.clearCookie(config.sessionCookie); }

export async function userFromToken(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    return await db.getUser(sub);
  } catch {
    return null;
  }
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---- middleware
export async function loadUser(req, _res, next) {
  try {
    req.user = await userFromToken(req.cookies?.[config.sessionCookie]);
    next();
  } catch (err) { next(err); }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (req.user.status === 'banned') return res.status(403).json({ error: 'Account banned' });
  next();
}

export function requireApproved(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.status !== 'approved') return res.status(403).json({ error: 'Account awaiting admin approval' });
    next();
  });
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}
