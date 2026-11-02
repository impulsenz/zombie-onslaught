// Persists match rewards (xp, points, kill/wave totals) to a user's profile.
import { db } from './db/index.js';
import { applyXp, SKILL_POINTS_PER_LEVEL } from '../shared/defs.js';

// Serialises read-modify-write updates per user so concurrent writers never lose an update.
const queues = new Map();

export function withUserLock(userId, fn) {
  const prev = queues.get(userId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(userId, next);
  next.catch(() => {}).finally(() => { if (queues.get(userId) === next) queues.delete(userId); });
  return next;
}

export function awardProgress(userId, { xp = 0, points = 0, kills = 0, waves = 0, bestWave = 0, gamesPlayed = 0 }) {
  return withUserLock(userId, async () => {
    const u = await db.getUser(userId);
    if (!u) return null;
    const { level, xp: newXp, levelsGained } = applyXp(u.level, u.xp, Math.max(0, Math.round(xp)));
    const totals = { ...u.totals };
    totals.kills = (totals.kills || 0) + kills;
    totals.wavesSurvived = (totals.wavesSurvived || 0) + waves;
    totals.gamesPlayed = (totals.gamesPlayed || 0) + gamesPlayed;
    totals.bestWave = Math.max(totals.bestWave || 0, bestWave);
    const user = await db.updateUser(userId, {
      level, xp: newXp, totals,
      points: Math.max(0, u.points + Math.round(points)),
      skillPoints: u.skillPoints + levelsGained * SKILL_POINTS_PER_LEVEL,
    });
    return { user, levelsGained };
  }).catch((err) => { console.error('[progress] failed', err); return null; });
}
