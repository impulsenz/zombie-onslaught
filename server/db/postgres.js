// PostgreSQL adapter (production).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const SCHEMA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

const USER_COLS = {
  googleId: 'google_id', email: 'email', name: 'name', avatar: 'avatar', role: 'role', status: 'status',
  level: 'level', xp: 'xp', points: 'points', skillPoints: 'skill_points', stats: 'stats',
  unlockedWeapons: 'unlocked_weapons', totals: 'totals', lastLoginAt: 'last_login_at',
};
const JSON_COLS = new Set(['stats', 'unlocked_weapons', 'totals', 'players', 'details']);
const SESSION_COLS = { roomId: 'room_id', roomName: 'room_name', endedAt: 'ended_at', waveReached: 'wave_reached', outcome: 'outcome', players: 'players' };

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id, googleId: r.google_id, email: r.email, name: r.name, avatar: r.avatar, role: r.role, status: r.status,
    level: r.level, xp: r.xp, points: r.points, skillPoints: r.skill_points, stats: r.stats,
    unlockedWeapons: r.unlocked_weapons, totals: r.totals, createdAt: iso(r.created_at), lastLoginAt: iso(r.last_login_at),
  };
}
const rowToSession = (r) => r && ({
  id: r.id, roomId: r.room_id, roomName: r.room_name, startedAt: iso(r.started_at), endedAt: iso(r.ended_at),
  waveReached: r.wave_reached, outcome: r.outcome, players: r.players,
});
const rowToLog = (r) => r && ({
  id: r.id, adminId: r.admin_id, adminEmail: r.admin_email, action: r.action, targetId: r.target_id,
  details: r.details, createdAt: iso(r.created_at),
});

// Builds "col1 = $2, col2 = $3" from a camelCase patch using a column map.
function setClause(patch, cols, offset = 1) {
  const sets = [], values = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = cols[k];
    if (!col) continue;
    values.push(JSON_COLS.has(col) ? JSON.stringify(v) : v);
    sets.push(`${col} = $${values.length + offset}`);
  }
  return { sql: sets.join(', '), values };
}

export class PostgresStore {
  constructor(url, ssl) {
    this.pool = new pg.Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined, max: 10 });
  }

  async init() { await this.pool.query(await fs.readFile(SCHEMA, 'utf8')); }

  async one(sql, params) { return (await this.pool.query(sql, params)).rows[0]; }

  async getUser(id) { return rowToUser(await this.one('SELECT * FROM users WHERE id = $1', [id])); }
  async getUserByGoogleId(gid) { return rowToUser(await this.one('SELECT * FROM users WHERE google_id = $1', [gid])); }
  async getUserByEmail(email) { return rowToUser(await this.one('SELECT * FROM users WHERE email = $1', [email])); }

  async createUser(f) {
    const r = await this.one(
      `INSERT INTO users (id, google_id, email, name, avatar, role, status, level, xp, points, skill_points, stats, unlocked_weapons, totals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [crypto.randomUUID(), f.googleId, f.email, f.name, f.avatar, f.role, f.status, f.level, f.xp, f.points,
        f.skillPoints, JSON.stringify(f.stats), JSON.stringify(f.unlockedWeapons), JSON.stringify(f.totals)]);
    return rowToUser(r);
  }

  async updateUser(id, patch) {
    const { sql, values } = setClause(patch, USER_COLS);
    if (!sql) return this.getUser(id);
    return rowToUser(await this.one(`UPDATE users SET ${sql} WHERE id = $1 RETURNING *`, [id, ...values]));
  }

  async listUsers({ search = '', status = '' } = {}) {
    const { rows } = await this.pool.query(
      `SELECT * FROM users
       WHERE ($1 = '' OR status = $1) AND ($2 = '' OR email ILIKE '%' || $2 || '%' OR name ILIKE '%' || $2 || '%')
       ORDER BY created_at DESC LIMIT 1000`, [status, search]);
    return rows.map(rowToUser);
  }

  async countAdmins() { return Number((await this.one(`SELECT count(*) AS n FROM users WHERE role = 'admin'`)).n); }

  async createSession(f) {
    return rowToSession(await this.one(
      `INSERT INTO game_sessions (id, room_id, room_name, wave_reached, outcome, players) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [crypto.randomUUID(), f.roomId, f.roomName || '', f.waveReached || 0, f.outcome || null, JSON.stringify(f.players || [])]));
  }

  async updateSession(id, patch) {
    const { sql, values } = setClause(patch, SESSION_COLS);
    if (!sql) return null;
    return rowToSession(await this.one(`UPDATE game_sessions SET ${sql} WHERE id = $1 RETURNING *`, [id, ...values]));
  }

  async listSessions(limit = 50) {
    const { rows } = await this.pool.query('SELECT * FROM game_sessions ORDER BY started_at DESC LIMIT $1', [limit]);
    return rows.map(rowToSession);
  }

  async addAdminLog(e) {
    return rowToLog(await this.one(
      `INSERT INTO admin_logs (id, admin_id, admin_email, action, target_id, details) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [crypto.randomUUID(), e.adminId, e.adminEmail, e.action, e.targetId || null, JSON.stringify(e.details || {})]));
  }

  async listAdminLogs(limit = 100) {
    const { rows } = await this.pool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT $1', [limit]);
    return rows.map(rowToLog);
  }

  async getSetting(key) { return (await this.one('SELECT value FROM settings WHERE key = $1', [key]))?.value; }
  async setSetting(key, value) {
    await this.pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)]);
  }
}
