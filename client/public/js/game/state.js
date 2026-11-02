// Client-side mirror of the server world.
//
// Remote entities (other players, enemies, robots) are rendered INTERP_DELAY ms in the past
// by interpolating between two timestamped server snapshots. This gives smooth, evenly paced
// movement (and walk animations) regardless of network jitter. Our own player is predicted
// locally and gently reconciled with the server.
import {
  ENEMY_TYPE_IDS, STRUCTURE_ORDER, STRUCTURES, PLAYER_RADIUS, PERKS, SPRINT_MULT, ROBOT_TYPE_IDS, INTERP_DELAY,
  ORE_IDS, isSolid, structCenter, U_FLOOR,
} from '/shared/defs.js';
import { stepPlayer } from '/shared/geometry.js';

export const PROJ_KINDS = ['bolt', 'beam', 'rocket', 'plasma', 'grenade', 'molotov', 'missile', 'shell'];
export const PERK_IDS = Object.keys(PERKS);
export const ROBOT_TASKS = ['idle', 'repair', 'collect', 'dig', 'shoot', 'haul', 'deliver'];
export const POI_KINDS = ['monolith', 'probe', 'cache'];

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Small timestamped position history for snapshot interpolation.
class Track {
  constructor(t, x, y, a) { this.buf = [{ t, x, y, a }]; this.rx = x; this.ry = y; this.ra = a; this.vx = 0; this.vy = 0; }
  push(t, x, y, a) {
    const last = this.buf[this.buf.length - 1];
    if (t <= last.t) { last.x = x; last.y = y; last.a = a; return; }
    this.buf.push({ t, x, y, a });
    if (this.buf.length > 8) this.buf.shift();
  }
  sample(rt) {
    const b = this.buf;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    let x, y, a;
    if (rt >= b[b.length - 1].t) { // beyond newest: extrapolate briefly
      const n = b[b.length - 1], p = b[b.length - 2] || n;
      const span = Math.max(1, n.t - p.t), ahead = Math.min(rt - n.t, 120);
      x = n.x + ((n.x - p.x) / span) * ahead; y = n.y + ((n.y - p.y) / span) * ahead; a = n.a;
    } else if (i === 0) { x = b[0].x; y = b[0].y; a = b[0].a; }
    else {
      const p = b[i - 1], n = b[i];
      const t = (rt - p.t) / Math.max(1, n.t - p.t);
      x = lerp(p.x, n.x, t); y = lerp(p.y, n.y, t); a = lerpAngle(p.a, n.a, t);
    }
    this.vx = x - this.rx; this.vy = y - this.ry;
    this.rx = x; this.ry = y; this.ra = a;
  }
}

export class World {
  init(data) {
    this.you = data.you;
    this.room = data.room;
    this.layers = data.layers.map((l) => {
      const terrain = Uint8Array.from(l.terrain);
      const solid = new Uint8Array(terrain.length);
      for (let i = 0; i < terrain.length; i++) solid[i] = isSolid(l.id, terrain[i]) ? 1 : 0;
      return { id: l.id, w: l.w, h: l.h, terrain, solid, version: 0 };
    });
    this.hqTiles = data.hqTiles;
    this.hq = { ...data.hq, hp: 1, max: 1, a: 0, ra: 0, powered: true };
    this.layer = 0;
    this.offset = null; // serverTime - localTime (ms)
    this.reset();
    this.local = null;
    this.version = (this.version || 0) + 1;
  }

