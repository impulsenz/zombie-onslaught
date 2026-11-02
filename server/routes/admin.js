import { Router } from 'express';
import { db, publicUser } from '../db/index.js';
import { requireAdmin, httpError } from '../auth.js';
import { awardProgress, withUserLock } from '../progression.js';
import { bus } from '../events.js';

export function adminRouter(rooms) {
  const r = Router();
  r.use(requireAdmin);

  const log = (req, action, targetId, details) =>
    db.addAdminLog({ adminId: req.user.id, adminEmail: req.user.email, action, targetId, details });

  r.get('/stats', async (_req, res, next) => {
    try {
      const users = await db.listUsers();
      const by = (k, v) => users.filter((u) => u[k] === v).length;
      res.json({
        users: users.length, pending: by('status', 'pending'), approved: by('status', 'approved'),
        banned: by('status', 'banned'), admins: by('role', 'admin'),
        rooms: rooms.list().length, playersOnline: rooms.list().reduce((n, x) => n + x.players, 0),
        accessMode: await db.getSetting('accessMode'),
      });
    } catch (err) { next(err); }
  });

  r.get('/users', async (req, res, next) => {
    try {
      const users = await db.listUsers({ search: String(req.query.search || ''), status: String(req.query.status || '') });
      const online = rooms.onlineUserIds();
      res.json({ users: users.map((u) => ({ ...publicUser(u), online: online.has(u.id) })) });
    } catch (err) { next(err); }
  });

  // Change status (pending/approved/banned) and/or role (user/admin).
  r.patch('/users/:id', async (req, res, next) => {
    try {
      const { status, role } = req.body || {};
      const patch = {};
      if (status !== undefined) {
        if (!['pending', 'approved', 'banned'].includes(status)) throw httpError(400, 'Invalid status');
        patch.status = status;
      }
      if (role !== undefined) {
        if (!['user', 'admin'].includes(role)) throw httpError(400, 'Invalid role');
        patch.role = role;
      }
      if (!Object.keys(patch).length) throw httpError(400, 'Nothing to change');

      const target = await db.getUser(req.params.id);
      if (!target) throw httpError(404, 'User not found');
      if (target.id === req.user.id && (patch.role === 'user' || (patch.status && patch.status !== 'approved'))) {
        throw httpError(400, 'You cannot demote, ban or suspend yourself');
      }
      if (target.role === 'admin' && patch.role === 'user' && (await db.countAdmins()) <= 1) {
        throw httpError(400, 'Cannot remove the last admin');
      }
      const updated = await withUserLock(target.id, () => db.updateUser(target.id, patch));
      await log(req, 'user.update', target.id, { email: target.email, before: { status: target.status, role: target.role }, after: patch });
      bus.emit('user:updated', updated);
      res.json({ user: publicUser(updated) });
    } catch (err) { next(err); }
  });

  // Grant (or with negative numbers, deduct) points / xp / skill points.
  r.post('/users/:id/grant', async (req, res, next) => {
    try {
      const num = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
      const xp = num(req.body?.xp), points = num(req.body?.points), skillPoints = num(req.body?.skillPoints);
      if (Math.abs(xp) > 1e7 || Math.abs(points) > 1e7 || Math.abs(skillPoints) > 1000) throw httpError(400, 'Amount too large');
      if (xp < 0) throw httpError(400, 'XP cannot be negative');
      if (!xp && !points && !skillPoints) throw httpError(400, 'Nothing to grant');
      const target = await db.getUser(req.params.id);
      if (!target) throw httpError(404, 'User not found');

      let result = await awardProgress(target.id, { xp, points });
      if (!result) throw httpError(500, 'Grant failed');
      if (skillPoints) {
        const u = await withUserLock(target.id, async () => {
          const cur = await db.getUser(target.id);
          return db.updateUser(target.id, { skillPoints: Math.max(0, cur.skillPoints + skillPoints) });
        });
        result = { ...result, user: u };
      }
      await log(req, 'user.grant', target.id, { email: target.email, xp, points, skillPoints });
      bus.emit('user:updated', result.user);
      res.json({ user: publicUser(result.user) });
    } catch (err) { next(err); }
  });

  r.get('/logs', async (_req, res, next) => {
    try { res.json({ logs: await db.listAdminLogs(200) }); } catch (err) { next(err); }
  });

  r.get('/sessions', async (_req, res, next) => {
    try { res.json({ sessions: await db.listSessions(100), live: rooms.list() }); } catch (err) { next(err); }
  });

  r.put('/settings', async (req, res, next) => {
    try {
      const mode = req.body?.accessMode;
      if (!['whitelist', 'blacklist'].includes(mode)) throw httpError(400, 'accessMode must be whitelist or blacklist');
      await db.setSetting('accessMode', mode);
      await log(req, 'settings.accessMode', null, { accessMode: mode });
      res.json({ accessMode: mode });
    } catch (err) { next(err); }
  });

  r.delete('/rooms/:id', async (req, res, next) => {
    try {
      if (!rooms.close(req.params.id, 'Room closed by an admin')) throw httpError(404, 'Room not found');
      await log(req, 'room.close', req.params.id, {});
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return r;
}
