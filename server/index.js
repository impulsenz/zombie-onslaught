import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { loadUser, requireApproved } from './auth.js';
import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { adminRouter } from './routes/admin.js';
import { RoomManager } from './game/RoomManager.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await initDb();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.publicUrl, credentials: true },
  maxHttpBufferSize: 16_000,
  pingInterval: 10_000,
});
const rooms = new RoomManager(io);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    // Google Identity Services needs this to pop up the sign-in window.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  });
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(loadUser);

app.use('/api', authRouter);
app.use('/api', profileRouter);
app.get('/api/rooms', requireApproved, (_req, res) => res.json({ rooms: rooms.list() }));
app.post('/api/rooms', requireApproved, (req, res) => {
  const room = rooms.create(req.body?.name);
  if (!room) return res.status(503).json({ error: 'Server is at room capacity' });
  res.json({ room: room.info() });
});
app.use('/api/admin', adminRouter(rooms));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Admin page is only served to admins; everyone else is bounced to the menu.
app.get('/admin', (req, res) => {
  if (req.user?.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(ROOT, 'client/views/admin.html'));
});
app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: config.isProd ? '1h' : 0 }));
app.use(express.static(path.join(ROOT, 'client/public'), { maxAge: config.isProd ? '1h' : 0 }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

server.listen(config.port, () => {
  console.log(`[server] Onslaught: Terraform listening on ${config.publicUrl} (port ${config.port})`);
  if (config.devLogin) console.log('[server] DEV_LOGIN is enabled - do not use in production');
  if (!config.googleClientId) console.log('[server] GOOGLE_CLIENT_ID not set - Google sign-in disabled');
});

const shutdown = () => {
  for (const r of rooms.rooms.values()) r.destroy('Server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
