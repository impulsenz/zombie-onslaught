// Tile/circle collision helpers shared by the server simulation and client-side prediction.
// Every function takes the grid size because the surface and underground layers differ.
import { TILE } from './defs.js';

export const tileOf = (v) => Math.floor(v / TILE);
export const tileCenter = (t) => t * TILE + TILE / 2;

// Returns the index of a blocking tile overlapped by the circle, -2 if outside the grid, else -1.
export function overlapsBlocking(x, y, r, isBlocking, w, h) {
  const x0 = tileOf(x - r), x1 = tileOf(x + r), y0 = tileOf(y - r), y1 = tileOf(y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return -2;
      const i = ty * w + tx;
      if (!isBlocking(i)) continue;
      const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return i;
    }
  }
  return -1;
}

// Moves a circle one axis at a time, reverting an axis that would overlap a blocking tile.
// Returns the index of the first blocking tile hit (or -1).
export function moveCircle(ent, dx, dy, r, isBlocking, w, h) {
  let hit = -1;
  const tryAxis = (ax, ay) => {
    const nx = ent.x + ax, ny = ent.y + ay;
    const t = overlapsBlocking(nx, ny, r, isBlocking, w, h);
    if (t < 0) { ent.x = nx; ent.y = ny; } else if (hit < 0) hit = t;
  };
  if (dx) tryAxis(dx, 0);
  if (dy) tryAxis(0, dy);
  return hit;
}

// ---------------------------------------------------------------- player movement with walkable walls
// grid: { w, h, solid } where solid[i] = 1 for impassable terrain. structAt(i) -> structure on tile i.
// Players on the ground are blocked by walls; stairwells connect the ground to wall tops, and a
// player on top of a wall can only move along walls and stairs.
const walkableTop = (s) => !!(s && s.built && (s.def.wall || s.def.stairs));

export function playerMode(p, grid, structAt) {
  const s = structAt(tileOf(p.y) * grid.w + tileOf(p.x));
  if (s && s.built && s.def.stairs) return 'stairs';
  return p.elevated ? 'high' : 'ground';
}

export function playerBlocks(i, mode, grid, structAt) {
  if (grid.solid[i]) return true;
  const s = structAt(i);
  if (mode === 'high') return !walkableTop(s);
  if (!s) return false;
  if (s.built && s.def.stairs) return false;
  if (mode === 'stairs' && walkableTop(s)) return false;
  return !!s.def.block;
}

// Moves a player and updates p.elevated. Returns true if the player fell off a wall.
export function stepPlayer(p, dx, dy, grid, structAt, radius) {
  const mode = playerMode(p, grid, structAt);
  const r = mode === 'high' ? 1 : radius;
  const blocked = (i) => playerBlocks(i, mode, grid, structAt);
  if (mode !== 'high' && overlapsBlocking(p.x, p.y, r, blocked, grid.w, grid.h) >= 0) { p.x += dx; p.y += dy; } // unstick
  else moveCircle(p, dx, dy, r, blocked, grid.w, grid.h);
  p.x = Math.max(radius, Math.min(grid.w * TILE - radius, p.x));
  p.y = Math.max(radius, Math.min(grid.h * TILE - radius, p.y));
  return updateElevation(p, grid, structAt);
}

export function updateElevation(p, grid, structAt) {
  const s = structAt(tileOf(p.y) * grid.w + tileOf(p.x));
  const was = !!p.elevated;
  if (s && s.built && s.def.wall) p.elevated = true;
  else if (!(s && s.built && s.def.stairs)) p.elevated = false;
  return was && !p.elevated && !(s && s.def.stairs);
}
