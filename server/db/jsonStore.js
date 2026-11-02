// File-backed store for local development. Keeps everything in memory and
// writes atomically (tmp file + rename) on a short debounce.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const FILE = process.env.JSON_DB_FILE ? path.resolve(process.env.JSON_DB_FILE) : path.join(DATA_DIR, 'db.json');

const clone = (o) => (o == null ? o : structuredClone(o));

export class JsonStore {
  constructor() {
    this.data = { users: [], sessions: [], adminLogs: [], settings: {} };
    this.saveTimer = null;
    this.saving = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    try {
      this.data = { ...this.data, ...JSON.parse(await fs.readFile(FILE, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await this.flush();
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    this.saving = this.saving.then(async () => {
      const tmp = `${FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
      await fs.rename(tmp, FILE);
    }).catch((err) => console.error('[db] save failed', err));
    return this.saving;
  }

  // ---- users
  async getUser(id) { return clone(this.data.users.find((u) => u.id === id)); }
  async getUserByGoogleId(gid) { return clone(this.data.users.find((u) => u.googleId === gid)); }
  async getUserByEmail(email) { return clone(this.data.users.find((u) => u.email === email)); }

  async createUser(fields) {
    const now = new Date().toISOString();
    const user = { id: crypto.randomUUID(), createdAt: now, lastLoginAt: now, ...fields };
    this.data.users.push(user);
    this.scheduleSave();
    return clone(user);
  }

  async updateUser(id, patch) {
    const u = this.data.users.find((x) => x.id === id);
    if (!u) return null;
    Object.assign(u, clone(patch));
    this.scheduleSave();
    return clone(u);
  }

  async listUsers({ search = '', status = '' } = {}) {
    const q = search.toLowerCase();
    return clone(this.data.users
      .filter((u) => (!status || u.status === status) &&
        (!q || u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async countAdmins() { return this.data.users.filter((u) => u.role === 'admin').length; }

  // ---- game sessions
  async createSession(fields) {
    const s = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null, ...fields };
    this.data.sessions.push(s);
    if (this.data.sessions.length > 2000) this.data.sessions.splice(0, this.data.sessions.length - 2000);
    this.scheduleSave();
    return clone(s);
  }

  async updateSession(id, patch) {
    const s = this.data.sessions.find((x) => x.id === id);
    if (s) { Object.assign(s, clone(patch)); this.scheduleSave(); }
    return clone(s);
  }

  async listSessions(limit = 50) {
    return clone(this.data.sessions.slice(-limit).reverse());
  }

  // ---- admin logs
  async addAdminLog(entry) {
    const log = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry };
    this.data.adminLogs.push(log);
    if (this.data.adminLogs.length > 5000) this.data.adminLogs.splice(0, this.data.adminLogs.length - 5000);
    this.scheduleSave();
    return clone(log);
  }

  async listAdminLogs(limit = 100) { return clone(this.data.adminLogs.slice(-limit).reverse()); }

  // ---- settings
  async getSetting(key) { return clone(this.data.settings[key]); }
  async setSetting(key, value) { this.data.settings[key] = clone(value); this.scheduleSave(); }
}
