-- PostgreSQL schema. Applied automatically on boot (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  google_id        TEXT UNIQUE,
  email            TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL DEFAULT '',
  avatar           TEXT,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'banned')),
  level            INTEGER NOT NULL DEFAULT 1,
  xp               INTEGER NOT NULL DEFAULT 0,
  points           INTEGER NOT NULL DEFAULT 0,
  skill_points     INTEGER NOT NULL DEFAULT 0,
  stats            JSONB NOT NULL DEFAULT '{}'::jsonb,
  unlocked_weapons JSONB NOT NULL DEFAULT '[]'::jsonb,
  totals           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

CREATE TABLE IF NOT EXISTS game_sessions (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL,
  room_name    TEXT NOT NULL DEFAULT '',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  wave_reached INTEGER NOT NULL DEFAULT 0,
  outcome      TEXT,
  players      JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS game_sessions_started_idx ON game_sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS admin_logs (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  admin_email TEXT,
  action      TEXT NOT NULL,
  target_id   TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_logs_created_idx ON admin_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
