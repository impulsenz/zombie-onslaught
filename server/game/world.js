// World generation for the surface and the underground depths, flow-field pathfinding
// and a spatial hash.
import {
  TILE, MAP_W, MAP_H, UG_W, UG_H, HQ_SIZE, DEPTHS, DEPTH_ORES, ORE_IDS, MODULE_IDS, isSolid, SPAWN_RING,
  S_DUST, S_RIDGE, S_HQ, S_CRATER, S_ICE, S_VENT, S_RUIN, S_DARK,
  U_FLOOR, U_ROCK, U_HARD, U_BEDROCK, U_RUIN_FLOOR, U_RUIN_WALL, U_ORE,
} from '../../shared/defs.js';
import { tileCenter } from '../../shared/geometry.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise in [0,1] on a coarse lattice.
function valueNoise(rnd, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, () => rnd());
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const v = (a, b) => g[(iy + b) * gw + ix + a];
    return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty;
  };
}

function makeLayer(id, w, h, terrain) {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < solid.length; i++) solid[i] = isSolid(id, terrain[i]) ? 1 : 0;
  return { id, w, h, terrain, solid, structGrid: new Int32Array(w * h), flowDirty: true, flow: null, hash: new SpatialHash(64) };
}

export function refreshSolid(layer, i) { layer.solid[i] = isSolid(layer.id, layer.terrain[i]) ? 1 : 0; }

const pickWeighted = (rnd, weights) => {
  let total = 0;
  for (const k in weights) total += weights[k];
  let roll = rnd() * total;
  for (const k in weights) { roll -= weights[k]; if (roll <= 0) return k; }
  return Object.keys(weights)[0];
};

