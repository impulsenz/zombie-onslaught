import { Router } from 'express';
import { db, publicUser } from '../db/index.js';
import { requireAuth, requireApproved, httpError } from '../auth.js';
import { withUserLock } from '../progression.js';
import { STATS, STAT_MAX_RANK, WEAPONS, xpForLevel } from '../../shared/defs.js';

export const profileRouter = Router();

profileRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), xpToNext: xpForLevel(req.user.level) });
});

// Spend one skill point on a stat.
profileRouter.post('/me/skills', requireApproved, async (req, res, next) => {
  try {
    const stat = req.body?.stat;
    if (!STATS[stat]) throw httpError(400, 'Unknown stat');
    const user = await withUserLock(req.user.id, async () => {
      const u = await db.getUser(req.user.id);
      if (u.skillPoints < 1) throw httpError(400, 'No skill points available');
      if ((u.stats[stat] || 0) >= STAT_MAX_RANK) throw httpError(400, 'Stat is already maxed');
      return db.updateUser(u.id, { skillPoints: u.skillPoints - 1, stats: { ...u.stats, [stat]: (u.stats[stat] || 0) + 1 } });
    });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// Permanently unlock a weapon with points.
profileRouter.post('/me/unlock', requireApproved, async (req, res, next) => {
  try {
    const id = req.body?.weapon;
    const w = WEAPONS[id];
    if (!w) throw httpError(400, 'Unknown weapon');
    const user = await withUserLock(req.user.id, async () => {
      const u = await db.getUser(req.user.id);
      if (u.unlockedWeapons.includes(id)) throw httpError(400, 'Already unlocked');
      if (u.level < w.level) throw httpError(400, `Requires level ${w.level}`);
      if (u.points < w.unlockCost) throw httpError(400, 'Not enough points');
      return db.updateUser(u.id, { points: u.points - w.unlockCost, unlockedWeapons: [...u.unlockedWeapons, id] });
    });
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});