  reset() {
    this.players = new Map();
    this.enemies = new Map();
    this.structures = new Map();
    this.projectiles = new Map();
    this.pickups = new Map();
    this.robots = new Map();
    this.wires = [];
    this.pois = [];
    this.shrines = [];
    this.fireZones = [];
    this.dig = new Map();
    this.res = {}; this.ore = {}; this.mods = {}; this.tech = new Set();
    this.power = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3];
    this.mm = [];
    this.snap = null;
    const g = this.L();
    this.structGrid = new Int32Array(g ? g.w * g.h : 0);
  }

  L(layer = this.layer) { return this.layers?.[layer]; }
  get me() { return this.players.get(this.you); }
  sAt = (i) => { const id = this.structGrid[i]; return id ? this.structures.get(id) : undefined; };

  setLayerTerrain(layer, terrain) {
    const g = this.layers[layer];
    g.terrain = Uint8Array.from(terrain);
    for (let i = 0; i < g.terrain.length; i++) g.solid[i] = isSolid(layer, g.terrain[i]) ? 1 : 0;
    g.version++;
  }

  digTile(layer, i) {
    const g = this.layers[layer];
    if (!g) return;
    g.terrain[i] = U_FLOOR;
    g.solid[i] = 0;
    g.version++;
  }

  // server time (ms) at which remote entities are rendered
  renderTime() { return performance.now() + (this.offset || 0) - INTERP_DELAY; }

  applySnapshot(s) {
    const nowLocal = performance.now();
    const off = s.t - nowLocal;
    // track clock offset: jump on lower-latency samples, drift up slowly otherwise
    this.offset = this.offset === null || off < this.offset ? off : this.offset + (off - this.offset) * 0.02;

    if (s.L !== this.layer) { this.layer = s.L; this.reset(); this.local = null; this.version++; }
    this.snap = s;
    const t = s.t;
    this.hq.hp = s.hq[0]; this.hq.max = s.hq[1]; this.hq.a = s.hq[3] / 100; this.hq.powered = !!s.hq[4];
    this.res = s.res; this.ore = s.ore; this.mods = s.mods; this.tech = new Set(s.tech); this.power = s.pw;
    if (s.mm) this.mm = s.mm;

    const seenP = new Set();
    for (const p of s.p) {
      seenP.add(p.id);
      let e = this.players.get(p.id);
      if (!e) { e = { track: new Track(t, p.x, p.y, p.a), walk: 0, recoil: 0, rz: 0, moved: 0, rx: p.x, ry: p.y, ra: p.a }; this.players.set(p.id, e); }
      const layerChanged = e.L !== undefined && e.L !== p.L;
      if (p.rd && (!e.rd || e.rd[0] !== p.rd[0])) e.rdAt = nowLocal / 1000; // ride phase started (local clock)
      Object.assign(e, p);
      if (layerChanged) e.track = new Track(t, p.x, p.y, p.a);
      else e.track.push(t, p.x, p.y, p.a);
      if (p.id === this.you) this.reconcile(e);
    }
    for (const id of this.players.keys()) if (!seenP.has(id)) this.players.delete(id);

    const seenZ = new Set();
    for (let i = 0; i < s.z.length; i += 7) {
      const id = s.z[i];
      seenZ.add(id);
      let z = this.enemies.get(id);
      if (!z) {
        z = { id, type: ENEMY_TYPE_IDS[s.z[i + 1]], track: new Track(t, s.z[i + 2], s.z[i + 3], s.z[i + 4] / 100), born: nowLocal / 1000, walk: Math.random() * 6, hitAt: 0, rx: s.z[i + 2], ry: s.z[i + 3], ra: 0 };
        this.enemies.set(id, z);
      } else z.track.push(t, s.z[i + 2], s.z[i + 3], s.z[i + 4] / 100);
      z.hp = s.z[i + 5]; z.flags = s.z[i + 6];
    }
    for (const id of this.enemies.keys()) if (!seenZ.has(id)) this.enemies.delete(id);

    const g = this.L();
    this.structGrid = new Int32Array(g.w * g.h);
    const seenS = new Set();
    for (let i = 0; i < s.s.length; i += 11) {
      const id = s.s[i];
      seenS.add(id);
      const kind = STRUCTURE_ORDER[s.s[i + 1]];
      let st = this.structures.get(id);
      if (!st || st.kind !== kind) { st = { id, kind, def: STRUCTURES[kind], ra: 0, born: nowLocal / 1000, shieldHitAt: 0 }; this.structures.set(id, st); }
      st.tx = s.s[i + 2]; st.ty = s.s[i + 3]; st.hp = s.s[i + 4]; st.level = s.s[i + 5];
      Object.assign(st, structCenter(kind, st.tx, st.ty));
      const f = s.s[i + 6];
      st.built = !!(f & 1); st.powered = !!(f & 2); st.lit = !!(f & 4); st.starved = !!(f & 8);
      if (f & 16) st.hitAt = nowLocal / 1000;
      st.mount = !!(f & 32); st.flicker = !!(f & 64); st.shielded = !!(f & 128);
      st.progress = s.s[i + 7];
      const extra = s.s[i + 8];
      st.rot = s.s[i + 9]; st.mods = s.s[i + 10];
      const d = st.def;
      if (d.turret || kind === 'floodlight') st.a = extra / 100;
      else if (d.capacity) st.charge = extra;
      else if (d.supply) st.output = extra / 10;
      else if (kind === 'shield_projector') st.shield = extra;
      else if (kind === 'elevator') { st.down = !!(extra & 1); st.up = !!(extra & 2); }
      else if (kind === 'drill' || kind === 'borer') { st.buffer = extra % 1000; st.cursor = Math.floor(extra / 1000); }
      if (!st.mount) {
        const n = d.size || 1;
        for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) this.structGrid[(st.ty + yy) * g.w + st.tx + xx] = id;
      }
    }
    for (const id of this.structures.keys()) if (!seenS.has(id)) this.structures.delete(id);

    this.wires = [];
    for (let i = 0; i < s.wr.length; i += 3) this.wires.push({ a: s.wr[i], b: s.wr[i + 1], state: s.wr[i + 2] });

    const seenPr = new Set();
    for (let i = 0; i < s.pr.length; i += 6) {
      const id = s.pr[i];
      seenPr.add(id);
      let pr = this.projectiles.get(id);
      if (!pr) { pr = { id, kind: PROJ_KINDS[s.pr[i + 1]], born: nowLocal / 1000, sx: s.pr[i + 2], sy: s.pr[i + 3] }; this.projectiles.set(id, pr); }
      pr.x = s.pr[i + 2]; pr.y = s.pr[i + 3]; pr.vx = s.pr[i + 4]; pr.vy = s.pr[i + 5];
    }
    for (const id of this.projectiles.keys()) if (!seenPr.has(id)) this.projectiles.delete(id);

    const seenR = new Set();
    for (let i = 0; i < s.rb.length; i += 7) {
      const id = s.rb[i];
      seenR.add(id);
      let r = this.robots.get(id);
      if (!r) { r = { id, type: ROBOT_TYPE_IDS[s.rb[i + 1]], track: new Track(t, s.rb[i + 2], s.rb[i + 3], s.rb[i + 4] / 100), born: nowLocal, rx: s.rb[i + 2], ry: s.rb[i + 3], ra: 0 }; this.robots.set(id, r); }
      else r.track.push(t, s.rb[i + 2], s.rb[i + 3], s.rb[i + 4] / 100);
      r.hp = s.rb[i + 5]; r.task = ROBOT_TASKS[s.rb[i + 6]];
    }
    for (const id of this.robots.keys()) if (!seenR.has(id)) this.robots.delete(id);

    const seenPk = new Set();
    for (let i = 0; i < s.pk.length; i += 4) {
      const id = s.pk[i];
      seenPk.add(id);
      let pk = this.pickups.get(id);
      if (!pk) { pk = { id, rx: s.pk[i + 1], ry: s.pk[i + 2], ore: s.pk[i + 3] ? ORE_IDS[s.pk[i + 3] - 1] : null }; this.pickups.set(id, pk); }
      pk.x = s.pk[i + 1]; pk.y = s.pk[i + 2];
    }
    for (const id of this.pickups.keys()) if (!seenPk.has(id)) this.pickups.delete(id);

    this.dig = new Map();
    for (let i = 0; i < s.dg.length; i += 2) this.dig.set(s.dg[i], s.dg[i + 1] / 100);
    this.pois = s.poi.map(([id, k, x, y, looted]) => ({ id, kind: POI_KINDS[k], x, y, looted: !!looted }));
    this.shrines = s.sh.map(([id, x, y, perk, progress, ttl]) => ({ id, x, y, perk: PERK_IDS[perk], progress, ttl }));
    this.fireZones = s.fz.map(([x, y, r]) => ({ x, y, r }));
  }

  // Pull our predicted position toward the authoritative one.
  reconcile(me) {
    if (!this.local || me.d || this.local.layer !== me.L) { this.local = { x: me.x, y: me.y, elevated: !!me.el, layer: me.L }; return; }
    const dx = me.x - this.local.x, dy = me.y - this.local.y;
    const err = Math.hypot(dx, dy);
    if (err > 110 || (!!me.el !== this.local.elevated && err > 24)) { this.local.x = me.x; this.local.y = me.y; this.local.elevated = !!me.el; return; }
    const k = this.moving ? 0.06 : 0.25;
    this.local.x += dx * k; this.local.y += dy * k;
  }

  update(dt, input) {
    const rt = this.renderTime();
    const me = this.me;
    const g = this.L();
    if (me && this.local && me.rd) { this.local.x = me.x; this.local.y = me.y; this.moving = false; }
    else if (me && this.local && !me.d && g) {
      this.moving = !!(input.mx || input.my);
      if (this.moving) {
        const sprint = input.sp && me.st > 1 ? SPRINT_MULT : 1;
        const spd = (me.spd || 175) * sprint;
        stepPlayer(this.local, input.mx * spd * dt, input.my * spd * dt, g, this.sAt, PLAYER_RADIUS);
      }
    }
    for (const p of this.players.values()) {
      if (p.id === this.you && this.local && !p.d) {
        const ox = p.rx ?? this.local.x, oy = p.ry ?? this.local.y;
        p.rx = this.local.x; p.ry = this.local.y; p.ra = input.a;
        p.moved = Math.hypot(p.rx - ox, p.ry - oy);
      } else {
        p.track.sample(rt);
        p.rx = p.track.rx; p.ry = p.track.ry; p.ra = p.track.ra;
        p.moved = Math.hypot(p.track.vx, p.track.vy);
      }
      // smoothed speed drives a steady walk cycle (no stutter between snapshots)
      p.speedSm = lerp(p.speedSm || 0, p.moved / Math.max(dt, 1e-3), Math.min(1, dt * 10));
      p.walk += p.speedSm * dt * 0.16;
      p.rz = lerp(p.rz, p.el ? 30 : 0, Math.min(1, dt * 10));
      p.recoil = Math.max(0, p.recoil - dt * 8);
    }
    for (const z of this.enemies.values()) {
      z.track.sample(rt);
      z.rx = z.track.rx; z.ry = z.track.ry; z.ra = z.track.ra;
      z.speedSm = lerp(z.speedSm || 0, Math.hypot(z.track.vx, z.track.vy) / Math.max(dt, 1e-3), Math.min(1, dt * 8));
      z.walk += z.speedSm * dt * 0.14;
    }
    for (const r of this.robots.values()) { r.track.sample(rt); r.rx = r.track.rx; r.ry = r.track.ry; r.ra = r.track.ra; }
    const k = Math.min(1, dt * 12);
    for (const st of this.structures.values()) if (st.a !== undefined) st.ra = lerpAngle(st.ra, st.a, k);
    this.hq.ra = lerpAngle(this.hq.ra, this.hq.a, k);
    for (const pr of this.projectiles.values()) { pr.x += pr.vx * dt; pr.y += pr.vy * dt; }
    for (const pk of this.pickups.values()) { pk.rx = lerp(pk.rx, pk.x, k); pk.ry = lerp(pk.ry, pk.y, k); }
  }
}