// ------------------------------------------------------------------ surface
export function generateSurface(seed) {
  const rnd = mulberry32(seed);
  const W = MAP_W, H = MAP_H;
  const t = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const hx = Math.floor(W / 2) - 1, hy = Math.floor(H / 2) - 1;
  const half = HQ_SIZE / 2;
  const hqC = { x: hx + half, y: hy + half };
  const dHq = (x, y) => Math.hypot(x + 0.5 - hqC.x, y + 0.5 - hqC.y);
  const edge = (x, y) => x < 4 || y < 4 || x >= W - 4 || y >= H - 4;

  // ground variety: dark regolith and ice sheets
  const n1 = valueNoise(rnd, W, H, 14), n2 = valueNoise(rnd, W, H, 20);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (n1(x, y) > 0.68) t[idx(x, y)] = S_DARK;
    else if (n2(x, y) > 0.74 && dHq(x, y) > 12) t[idx(x, y)] = S_ICE;
  }
  // craters with ridged rims (with gaps so they can be entered)
  const craters = [];
  for (let tries = 0; craters.length < 176 && tries < 6000; tries++) {
    const r = 4 + Math.floor(rnd() * 8);
    const cx = r + 5 + Math.floor(rnd() * (W - 2 * r - 10)), cy = r + 5 + Math.floor(rnd() * (H - 2 * r - 10));
    if (dHq(cx, cy) < r + 16 || craters.some((c) => Math.hypot(c.x - cx, c.y - cy) < c.r + r + 4)) continue;
    craters.push({ x: cx, y: cy, r });
    const gaps = [rnd() * Math.PI * 2, rnd() * Math.PI * 2];
    for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      if (!inside(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < r - 0.6) t[idx(x, y)] = S_CRATER;
      else if (d < r + 0.6) {
        const a = Math.atan2(y - cy, x - cx);
        if (!gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.45)) t[idx(x, y)] = S_RIDGE;
      }
    }
  }
  // mesas / rocky ridges (blobby random walks)
  for (let m = 0; m < 272; m++) {
    let x = 6 + Math.floor(rnd() * (W - 12)), y = 6 + Math.floor(rnd() * (H - 12));
    const len = 8 + Math.floor(rnd() * 22);
    for (let i = 0; i < len; i++) {
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const X = x + ox, Y = y + oy;
        if (inside(X, Y) && !edge(X, Y) && dHq(X, Y) > 15 && t[idx(X, Y)] !== S_CRATER) t[idx(X, Y)] = S_RIDGE;
      }
      if (rnd() < 0.5) x += rnd() < 0.5 ? -1 : 1; else y += rnd() < 0.5 ? -1 : 1;
    }
  }
  // geothermal vents (2x2)
  const vents = [];
  for (let tries = 0; vents.length < 80 && tries < 16000; tries++) {
    const x = 6 + Math.floor(rnd() * (W - 12)), y = 6 + Math.floor(rnd() * (H - 12));
    if (dHq(x, y) < 8 || dHq(x, y) > 45) continue;
    const tiles = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (tiles.some(([a, b]) => t[idx(a, b)] === S_RIDGE) || vents.some((v) => Math.hypot(v.x - x, v.y - y) < 8)) continue;
    for (const [a, b] of tiles) t[idx(a, b)] = S_VENT;
    vents.push({ x, y });
  }
  // HQ footprint + clear base area
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dHq(x, y) < 13 && t[idx(x, y)] === S_RIDGE) t[idx(x, y)] = S_DUST;
  const hqTiles = [];
  for (let y = 0; y < HQ_SIZE; y++) for (let x = 0; x < HQ_SIZE; x++) { hqTiles.push([hx + x, hy + y]); t[idx(hx + x, hy + y)] = S_HQ; }

  // points of interest: monolith ruins (data + modules, guarded) and crashed probes (resources)
  const pois = [];
  let pid = 1;
  for (let tries = 0; pois.filter((p) => p.kind === 'monolith').length < 40 && tries < 16000; tries++) {
    const x = 8 + Math.floor(rnd() * (W - 16)), y = 8 + Math.floor(rnd() * (H - 16));
    if (dHq(x, y) < 30 || pois.some((p) => Math.hypot(p.tx - x, p.ty - y) < 18)) continue;
    // 7x7 ruin enclosure with a doorway
    let ok = true;
    for (let yy = -3; yy <= 3 && ok; yy++) for (let xx = -3; xx <= 3; xx++) if (!inside(x + xx, y + yy) || t[idx(x + xx, y + yy)] === S_HQ) ok = false;
    if (!ok) continue;
    const door = Math.floor(rnd() * 4);
    for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
      const ring = Math.max(Math.abs(xx), Math.abs(yy)) === 3;
      const isDoor = (door === 0 && yy === 3 && Math.abs(xx) <= 1) || (door === 1 && yy === -3 && Math.abs(xx) <= 1)
        || (door === 2 && xx === 3 && Math.abs(yy) <= 1) || (door === 3 && xx === -3 && Math.abs(yy) <= 1);
      t[idx(x + xx, y + yy)] = ring && !isDoor ? S_RUIN : S_DARK;
    }
    pois.push({ id: pid++, layer: 0, kind: 'monolith', tx: x, ty: y, x: tileCenter(x), y: tileCenter(y), looted: false,
      loot: { res: { data: 1, crystal: 10 + Math.floor(rnd() * 15) }, module: MODULE_IDS[Math.floor(rnd() * MODULE_IDS.length)] }, guards: 2 });
  }
  for (let tries = 0; pois.filter((p) => p.kind === 'probe').length < 90 && tries < 16000; tries++) {
    const x = 6 + Math.floor(rnd() * (W - 12)), y = 6 + Math.floor(rnd() * (H - 12));
    if (dHq(x, y) < 18 || t[idx(x, y)] === S_RIDGE || t[idx(x, y)] === S_RUIN || pois.some((p) => Math.hypot(p.tx - x, p.ty - y) < 12)) continue;
    pois.push({ id: pid++, layer: 0, kind: 'probe', tx: x, ty: y, x: tileCenter(x), y: tileCenter(y), looted: false,
      loot: { res: { iron: 60 + Math.floor(rnd() * 80), copper: 30 + Math.floor(rnd() * 40), silicon: 10 + Math.floor(rnd() * 30) } }, angle: rnd() * 6.28 });
  }

  // spawn points: open ground on a ring around the colony, cleared so nothing spawns in rock
  const spawns = [];
  for (let k = 0; k < 220; k++) {
    const a = (k / 220) * Math.PI * 2, d = SPAWN_RING[0] + rnd() * (SPAWN_RING[1] - SPAWN_RING[0]);
    const x = Math.round(hqC.x + Math.cos(a) * d), y = Math.round(hqC.y + Math.sin(a) * d);
    if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) continue;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (t[idx(x + ox, y + oy)] !== S_RUIN) t[idx(x + ox, y + oy)] = S_DUST;
    spawns.push([x, y]);
  }

  const layer = makeLayer(0, W, H, t);
  return { layer, hqTiles, hq: { x: (hx + half) * TILE, y: (hy + half) * TILE }, spawns, pois, vents, craters };
}

