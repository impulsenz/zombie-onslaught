// Database facade. Picks PostgreSQL when DATABASE_URL is set, otherwise a JSON file store.
// Both adapters expose the same async interface and return camelCase user objects:
// { id, googleId, email, name, avatar, role, status, level, xp, points, skillPoints,
//   stats, unlockedWeapons, totals, createdAt, lastLoginAt }
import { config } from '../config.js';
import { STARTING_WEAPONS } from '../../shared/defs.js';

let adapter;

export async function initDb() {
  if (config.databaseUrl) {
    const { PostgresStore } = await import('./postgres.js');
    adapter = new PostgresStore(config.databaseUrl, config.databaseSsl);
  } else {
    const { JsonStore } = await import('./jsonStore.js');
    adapter = new JsonStore();
  }
  await adapter.init();
  if (!(await adapter.getSetting('accessMode'))) await adapter.setSetting('accessMode', config.accessMode);
  console.log(`[db] using ${config.databaseUrl ? 'PostgreSQL' : 'JSON file store'}`);
  return adapter;
}

export const db = new Proxy({}, {
  get(_, prop) {
    if (!adapter) throw new Error('Database not initialised');
    const v = adapter[prop];
    return typeof v === 'function' ? v.bind(adapter) : v;
  },
});

export function newUserDefaults() {
  return {
    role: 'user',
    status: 'pending',
    level: 1,
    xp: 0,
    points: 0,
    skillPoints: 0,
    stats: { vitality: 0, agility: 0, power: 0, handling: 0, engineering: 0 },
    unlockedWeapons: [...STARTING_WEAPONS],
    totals: { kills: 0, wavesSurvived: 0, gamesPlayed: 0, bestWave: 0 },
  };
}

// Strips server-only fields before sending a user to a client.
export function publicUser(u) {
  if (!u) return null;
  const { googleId, ...rest } = u;
  return rest;
}
