// Owns all live game rooms and wires Socket.io connections into them.
import crypto from 'node:crypto';
import cookie from 'cookie';
import { GameRoom } from './GameRoom.js';
import { MAX_PLAYERS } from '../../shared/defs.js';
import { config } from '../config.js';
import { userFromToken } from '../auth.js';
import { bus } from '../events.js';

const EMPTY_ROOM_TTL = 30_000;
const MAX_ROOMS = 50;

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.sockets = new Map(); // socket.id -> { socket, user, room }

    io.use(async (socket, next) => {
      try {
        const token = cookie.parse(socket.handshake.headers.cookie || '')[config.sessionCookie];
        const user = await userFromToken(token);
        if (!user) return next(new Error('unauthorized'));
        if (user.status !== 'approved') return next(new Error('not_approved'));
        socket.data.user = user;
        next();
      } catch (err) { next(err); }
    });
    io.on('connection', (socket) => this.onConnection(socket));

    bus.on('user:updated', (u) => this.onUserUpdated(u));
    setInterval(() => this.reapEmptyRooms(), 5000).unref();
  }

  create(name) {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const id = crypto.randomBytes(4).toString('hex');
    const room = new GameRoom(this.io, id, String(name || 'Outpost').trim().slice(0, 32) || 'Outpost');
    this.rooms.set(id, room);
    return room;
  }

  // Best room to quick-join: the fullest open room that is not in game-over, else a new one.
  quickRoom() {
    const open = [...this.rooms.values()]
      .filter((r) => r.players.size < MAX_PLAYERS && r.phase !== 'gameover')
      .sort((a, b) => b.players.size - a.players.size);
    return open[0] || this.create(`Outpost ${Math.floor(Math.random() * 900 + 100)}`);
  }

  list() { return [...this.rooms.values()].map((r) => r.info()); }

  onlineUserIds() {
    return new Set([...this.sockets.values()].filter((c) => c.room).map((c) => c.user.id));
  }

  close(id, reason) {
    const room = this.rooms.get(id);
    if (!room) return false;
    room.destroy(reason);
    this.rooms.delete(id);
    for (const c of this.sockets.values()) if (c.room === room) c.room = null;
    return true;
  }

  reapEmptyRooms() {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (!room.players.size && room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL) {
        room.destroy('empty');
        this.rooms.delete(id);
      }
    }
  }

  onUserUpdated(user) {
    for (const c of this.sockets.values()) {
      if (c.user.id !== user.id) continue;
      c.user = user;
      if (user.status !== 'approved') {
        c.socket.emit('kicked', { reason: user.status === 'banned' ? 'Your account has been banned' : 'Your access has been revoked' });
        c.socket.disconnect(true);
      }
    }
  }

  onConnection(socket) {
    const conn = { socket, user: socket.data.user, room: null };
    this.sockets.set(socket.id, conn);

    // Only one active game connection per account: drop older ones.
    for (const [sid, c] of this.sockets) {
      if (sid !== socket.id && c.user.id === conn.user.id) {
        c.socket.emit('kicked', { reason: 'Signed in from another tab' });
        c.socket.disconnect(true);
      }
    }

    const leave = () => {
      if (conn.room) { conn.room.removePlayer(socket.id); conn.room = null; }
    };

    socket.on('join', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      leave();
      const roomId = typeof data?.roomId === 'string' ? data.roomId : 'quick';
      const room = roomId === 'quick' ? this.quickRoom() : this.rooms.get(roomId);
      if (!room) return reply({ error: 'Room not found' });
      const res = room.addPlayer(socket, conn.user);
      if (res.error) return reply({ error: res.error });
      conn.room = room;
      reply({ ok: true, roomId: room.id });
    });

    socket.on('input', (d) => {
      const p = conn.room?.players.get(socket.id);
      if (p) conn.room.setInput(p, d);
    });

    socket.on('act', (a) => {
      const p = conn.room?.players.get(socket.id);
      if (p) conn.room.handleAction(p, a);
    });

    // latency probe: the client times the round trip, then reports it so everyone sees each ping
    socket.on('lat', (t, cb) => { if (typeof cb === 'function') cb(t); });
    socket.on('ping-report', (ms) => {
      const p = conn.room?.players.get(socket.id);
      if (p && Number.isFinite(ms)) p.ping = Math.max(0, Math.min(9999, Math.round(ms)));
    });

    // developer tools: admins only, checked on the server for every command
    socket.on('dev', (a) => {
      const p = conn.room?.players.get(socket.id);
      if (p && conn.user.role === 'admin') conn.room.devAction(p, a);
    });

    let lastChat = 0;
    socket.on('chat', (text) => {
      if (!conn.room || typeof text !== 'string' || Date.now() - lastChat < 700) return;
      lastChat = Date.now();
      const clean = text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
      if (clean) this.io.to(conn.room.channel).emit('chat', { name: conn.user.name, text: clean });
    });

    socket.on('leave', leave);
    socket.on('disconnect', () => { leave(); this.sockets.delete(socket.id); });
  }
}