// ------------------------------------------------------------------ underground depth
export function generateDepth(seed, depth, poiIdStart) {
  const rnd = mulberry32(seed * 31 + depth * 977);
  const W = UG_W, H = UG_H;
  const t = new Uint8Array(W * H).fill(U_ROCK);
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
  const dC = (x, y) => Math.hypot(x - cx, y - cy);

  // hard rock gets more common the deeper you go
  const hn = valueNoise(rnd, W, H, 9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hn(x, y) > 0.78 - depth * 0.05) t[idx(x, y)] = U_HARD;

  // natural caves: cellular automata in the outer regions
  const cave = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cave[idx(x, y)] = dC(x, y) > 14 && rnd() < 0.43 ? 1 : 0;
  for (let it = 0; it < 4; it++) {
    const next = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) n += cave[idx(x + ox, y + oy)];
      next[idx(x, y)] = n >= 5 ? 1 : 0;
    }
    cave.set(next);
  }
  for (let i = 0; i < cave.length; i++) if (cave[i]) t[i] = U_FLOOR;

  // ore veins
  const weights = DEPTH_ORES[depth];
  for (let v = 0; v < (80 + depth * 10) * 8; v++) {
    const ore = pickWeighted(rnd, weights);
    let x = 3 + Math.floor(rnd() * (W - 6)), y = 3 + Math.floor(rnd() * (H - 6));
    const len = 4 + Math.floor(rnd() * 10);
    for (let i = 0; i < len; i++) {
      if (inside(x, y) && t[idx(x, y)] !== U_FLOOR) t[idx(x, y)] = U_ORE + ORE_IDS.indexOf(ore);
      if (rnd() < 0.5) x += rnd() < 0.5 ? -1 : 1; else y += rnd() < 0.5 ? -1 : 1;
    }
  }

  // ancient ruins: walled rooms with a relic cache, guarded by constructs
  const pois = [];
  let pid = poiIdStart;
  for (let tries = 0; pois.length < (2 + depth) * 6 && tries < 4000; tries++) {
    const rw = 9 + Math.floor(rnd() * 4), rh = 7 + Math.floor(rnd() * 3);
    const x0 = 4 + Math.floor(rnd() * (W - rw - 8)), y0 = 4 + Math.floor(rnd() * (H - rh - 8));
    if (dC(x0 + rw / 2, y0 + rh / 2) < 18 || pois.some((p) => Math.abs(p.tx - x0 - rw / 2) < rw + 6 && Math.abs(p.ty - y0 - rh / 2) < rh + 6)) continue;
    const door = Math.floor(rnd() * 4);
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) {
      const ring = x === x0 || y === y0 || x === x0 + rw - 1 || y === y0 + rh - 1;
      const mx = x0 + Math.floor(rw / 2), my = y0 + Math.floor(rh / 2);
      const isDoor = (door === 0 && y === y0 + rh - 1 && Math.abs(x - mx) <= 1) || (door === 1 && y === y0 && Math.abs(x - mx) <= 1)
        || (door === 2 && x === x0 + rw - 1 && Math.abs(y - my) <= 1) || (door === 3 && x === x0 && Math.abs(y - my) <= 1);
      t[idx(x, y)] = ring && !isDoor ? U_RUIN_WALL : U_RUIN_FLOOR;
    }
    const tx = x0 + Math.floor(rw / 2), ty = y0 + Math.floor(rh / 2);
    pois.push({ id: pid++, layer: depth, kind: 'cache', tx, ty, x: tileCenter(tx), y: tileCenter(ty), looted: false, guards: 1 + Math.floor(depth / 2),
      loot: { res: { data: 1, titanium: 10 * depth, crystal: depth >= 3 ? 15 * depth : 0, xenium: depth >= 4 ? 25 : 0 }, module: MODULE_IDS[Math.floor(rnd() * MODULE_IDS.length)] } });
  }

  // entry chamber in the middle (elevator arrival)
  for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 6; x <= cx + 6; x++) if (Math.hypot((x - cx) / 6, (y - cy) / 5) <= 1) t[idx(x, y)] = U_FLOOR;
  // bedrock border
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) t[idx(x, y)] = U_BEDROCK;

  // cave natives: sentinels in open cave cells far from the entry
  const natives = [];
  for (let tries = 0; natives.length < (8 + depth * 5) * 5 && tries < 24000; tries++) {
    const x = 3 + Math.floor(rnd() * (W - 6)), y = 3 + Math.floor(rnd() * (H - 6));
    if (t[idx(x, y)] !== U_FLOOR || dC(x, y) < 16) continue;
    natives.push({ type: 'sentinel', x: tileCenter(x), y: tileCenter(y) });
  }
  for (const p of pois) {
    for (let g = 0; g < p.guards; g++) natives.push({ type: 'construct', x: p.x + (g - 0.5) * 40, y: p.y + 30 });
  }

  const layer = makeLayer(depth, W, H, t);
  return { layer, pois, natives, entry: { tx: cx, ty: cy } };
}

