// End-to-end: boots the real server, exercises auth/RBAC and joins a game over Socket.io.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let server;

test.before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    env: {
      ...process.env, PORT: String(PORT), NODE_ENV: 'test', DEV_LOGIN: 'true', ACCESS_MODE: 'whitelist',
      ADMIN_EMAILS: 'admin@test.dev', DATABASE_URL: '', JWT_SECRET: 'test-secret',
      JSON_DB_FILE: path.join(os.tmpdir(), `ot-e2e-${process.pid}.json`), PUBLIC_URL: BASE,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
    server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
});
test.after(() => server?.kill());

async function login(name, email) {
  const res = await fetch(`${BASE}/api/auth/dev`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email }) });
  const body = await res.json();
  return { user: body.user, cookie: res.headers.get('set-cookie').split(';')[0] };
}
const call = (cookie, p, opts = {}) => fetch(`${BASE}/api${p}`, {
  ...opts, headers: { cookie, 'Content-Type': 'application/json' }, body: opts.body && JSON.stringify(opts.body),
});

function connect(cookie) {
  return ioClient(BASE, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false, forceNew: true });
}

test('admin approval flow, RBAC and live game join', async () => {
  const admin = await login('Admin', 'admin@test.dev');
  assert.equal(admin.user.role, 'admin');
  assert.equal(admin.user.status, 'approved');

  const player = await login('Rookie', 'rookie@test.dev');
  assert.equal(player.user.status, 'pending');

  // pending users cannot use game APIs or sockets
  assert.equal((await call(player.cookie, '/rooms')).status, 403);
  assert.equal((await call(player.cookie, '/admin/users')).status, 403);
  const err = await new Promise((resolve) => connect(player.cookie).on('connect_error', (e) => resolve(e.message)));
  assert.equal(err, 'not_approved');

  // admin approves + grants points
  let res = await call(admin.cookie, `/admin/users/${player.user.id}`, { method: 'PATCH', body: { status: 'approved' } });
  assert.equal(res.status, 200);
  res = await call(admin.cookie, `/admin/users/${player.user.id}/grant`, { method: 'POST', body: { points: 900, xp: 500 } });
  const granted = (await res.json()).user;
  assert.equal(granted.points, 900);
  assert.ok(granted.level >= 2);
  assert.ok(granted.skillPoints >= 1);

  // player spends a skill point and unlocks the shotgun
  res = await call(player.cookie, '/me/skills', { method: 'POST', body: { stat: 'vitality' } });
  assert.equal((await res.json()).user.stats.vitality, 1);
  res = await call(player.cookie, '/me/unlock', { method: 'POST', body: { weapon: 'shotgun' } });
  assert.ok((await res.json()).user.unlockedWeapons.includes('shotgun'));

  // admin cannot demote the last admin (themself)
  res = await call(admin.cookie, `/admin/users/${admin.user.id}`, { method: 'PATCH', body: { role: 'user' } });
  assert.equal(res.status, 400);

  // join a game and receive init + snapshots
  const sock = connect(player.cookie);
  const init = new Promise((resolve) => sock.on('init', resolve));
  const snap = new Promise((resolve) => sock.on('snap', resolve));
  await new Promise((resolve) => sock.on('connect', resolve));
  const ack = await new Promise((resolve) => sock.emit('join', { roomId: 'quick' }, resolve));
  assert.ok(ack.ok);
  const initData = await init;
  assert.equal(initData.layers[0].terrain.length, 448 * 336);
  assert.equal(initData.layers.length, 5);
  const s = await snap;
  assert.equal(s.p.length, 1);
  assert.ok(s.p[0].u.includes('shotgun'));

  const rooms = await (await call(admin.cookie, '/admin/sessions')).json();
  assert.equal(rooms.live.length, 1);

  // banning kicks the live socket
  const kicked = new Promise((resolve) => sock.on('kicked', resolve));
  await call(admin.cookie, `/admin/users/${player.user.id}`, { method: 'PATCH', body: { status: 'banned' } });
  assert.match((await kicked).reason, /banned/);

  const logs = await (await call(admin.cookie, '/admin/logs')).json();
  assert.ok(logs.logs.length >= 3);
  sock.close();
});
