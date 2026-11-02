// Canvas 2D renderer with a tilted 3/4 camera ("2.5D"): the ground plane is squashed by
// VIEW_TILT while units and buildings stand upright, extrude real height and are depth-sorted.
//
// This file holds the core (camera, cached ground chunks, terrain blocks, lighting, weather,
// particles). Building art lives in art/structures.js, units/projectiles in art/units.js.
import {
  TILE, VIEW_TILT, STRUCTURES, ORE_IDS, RESOURCES, PERKS, BUILD_RANGE, isOreTile, oreOfTile, sunPos,
  S_DUST, S_RIDGE, S_HQ, S_CRATER, S_ICE, S_VENT, S_RUIN, S_DARK, U_FLOOR, U_ROCK, U_HARD, U_BEDROCK, U_RUIN_FLOOR, U_RUIN_WALL,
} from '/shared/defs.js';
import { drawStructure, drawHq, drawWires, drawDomes, structHeight, mountLift, drawBuildGhost } from './art/structures.js';
import { drawPlayer, drawEnemy, drawRobot, drawProjectile, drawPickup, drawPoi, drawShrine } from './art/units.js';

export const T = VIEW_TILT;
export const TAU = Math.PI * 2;
const CHUNK = 512;
const PLAYER_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#34d399', '#fb923c'];
export const playerColor = (id) => PLAYER_COLORS[id % PLAYER_COLORS.length];

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
export const rnd = (a, b) => a + Math.random() * (b - a);
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const SURFACE_COLORS = {
  [S_DUST]: ['#5d5246', '#584d42'], [S_DARK]: ['#3f3935', '#3b3532'], [S_CRATER]: ['#4b4139', '#473e36'],
  [S_ICE]: ['#8ea3b3', '#869cad'], [S_VENT]: ['#4f3426', '#4a3022'], [S_RUIN]: ['#3a3631', '#3a3631'],
  [S_RIDGE]: ['#4b423c', '#4b423c'], [S_HQ]: ['#4b5563', '#4b5563'],
};

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cam = { x: 0, y: 0 };
    this.camInit = false;
    this.shake = 0;
    this.particles = [];
    this.decals = [];
    this.wrecks = [];
    this.texts = [];
    this.lines = [];
    this.rings = [];
    this.flashes = [];
    this.ripples = [];
    this.chunks = new Map();
    this.chunkLayer = -1;
    this.dark = document.createElement('canvas');
    this.rain = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.6 }));
    this.stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), b: Math.random() }));
    this.lightning = 0;
    this.time = 0;
    this.quality = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    for (const c of [this.canvas, this.dark]) { c.width = this.w * dpr; c.height = this.h * dpr; }
  }

  // ------------------------------------------------------------------ coordinates
  screenToWorld(mx, my) { return { x: mx + this.cam.x, y: (my + this.cam.y) / T }; }
  visible(x, y, pad = 80) {
    const sx = x - this.cam.x, sy = y * T - this.cam.y;
    return sx > -pad && sy > -pad - 100 && sx < this.w + pad && sy < this.h + pad;
  }
  structHeight(st) { return structHeight(st); }
  mountLift(st) { return mountLift(this, st); }

  pickStructure(mx, my) {
    const sx = mx + this.cam.x, sy = my + this.cam.y;
    let best = null, bestDepth = -1;
    for (const st of this.world.structures.values()) {
      const n = st.def.size || 1, x0 = st.tx * TILE, h = structHeight(st) + (st.mount ? mountLift(this, st) : 0);
      if (sx < x0 || sx > x0 + n * TILE) continue;
      if (sy < st.ty * TILE * T - h - 8 || sy > (st.ty + n) * TILE * T) continue;
      const depth = st.ty + n + (st.mount ? 0.5 : 0);
      if (depth > bestDepth) { bestDepth = depth; best = st; }
    }
    return best;
  }

  // ------------------------------------------------------------------ effects
  addDecal(x, y, r, color, life = 45) { this.decals.push({ x, y, r, color, life, rot: Math.random() * TAU, n: 3 + (Math.random() * 4 | 0) }); if (this.decals.length > 500) this.decals.shift(); }
  particle(o) { this.particles.push({ z: 0, vz: 0, g: 0, size: 3, kind: 'p', grow: 0, rot: 0, vr: 0, ...o, max: o.life }); }
  burst(x, y, n, color, speed = 120, size = 3, life = 0.6, z = 10, opts = {}) {
    n = Math.ceil(n * this.quality);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.3 + Math.random());
      this.particle({ x, y, z, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rnd(20, 160) * (opts.up ?? 1), g: opts.g ?? 380, life: life * rnd(0.6, 1.2), color, size: size * rnd(0.5, 1.2), kind: opts.kind || 'p', vr: opts.kind === 'gib' ? rnd(-10, 10) : 0 });
    }
    if (this.particles.length > 3500) this.particles.splice(0, this.particles.length - 3500);
  }
  smoke(x, y, z, n = 1, color = 'rgba(80,80,80,', size = 8, life = 1.4) {
    for (let i = 0; i < n; i++) this.particle({ x: x + rnd(-4, 4), y: y + rnd(-4, 4), z, vx: rnd(-10, 10), vy: rnd(-10, 10), vz: rnd(20, 45), life, color, size, kind: 's', grow: 14 });
  }
  floatText(x, y, z, text, color, big = false) { this.texts.push({ x, y, z, text, color, big, life: 0.9, vx: rnd(-20, 20) }); }
  line(pts, color, width, life, z = 0, glow = 6) { this.lines.push({ pts, color, width, life, max: life, z, glow }); }
  ring(x, y, r, color, life = 0.5) { this.rings.push({ x, y, r, color, life, max: life }); }
  flash(x, y, r, life = 0.12, z = 10, color = null) { this.flashes.push({ x, y, z, r, life, max: life, color }); }
  addShake(v) { this.shake = Math.min(20, this.shake + v); }
  wreck(x, y, type, a, size) { this.wrecks.push({ x, y, type, a, size, t: this.time }); if (this.wrecks.length > 220) this.wrecks.shift(); }

  // ------------------------------------------------------------------ ground chunks (cached)
  chunk(layer, cx, cy) {
    if (this.chunkLayer !== layer) { this.chunks.clear(); this.chunkLayer = layer; }
    const key = cx * 1000 + cy;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = CHUNK; c.height = CHUNK;
    const g = c.getContext('2d');
    const L = this.world.L(layer);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const tx0 = Math.floor(x0 / TILE), ty0 = Math.floor(y0 / TILE), n = CHUNK / TILE;
    for (let ty = ty0; ty < ty0 + n && ty < L.h; ty++) {
      for (let tx = tx0; tx < tx0 + n && tx < L.w; tx++) {
        const t = L.terrain[ty * L.w + tx];
        const px = tx * TILE - x0, py = ty * TILE - y0;
        const hv = hash(tx, ty);
        if (layer === 0) {
          const pal = SURFACE_COLORS[t] || SURFACE_COLORS[S_DUST];
          g.fillStyle = hv < 0.5 ? pal[0] : pal[1];
        } else {
          g.fillStyle = t === U_RUIN_FLOOR || t === U_RUIN_WALL ? (hv < 0.5 ? '#3b3528' : '#352f24') : (hv < 0.5 ? '#2a2724' : '#25221f');
        }
        g.fillRect(px, py, TILE, TILE);
        // per-tile detail
        if (layer === 0) {
          if (t === S_ICE) { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + hv * 30, py); g.lineTo(px + 16, py + 16 + hv * 10); g.lineTo(px + 32, py + hv * 20); g.stroke(); }
          if (t === S_VENT) { g.fillStyle = 'rgba(255,120,40,0.35)'; g.beginPath(); g.arc(px + 16, py + 16, 6 + hv * 6, 0, TAU); g.fill(); }
          if (t === S_CRATER) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(px, py, TILE, TILE); }
        } else if (t === U_RUIN_FLOOR) {
          g.strokeStyle = 'rgba(253,224,71,0.08)'; g.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
        }
        if (layer === 0 && !L.solid[ty * L.w + tx]) { // shade open ground next to cliffs
          const sol = (dx, dy) => { const x = tx + dx, y = ty + dy; return x >= 0 && y >= 0 && x < L.w && y < L.h && L.solid[y * L.w + x] && L.terrain[y * L.w + x] !== S_HQ; };
          const edgeShade = (x0, y0, x1, y1, a) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(px, py, TILE, TILE); };
          if (sol(0, -1)) edgeShade(px, py, px, py + TILE * 0.5, 0.22); // contact shadow (the sun casts the long one)
          if (sol(-1, 0)) edgeShade(px, py, px + TILE * 0.6, py, 0.35);
          if (sol(1, 0)) edgeShade(px + TILE, py, px + TILE * 0.5, py, 0.25);
          if (sol(0, 1)) edgeShade(px, py + TILE, px, py + TILE * 0.6, 0.3);
        }
      }
    }
    // speckles, pebbles, small craters
    let seed = (cx * 7919 + cy * 104729 + layer * 31) | 1;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,240,220,0.06)' : 'rgba(0,0,0,0.12)';
      const s = 1 + r() * 3;
      g.fillRect(r() * CHUNK, r() * CHUNK, s, s);
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = layer === 0 ? 'rgba(160,140,120,0.35)' : 'rgba(120,110,100,0.25)';
      g.beginPath(); g.ellipse(r() * CHUNK, r() * CHUNK, 2 + r() * 4, 1.5 + r() * 2.5, r() * 3, 0, TAU); g.fill();
    }
    if (layer === 0) for (let i = 0; i < 4; i++) { // micro craters
      const x = r() * CHUNK, y = r() * CHUNK, rad = 8 + r() * 26;
      const gr = g.createRadialGradient(x - rad * 0.2, y - rad * 0.2, rad * 0.2, x, y, rad);
      gr.addColorStop(0, 'rgba(0,0,0,0.18)'); gr.addColorStop(0.8, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(255,240,220,0.1)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.022)'; g.lineWidth = 1;
    for (let x = 0; x <= CHUNK; x += TILE) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CHUNK); g.stroke(); }
    for (let y = 0; y <= CHUNK; y += TILE) { g.beginPath(); g.moveTo(0, y); g.lineTo(CHUNK, y); g.stroke(); }
    this.chunks.set(key, c);
    if (this.chunks.size > 60) this.chunks.delete(this.chunks.keys().next().value);
    return c;
  }

  // Ground chunks bake in cliff shadows, so a mined tile redraws its chunk (and its neighbours').
  invalidateTile(layer, i) {
    if (layer !== this.chunkLayer) return;
    const L = this.world.L(layer);
    const tx = i % L.w, ty = (i / L.w) | 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cx = Math.floor(((tx + dx) * TILE) / CHUNK), cy = Math.floor(((ty + dy) * TILE) / CHUNK);
      this.chunks.delete(cx * 1000 + cy);
    }
  }

  // ------------------------------------------------------------------ primitives
  box(x, y, w, d, h, top, front, z = 0) {
    const { ctx } = this;
    const topY = y * T - h - z, frontY = (y + d) * T - h - z;
    ctx.fillStyle = front; ctx.fillRect(x, frontY, w, h);
    ctx.fillStyle = top; ctx.fillRect(x, topY, w, d * T);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, topY, w, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x, frontY + h - 2, w, 2);
    return { topY, frontY };
  }
  bar(x, y, w, frac, color, bg = 'rgba(0,0,0,0.65)') {
    const { ctx } = this;
    ctx.fillStyle = bg; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), 3);
  }
  prompt(x, y, text, color = '#fbbf24') {
    const { ctx } = this;
    ctx.font = '700 12px Rajdhani'; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 14;
    const bob = Math.sin(this.time * 4) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(x - w / 2, y - 14 + bob, w, 18);
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - 14 + bob, w, 18);
    ctx.fillStyle = '#fde68a'; ctx.fillText(text, x, y - 1 + bob);
  }

  // ------------------------------------------------------------------ main draw
  draw(dt, view) {
    const { ctx, world } = this;
    this.time = performance.now() / 1000; // same clock the world state stamps births/hits with
    const snap = world.snap;
    const L = world.L();
    if (!L) return;
    const underground = world.layer > 0;
    if (view.mouse && !view.build && !view.wire) this.look = { x: (view.mouse.x - this.w / 2) * 0.12, y: (view.mouse.y - this.h / 2) * 0.12 };
    const look = this.look || { x: 0, y: 0 };
    const tx = view.focus.x - this.w / 2 + look.x, ty = view.focus.y * T - (view.focusZ || 0) - this.h / 2 + look.y;
    if (!this.camInit) { this.cam.x = tx; this.cam.y = ty; this.camInit = true; }
    const k = Math.min(1, dt * 8);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k;
    const W = L.w * TILE, H = L.h * TILE;
    this.cam.x = Math.max(-80, Math.min(W - this.w + 80, this.cam.x));
    this.cam.y = Math.max(-160, Math.min(H * T - this.h + 80, this.cam.y));
    this.shake = Math.max(snap?.wx === 'storm' && !underground ? 1.5 : 0, this.shake - dt * 40);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const now = this.time;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = underground ? '#050403' : '#06070b';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!underground) this.drawStars();
    ctx.save();
    ctx.translate(-Math.round(this.cam.x) + sx, -Math.round(this.cam.y) + sy);

    // ---- ground plane (squashed)
    ctx.save();
    ctx.scale(1, T);
    const gx0 = Math.max(0, Math.floor(this.cam.x / CHUNK)), gx1 = Math.min(Math.ceil(W / CHUNK) - 1, Math.floor((this.cam.x + this.w) / CHUNK));
    const gy0 = Math.max(0, Math.floor(this.cam.y / T / CHUNK)), gy1 = Math.min(Math.ceil(H / CHUNK) - 1, Math.floor((this.cam.y + this.h) / T / CHUNK));
    for (let cy = gy0; cy <= gy1; cy++) for (let cx = gx0; cx <= gx1; cx++) ctx.drawImage(this.chunk(world.layer, cx, cy), cx * CHUNK, cy * CHUNK);
    if (!underground && snap?.tf > 0) { // terraforming slowly greens the regolith
      ctx.fillStyle = `rgba(70,150,90,${Math.min(0.35, snap.tf / 100 * 0.35)})`;
      ctx.fillRect(this.cam.x, this.cam.y / T, this.w, this.h / T);
    }
    this.drawGround(dt, now, view);
    if (!underground) this.drawSunShadows(L);
    ctx.restore();

    // ---- upright, depth-sorted pass
    const items = [];
    const add = (d, fn) => items.push({ d, fn });
    this.collectTerrainBlocks(L, add, now);
    if (!underground) { const hb = (world.hqTiles[world.hqTiles.length - 1][1] + 1) * TILE; add(hb - 1, () => drawHq(this, now, view)); }
    for (const st of world.structures.values()) if (this.visible(st.x, st.y, 160)) add((st.ty + (st.def.size || 1)) * TILE - 1 - (st.def.h ? 0 : 40) + (st.mount ? 0.5 : 0), () => drawStructure(this, st, now, view));
    for (const poi of world.pois) if (this.visible(poi.x, poi.y, 120)) add(poi.y + 10, () => drawPoi(this, poi, now, view));
    for (const sh of world.shrines) add(sh.y, () => drawShrine(this, sh, now));
    for (const pk of world.pickups.values()) if (this.visible(pk.rx, pk.ry)) add(pk.ry, () => drawPickup(this, pk, now));
    for (const z of world.enemies.values()) if (this.visible(z.rx, z.ry)) add(z.ry, () => drawEnemy(this, z, now));
    for (const p of world.players.values()) if (!p.d && p.L === world.layer) add(p.ry + (p.el ? TILE : 0), () => drawPlayer(this, p, now, view));
    for (const r of world.robots.values()) add(r.ry + 20, () => drawRobot(this, r, now));
    for (const pr of world.projectiles.values()) add(pr.y, () => drawProjectile(this, pr, now));
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.fn();

    drawWires(this, now, view);
    drawDomes(this, now, view);
    this.drawParticles(dt);
    if (view.build) drawBuildGhost(this, view);
    ctx.restore();

    this.drawWeather(dt, snap, now, underground);
    this.drawLighting(snap, now, dt, underground, view);
    this.drawTexts(dt);
  }

  drawStars() {
    const { ctx } = this;
    for (const s of this.stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + s.b * 0.6 * (0.7 + Math.sin(this.time * 2 + s.x * 40) * 0.3)})`;
      ctx.fillRect(((s.x * 3000 - this.cam.x * 0.05) % this.w + this.w) % this.w, ((s.y * 2000 - this.cam.y * 0.05) % this.h + this.h) % this.h, 1.5, 1.5);
    }
  }

  // ------------------------------------------------------------------ terrain blocks (ridges, ruins, rock)
  collectTerrainBlocks(L, add, now) {
    const tx0 = Math.max(0, Math.floor(this.cam.x / TILE) - 1), tx1 = Math.min(L.w - 1, Math.ceil((this.cam.x + this.w) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(this.cam.y / T / TILE) - 1), ty1 = Math.min(L.h - 1, Math.ceil((this.cam.y + this.h + 120) / T / TILE) + 1);
    const under = L.id > 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * L.w + tx;
        if (!L.solid[i] || L.terrain[i] === S_HQ && !under) continue;
        add((ty + 1) * TILE - 2, () => this.drawBlock(L, tx, ty, i, now, under));
      }
    }
  }

  drawBlock(L, tx, ty, i, now, under) {
    const { ctx } = this;
    const t = L.terrain[i];
    const hv = hash(tx, ty);
    const x = tx * TILE, y = ty * TILE;
    const southOpen = ty + 1 >= L.h || !L.solid[i + L.w];
    let h, top, front;
    if (!under) {
      if (t === S_RUIN) { h = 34; top = '#4a4438'; front = '#2e2a22'; }
      else { h = 34 + hv * 14; top = hv < 0.5 ? '#a8957f' : '#9e8b76'; front = '#3c322a'; }
    } else {
      h = 40;
      if (t === U_BEDROCK) { top = '#141210'; front = '#0c0b0a'; }
      else if (t === U_RUIN_WALL) { top = '#4a4232'; front = '#2f2a1f'; }
      else if (t === U_HARD) { top = hv < 0.5 ? '#3a3633' : '#36322f'; front = '#211e1c'; }
      else { top = hv < 0.5 ? '#5a4f45' : '#544a40'; front = '#332c26'; }
    }
    const dig = this.world.dig.get(i) || 0;
    const jitter = dig ? (Math.random() - 0.5) * 2 * dig : 0;
    const topY = y * T - h;
    if (southOpen) {
      const fy = (y + TILE) * T - h;
      if (!under) { // cliff face fades darker toward its foot
        const gr = ctx.createLinearGradient(0, fy, 0, fy + h);
        gr.addColorStop(0, '#5a4a3d'); gr.addColorStop(1, '#241d18');
        ctx.fillStyle = gr;
      } else ctx.fillStyle = front;
      ctx.fillRect(x + jitter, fy, TILE, h);
    }
    ctx.fillStyle = top; ctx.fillRect(x + jitter, topY, TILE, TILE * T);
    if (!under && t === S_RIDGE) { // sunlit plateau texture
      ctx.fillStyle = 'rgba(255,240,215,0.08)'; ctx.fillRect(x + 3 + hv * 8, topY + 3, 8 + hv * 6, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 14 - hv * 6, topY + TILE * T - 9, 10, 3);
    }
    // rim highlights on exposed edges
    ctx.fillStyle = under ? 'rgba(255,255,255,0.07)' : 'rgba(255,245,225,0.35)';
    if (ty === 0 || !L.solid[i - L.w]) ctx.fillRect(x, topY, TILE, 2);
    if (tx === 0 || !L.solid[i - 1]) ctx.fillRect(x, topY, 2, TILE * T);
    if (!under) { // dark rim on the shadowed sides
      ctx.fillStyle = 'rgba(20,14,10,0.55)';
      if (tx + 1 >= L.w || !L.solid[i + 1]) ctx.fillRect(x + TILE - 2, topY, 2, TILE * T);
      if (southOpen) ctx.fillRect(x, topY + TILE * T - 1.5, TILE, 1.5);
    }
    // texture: strata lines / boulders
    if (southOpen) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 1; k < 3; k++) ctx.fillRect(x, (y + TILE) * T - h + k * h / 3 + hv * 3, TILE, 1); }
    if (!under && t === S_RIDGE && hv > 0.6) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.ellipse(x + 10 + hv * 10, topY + 8, 6, 3, 0, 0, TAU); ctx.fill(); }
    if (t === S_RUIN || t === U_RUIN_WALL) { // ancient glyphs
      ctx.fillStyle = `rgba(56,189,248,${0.25 + Math.sin(now * 2 + hv * 10) * 0.15})`;
      if (southOpen) { ctx.fillRect(x + 6 + hv * 10, (y + TILE) * T - h + 8, 3, 10); ctx.fillRect(x + 12 + hv * 8, (y + TILE) * T - h + 12, 8, 2); }
    }
    if (isOreTile(t)) { // ore crystals poking out of the rock
      const res = RESOURCES[oreOfTile(t)];
      const glint = Math.sin(now * 3 + hv * 20) > 0.92;
      for (let k = 0; k < 4; k++) {
        const ox = x + 5 + ((hv * 97 + k * 7.3) % 1) * 22, oy = topY + 3 + ((hv * 53 + k * 3.1) % 1) * (TILE * T - 6);
        ctx.fillStyle = shade(res.color, 0.75);
        ctx.beginPath(); ctx.moveTo(ox, oy - 5); ctx.lineTo(ox + 3, oy); ctx.lineTo(ox, oy + 3); ctx.lineTo(ox - 3, oy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = res.color; ctx.fillRect(ox - 1, oy - 3, 2, 2);
      }
      if (southOpen) { ctx.fillStyle = shade(res.color, 0.6); for (let k = 0; k < 3; k++) ctx.fillRect(x + 4 + k * 9 + hv * 4, (y + TILE) * T - h + 10 + k * 7, 5, 4); }
      if (glint) { ctx.fillStyle = '#fff'; ctx.fillRect(x + 14, topY + 6, 2, 2); }
    }
    if (dig > 0) { // cracks while being dug
      ctx.strokeStyle = `rgba(0,0,0,${0.4 + dig * 0.4})`; ctx.lineWidth = 1.2;
      ctx.beginPath();
      const cx = x + 16, cy = topY + TILE * T / 2;
      for (let k = 0; k < 2 + dig * 6; k++) {
        const a = hv * 10 + k * 1.7, len = 6 + dig * 14;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * T);
      }
      ctx.stroke();
      ctx.fillStyle = `rgba(255,200,120,${dig * 0.25})`; ctx.fillRect(x, topY, TILE, TILE * T);
    }
  }

  // Long shadows from the sun: rock and buildings throw them west in the morning, east at dusk,
  // short at noon, none at night. One path, one fill, so overlaps don't double-darken.
  drawSunShadows(L) {
    const { ctx, world } = this;
    const sp = sunPos(world.snap?.dp ?? 0.25);
    if (!sp.up || sp.elev < 0.05) return;
    const len = 0.9 / Math.max(0.22, sp.elev);
    const vx = -sp.x * len, vy = 0.35 * len; // sun sits a little north, so shadows lean south
    const alpha = Math.min(0.42, sp.elev * 1.4) * (world.snap?.wx === 'dust' ? 0.5 : 1);
    ctx.beginPath();
    const sweep = (x, y, w, d, h) => {
      const dx = vx * h, dy = vy * h, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (Math.min(w, d) * 0.5)));
      for (let k = 0; k <= n; k++) ctx.rect(x + (dx * k) / n, y + (dy * k) / n, w, d);
    };
    const tx0 = Math.max(0, Math.floor(this.cam.x / TILE) - 3), tx1 = Math.min(L.w - 1, Math.ceil((this.cam.x + this.w) / TILE) + 3);
    const ty0 = Math.max(0, Math.floor(this.cam.y / T / TILE) - 3), ty1 = Math.min(L.h - 1, Math.ceil((this.cam.y + this.h) / T / TILE) + 2);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * L.w + tx;
      if (!L.solid[i] || L.terrain[i] === S_HQ) continue;
      sweep(tx * TILE, ty * TILE, TILE, TILE, (L.terrain[i] === S_RUIN ? 34 : 34 + hash(tx, ty) * 14));
    }
    for (const st of world.structures.values()) {
      if (st.layer !== 0 || !this.visible(st.x, st.y, 200) || !st.def.h) continue;
      const S = (st.def.size || 1) * TILE;
      sweep(st.tx * TILE + 3, st.ty * TILE + 3, S - 6, S - 6, structHeight(st) * 0.8);
    }
    if (world.hqTiles?.length) { const [hx, hy] = world.hqTiles[0]; sweep(hx * TILE, hy * TILE, 3 * TILE, 3 * TILE, 70); }
    ctx.fillStyle = `rgba(8,6,4,${alpha})`;
    ctx.fill();
  }

  // ------------------------------------------------------------------ ground layer (ctx scaled by T)
  drawGround(dt, now, view) {
    const { ctx, world } = this;
    for (const d of this.decals) {
      d.life -= dt;
      if (!this.visible(d.x, d.y)) continue;
      ctx.globalAlpha = Math.min(0.6, d.life / 12);
      ctx.fillStyle = d.color;
      for (let i = 0; i < d.n; i++) {
        const a = d.rot + i * 2.1, o = d.r * 0.5 * (i % 2);
        ctx.beginPath(); ctx.arc(d.x + Math.cos(a) * o, d.y + Math.sin(a) * o, d.r * (1 - i * 0.12), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.decals = this.decals.filter((d) => d.life > 0);
    // robot wrecks: scorched plates and scattered parts
    for (const w of this.wrecks) {
      const age = now - w.t;
      if (age > 14 || !this.visible(w.x, w.y)) continue;
      ctx.globalAlpha = Math.min(1, (14 - age) / 4) * 0.9;
      ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.a);
      ctx.fillStyle = 'rgba(20,18,16,0.6)'; ctx.beginPath(); ctx.ellipse(0, 0, w.size * 1.6, w.size * 1.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3f3f46'; ctx.fillRect(-w.size * 0.8, -w.size * 0.5, w.size * 1.2, w.size);
      ctx.fillStyle = '#52525b'; ctx.fillRect(w.size * 0.3, -w.size * 0.2, w.size * 0.7, w.size * 0.4);
      if (age < 3 && Math.random() < 0.1) this.burst(w.x, w.y, 1, '#fbbf24', 40, 2, 0.4, 4, { kind: 'spark' });
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.wrecks = this.wrecks.filter((w) => now - w.t < 14);

    for (const f of world.fireZones) {
      const g = ctx.createRadialGradient(f.x, f.y, 4, f.x, f.y, f.r);
      g.addColorStop(0, 'rgba(255,220,120,0.65)'); g.addColorStop(0.5, 'rgba(234,88,12,0.45)'); g.addColorStop(1, 'rgba(120,30,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.95 + Math.sin(now * 13) * 0.05), 0, TAU); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU, d = Math.random() * f.r * 0.9;
        this.particle({ x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d, z: 0, vx: rnd(-8, 8), vy: rnd(-8, 8), vz: rnd(40, 90), life: rnd(0.4, 0.8), color: Math.random() < 0.5 ? '#fb923c' : '#fde047', size: rnd(3, 7), kind: 'c', grow: -4 });
      }
    }

    // ground-level building effects
    for (const st of world.structures.values()) {
      if (!this.visible(st.x, st.y, 400)) continue;
      const d = st.def;
      if (st.kind === 'shock_plate') {
        ctx.fillStyle = st.powered ? '#3f3f46' : '#27272a'; ctx.fillRect(st.tx * TILE + 2, st.ty * TILE + 2, TILE - 4, TILE - 4);
        ctx.strokeStyle = st.powered ? `rgba(250,204,21,${0.5 + Math.random() * 0.5})` : '#52525b'; ctx.lineWidth = 2;
        ctx.strokeRect(st.tx * TILE + 5, st.ty * TILE + 5, TILE - 10, TILE - 10);
      } else if (st.kind === 'stasis_field' && st.powered && st.built) {
        const rr = d.radius * (1 + 0.2 * (st.level - 1));
        const g = ctx.createRadialGradient(st.x, st.y, 4, st.x, st.y, rr);
        g.addColorStop(0, 'rgba(167,139,250,0.35)'); g.addColorStop(1, 'rgba(167,139,250,0.02)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(st.x, st.y, rr, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(196,181,253,0.5)'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) { const ph = (now * 0.6 + i / 3) % 1; ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.arc(st.x, st.y, rr * ph, 0, TAU); ctx.stroke(); }
        ctx.globalAlpha = 1;
      } else if (st.kind === 'floodlight' && st.powered && st.built) {
        const a = st.ra || 0, Lr = d.light;
        const g = ctx.createRadialGradient(st.x, st.y, 10, st.x, st.y, Lr);
        g.addColorStop(0, 'rgba(254,240,138,0.3)'); g.addColorStop(1, 'rgba(254,240,138,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.arc(st.x, st.y, Lr, a - 0.35, a + 0.35); ctx.closePath(); ctx.fill();
      } else if ((st.kind === 'repair_station' || st.kind === 'o2_station') && st.powered && st.built) {
        const ph = (now * 0.5 + st.id * 0.1) % 1, R = st.kind === 'o2_station' ? 170 : d.range;
        ctx.strokeStyle = st.kind === 'o2_station' ? `rgba(103,232,249,${0.3 * (1 - ph)})` : `rgba(74,222,128,${0.35 * (1 - ph)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(st.x, st.y, R * ph, 0, TAU); ctx.stroke();
      } else if (st.kind === 'borer' && st.built) { // planned tunnel line
        const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]][st.rot || 0];
        ctx.strokeStyle = 'rgba(234,179,8,0.25)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x + dirs[0] * d.reach * TILE, st.y + dirs[1] * d.reach * TILE); ctx.stroke(); ctx.setLineDash([]);
      }
      if ((d.shop || st.kind === 'elevator') && view.me && Math.hypot(view.me.rx - st.x, view.me.ry - st.y) < 160) {
        ctx.strokeStyle = `rgba(250,204,21,${0.35 + Math.sin(now * 4) * 0.15})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.kind === 'elevator' ? 110 : 130, 0, TAU); ctx.stroke();
      }
    }

    for (const sh of world.shrines) {
      const color = PERKS[sh.perk]?.color || '#fff';
      ctx.save(); ctx.translate(sh.x, sh.y); ctx.rotate(now * 0.8);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.stroke();
      ctx.restore(); ctx.globalAlpha = 1;
      ctx.strokeStyle = color; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 34, -Math.PI / 2, -Math.PI / 2 + TAU * (sh.progress / 100)); ctx.stroke();
    }

    // shadows
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    const shadow = (x, y, rx, ry = rx * 0.8) => { ctx.beginPath(); ctx.ellipse(x + 4, y + 4, rx, ry, 0, 0, TAU); ctx.fill(); };
    for (const z of world.enemies.values()) if (this.visible(z.rx, z.ry)) shadow(z.rx + (z.flags & 16 ? 14 : 0), z.ry + (z.flags & 16 ? 10 : 0), (z.flags & 8 ? 34 : 10) * (z.flags & 16 ? 0.8 : 1));
    for (const p of world.players.values()) if (!p.d && !p.el && p.L === world.layer) shadow(p.rx, p.ry, 13);
    for (const r of world.robots.values()) shadow(r.rx, r.ry, 10, 8);

    for (const r of this.rings) {
      r.life -= dt;
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = Math.max(0, r.life / r.max);
      ctx.strokeStyle = r.color; ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.2 + 0.8 * t), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.rings = this.rings.filter((r) => r.life > 0);

    if (view.build) {
      const { tile, kind, valid, me } = view.build;
      if (me) { ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.setLineDash([10, 10]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(me.rx, me.ry, BUILD_RANGE, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      if (tile && kind) {
        const d = STRUCTURES[kind], S = (d.size || 1) * TILE;
        const x = tile[0] * TILE, y = tile[1] * TILE;
        ctx.fillStyle = valid ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'; ctx.fillRect(x, y, S, S);
        ctx.strokeStyle = valid ? '#22c55e' : '#ef4444'; ctx.lineWidth = 2; ctx.strokeRect(x, y, S, S);
        const rr = (d.turret?.range || d.radius || d.range || 0) * (view.build.mount ? 1.25 : 1);
        if (rr) { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.arc(x + S / 2, y + S / 2, rr, 0, TAU); ctx.stroke(); }
      }
    }
  }

  // ------------------------------------------------------------------ particles & beams
  drawParticles(dt) {
    const { ctx } = this;
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt; p.z += p.vz * dt;
      if (p.z < 0) {
        if (p.kind === 'shell' || p.kind === 'gib' || p.kind === 'p') { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
        else p.z = 0;
      }
      p.vx *= 0.97; p.vy *= 0.97;
      p.size = Math.max(0.5, p.size + p.grow * dt);
      p.rot += p.vr * dt;
      const a = Math.max(0, p.life / p.max);
      const sx = p.x, sy = p.y * T - p.z;
      if (p.kind === 's') { ctx.fillStyle = `${p.color}${(a * 0.45).toFixed(3)})`; ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, TAU); ctx.fill(); continue; }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === 'c') { ctx.beginPath(); ctx.arc(sx, sy, p.size, 0, TAU); ctx.fill(); }
      else if (p.kind === 'spark') { ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - p.vx * 0.03, sy - (p.vy * T - p.vz) * 0.03); ctx.stroke(); }
      else if (p.kind === 'shell' || p.kind === 'gib') { ctx.save(); ctx.translate(sx, sy); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
      else ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    ctx.lineCap = 'round';
    for (const l of this.lines) {
      l.life -= dt;
      const a = Math.max(0, l.life / l.max);
      const path = () => {
        ctx.beginPath(); ctx.moveTo(l.pts[0][0], l.pts[0][1] * T - (l.pts[0][2] ?? l.z));
        for (let i = 1; i < l.pts.length; i++) ctx.lineTo(l.pts[i][0], l.pts[i][1] * T - (l.pts[i][2] ?? l.z));
      };
      ctx.globalAlpha = a * 0.35; ctx.strokeStyle = l.color; ctx.lineWidth = l.width * 3.2; path(); ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = l.width; path(); ctx.stroke();
      ctx.globalAlpha = a * 0.9; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(0.6, l.width * 0.35); path(); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    this.lines = this.lines.filter((l) => l.life > 0);
  }

  // ------------------------------------------------------------------ weather, lighting, text
  drawWeather(dt, snap, now, underground) {
    if (!snap) return;
    const { ctx } = this;
    if (underground) { // drifting cave dust
      ctx.fillStyle = 'rgba(200,180,150,0.12)';
      for (const d of this.rain.slice(0, 80)) { d.y += dt * 0.01 * d.s; d.x += Math.sin(now + d.s * 9) * dt * 0.004; if (d.y > 1) d.y -= 1; ctx.fillRect(((d.x % 1) + 1) % 1 * this.w, d.y * this.h, 1.5, 1.5); }
      return;
    }
    if (snap.wx === 'dust' || snap.wx === 'storm') {
      ctx.fillStyle = snap.wx === 'storm' ? 'rgba(120,60,20,0.18)' : 'rgba(150,110,70,0.16)'; ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = 'rgba(210,170,120,0.35)';
      for (const d of this.rain) {
        d.x += dt * (snap.wx === 'storm' ? 0.9 : 0.35) * d.s; d.y += Math.sin(now * 2 + d.s * 9) * dt * 0.03;
        if (d.x > 1) { d.x -= 1; d.y = Math.random(); }
        ctx.fillRect(d.x * this.w, ((d.y % 1) + 1) % 1 * this.h, 3 * d.s, 1);
      }
    }
    if (snap.wx === 'storm') { // solar storm: aurora bands + radiation crackle
      for (let i = 0; i < 3; i++) {
        const y = this.h * (0.15 + i * 0.12) + Math.sin(now * 0.7 + i) * 30;
        const g = ctx.createLinearGradient(0, y - 40, 0, y + 40);
        const col = ['rgba(52,211,153,', 'rgba(168,85,247,', 'rgba(56,189,248,'][i];
        g.addColorStop(0, `${col}0)`); g.addColorStop(0.5, `${col}${0.12 + Math.sin(now * 3 + i) * 0.05})`); g.addColorStop(1, `${col}0)`);
        ctx.fillStyle = g; ctx.fillRect(0, y - 40, this.w, 80);
      }
      this.lightning -= dt;
      if (this.lightning < -2 && Math.random() < 0.01) { this.lightning = 0.2; this.onThunder?.(); }
      if (this.lightning > 0) { ctx.fillStyle = `rgba(220,230,255,${this.lightning * 1.5})`; ctx.fillRect(0, 0, this.w, this.h); }
    }
    if (snap.tf > 20) { // forming atmosphere: blue haze at the top of the view
      const g = ctx.createLinearGradient(0, 0, 0, this.h * 0.5);
      g.addColorStop(0, `rgba(96,165,250,${Math.min(0.25, snap.tf / 400)})`); g.addColorStop(1, 'rgba(96,165,250,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h * 0.5);
    }
    const v = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, this.w, this.h);
  }

  drawLighting(snap, now, dt, underground, view) {
    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    if (!snap) return;
    const sun = snap.sun ?? 1;
    const alpha = underground ? 0.93 : Math.min(0.93, (1 - sun) * 0.95 + (snap.wx === 'storm' ? 0.15 : snap.wx === 'dust' ? 0.08 : 0));
    if (alpha < 0.03) return;
    const c = this.dark.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = underground ? `rgba(3,2,2,${alpha})` : `rgba(4,6,18,${alpha})`;
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'destination-out';
    const light = (x, y, z, r, strength = 1) => {
      const sx = x - this.cam.x, sy = y * T - z - this.cam.y;
      if (sx < -r || sy < -r || sx > this.w + r || sy > this.h + r) return;
      const g = c.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(sx, sy, r, r * 0.8, 0, 0, TAU); c.fill();
    };
    const cone = (x, y, z, a, len, spread, strength = 0.95) => {
      const sx = x - this.cam.x, sy = y * T - z - this.cam.y;
      const g = c.createRadialGradient(sx, sy, 0, sx, sy, len);
      g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      const ay = Math.atan2(Math.sin(a) * T, Math.cos(a));
      c.beginPath(); c.moveTo(sx, sy); c.arc(sx, sy, len, ay - spread, ay + spread); c.closePath(); c.fill();
    };
    const w = this.world;
    if (!underground && w.hq.powered) light(w.hq.x, w.hq.y, 30, 380, 0.9);
    for (const p of w.players.values()) {
      if (p.d || p.L !== w.layer) continue;
      light(p.rx, p.ry, p.rz + 10, underground ? 230 : 300, 0.9);
      cone(p.rx, p.ry, p.rz + 20, p.ra, underground ? 520 : 600, 0.42); // helmet lamp
    }
    for (const r of w.robots.values()) light(r.rx, r.ry, 20, 130, 0.7);
    for (const st of w.structures.values()) {
      if (!st.built || !this.visible(st.x, st.y, 500)) continue;
      const on = st.powered && !(st.flicker && Math.random() < 0.5);
      if (st.kind === 'floodlight' && on) {
        light(st.x, st.y, 0, 230, 0.9);
        cone(st.x, st.y, 30, st.ra || 0, st.def.light * (1 + 0.2 * (st.level - 1)), 0.4);
      } else if (on && (st.def.draw || st.def.supply)) light(st.x, st.y, 15, st.def.size ? 230 : 120, 0.6);
      else if (st.def.capacity && st.charge > 5) light(st.x, st.y, 10, 90, 0.4);
    }
    if (!underground) {
      const L = w.L();
      const tx0 = Math.max(0, Math.floor(this.cam.x / TILE)), tx1 = Math.min(L.w - 1, Math.ceil((this.cam.x + this.w) / TILE));
      const ty0 = Math.max(0, Math.floor(this.cam.y / T / TILE)), ty1 = Math.min(L.h - 1, Math.ceil((this.cam.y + this.h) / T / TILE));
      for (let ty = ty0; ty <= ty1; ty += 1) for (let tx = tx0; tx <= tx1; tx += 1) if (L.terrain[ty * L.w + tx] === S_VENT) light(tx * TILE + 16, ty * TILE + 16, 0, 70 + Math.sin(now * 2 + tx) * 10, 0.55);
    } else { // glowing crystals & xenium veins
      const L = w.L();
      const tx0 = Math.max(0, Math.floor(this.cam.x / TILE)), tx1 = Math.min(L.w - 1, Math.ceil((this.cam.x + this.w) / TILE));
      const ty0 = Math.max(0, Math.floor(this.cam.y / T / TILE)), ty1 = Math.min(L.h - 1, Math.ceil((this.cam.y + this.h) / T / TILE));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const t = L.terrain[ty * L.w + tx];
        if (isOreTile(t) && (oreOfTile(t) === 'crystal' || oreOfTile(t) === 'xenium')) light(tx * TILE + 16, ty * TILE + 16, 40, 38, 0.3);
      }
    }
    for (const f of w.fireZones) light(f.x, f.y, 0, f.r * 2.6, 0.95);
    for (const sh of w.shrines) light(sh.x, sh.y, 30, 140, 0.8);
    for (const poi of w.pois) if (!poi.looted) light(poi.x, poi.y, 30, 130, 0.6);
    for (const f of this.flashes) light(f.x, f.y, f.z, f.r * 1.5, Math.min(1, f.life / f.max + 0.2));
    if (this.lightning > 0) { c.fillStyle = `rgba(0,0,0,${this.lightning * 3})`; c.fillRect(0, 0, this.w, this.h); }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.dark, 0, 0);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  drawTexts(dt) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      t.life -= dt; t.z += dt * 45; t.x += t.vx * dt;
      const pop = t.life > 0.75 ? 1 + (t.life - 0.75) * 3 : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life * 2));
      ctx.font = `bold ${Math.round((t.big ? 20 : 13) * pop)}px Rajdhani`;
      const sx = t.x - this.cam.x, sy = t.y * T - t.z - this.cam.y;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(t.text, sx + 1, sy + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    this.texts = this.texts.filter((t) => t.life > 0);
    if (this.texts.length > 160) this.texts.splice(0, this.texts.length - 160);
  }
}

export { ORE_IDS, RESOURCES };