export function generateWorld(seed) {
  const surface = generateSurface(seed);
  const layers = [surface.layer];
  const pois = [...surface.pois];
  const natives = [[]];
  // surface monoliths are guarded by dormant constructs
  for (const p of surface.pois) if (p.kind === 'monolith') for (let g = 0; g < p.guards; g++) natives[0].push({ type: 'construct', x: p.x + (g - 0.5) * 50, y: p.y + 40 });
  const entries = [null];
  let nextPoi = pois.length + 1;
  for (let d = 1; d <= DEPTHS; d++) {
    const g = generateDepth(seed, d, nextPoi);
    nextPoi += g.pois.length;
    layers.push(g.layer);
    pois.push(...g.pois);
    natives.push(g.natives);
    entries.push(g.entry);
  }
  return { layers, pois, natives, entries, hqTiles: surface.hqTiles, hq: surface.hq, spawns: surface.spawns, vents: surface.vents };
}

// ------------------------------------------------------------------ pathfinding
// Dijkstra flow field toward the goal tiles on one layer. Blocking structures are passable at a
// cost proportional to their HP so attackers route to - and chew through - the weakest wall.
export function computeFlowField(layer, goals, structCost) {
  const { w, h, solid, terrain } = layer;
  const N = w * h;
  const dist = new Float64Array(N).fill(Infinity);
  const heap = new MinHeap();
  const goalSet = new Set();
  for (const [x, y] of goals) { const i = y * w + x; goalSet.add(i); dist[i] = 0; heap.push(0, i); }
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  const passable = (i) => !solid[i] || terrain[i] === S_HQ;
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy, step] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!passable(ni) || goalSet.has(ni)) continue;
      if (dx && dy && (!passable(y * w + x + dx) || !passable((y + dy) * w + x))) continue;
      const nd = d + step * (1 + structCost[ni]);
      if (nd < dist[ni]) { dist[ni] = nd; heap.push(nd, ni); }
    }
  }
  return dist;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// Uniform-grid spatial hash for enemy neighbourhood queries.
export class SpatialHash {
  constructor(cell = 64) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  key(cx, cy) { return cx * 4096 + cy; }
  insert(e) {
    const k = this.key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell));
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = []));
    b.push(e);
  }
  query(x, y, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.map.get(this.key(cx, cy));
        if (b) for (const e of b) out.push(e);
      }
    }
    return out;
  }
}

export { S_DUST, S_RIDGE, S_HQ, S_CRATER, S_ICE, S_VENT, S_RUIN, S_DARK, U_FLOOR, U_ROCK, U_HARD, U_BEDROCK, U_RUIN_FLOOR, U_RUIN_WALL, U_ORE };
