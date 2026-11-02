// Colony robots: salvage collectors, repairers and combat drones on the surface; haulers and
// diggers that run the underground logistics chain (drill -> elevator -> refinery).
import { TILE, ROBOTS, MAX_ROBOTS, isOreTile, addRes } from '../../../shared/defs.js';
import { tileOf, tileCenter } from '../../../shared/geometry.js';
import { rand, dist2 } from '../GameRoom.js';

// task codes sent to clients
export const TASK = { idle: 0, repair: 1, collect: 2, dig: 3, shoot: 4, haul: 5, deliver: 6 };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const robotMethods = {
  buyRobot(p, type) {
    const d = ROBOTS[type];
    if (!d) return 'Unknown robot';
    if (d.tech && !this.techs.has(d.tech)) return 'Research required first';
    if (this.robots.length >= MAX_ROBOTS) return `The colony can run at most ${MAX_ROBOTS} robots`;
    let spawn;
    if (d.layer === 'underground') {
      const lift = [...this.structures.values()].find((s) => s.kind === 'elevator' && s.layer === 1);
      if (!lift) return 'No elevator to send it down';
      spawn = { layer: 1, x: lift.x + rand(-20, 20), y: lift.y + 50 };
    } else {
      const fac = [...this.structures.values()].find((s) => s.kind === 'robot_factory' && s.built);
      spawn = { layer: 0, x: (fac || this.hq).x, y: (fac || this.hq).y + 50 };
    }
    this.robots.push({
      id: this.eid(), type, def: d, owner: p, ...spawn, hp: d.hp, maxHp: d.hp, angle: 0, cd: 0, orbit: Math.random() * 6.28,
      task: TASK.idle, cargo: {}, path: [], pathT: 0, goal: null,
    });
    this.toast(`${p.name} deployed a ${d.name}`, 'good');
    return true;
  },

  damageRobot(r, amount) {
    r.hp -= amount;
    if (r.hp <= 0 && !r.dead) {
      r.dead = true;
      this.layerFx(r.layer, { t: 'rdie', x: Math.round(r.x), y: Math.round(r.y) });
      this.toast(`A ${r.def.name} was destroyed`, 'bad');
    }
  },

  robotNear(e) {
    for (const r of this.robots) if (!r.dead && r.layer === e.layer && (r.x - e.x) ** 2 + (r.y - e.y) ** 2 < (e.r + 16) ** 2) return r;
    return null;
  },

  // BFS over walkable tiles (4-way) to the nearest tile satisfying isGoal. Returns waypoints.
  findPath(layer, x, y, isGoal, maxNodes = 5000) {
    const g = this.L(layer);
    const start = tileOf(y) * g.w + tileOf(x);
    const prev = new Int32Array(g.w * g.h).fill(-1);
    prev[start] = start;
    const queue = [start];
    let found = -1;
    for (let qi = 0; qi < queue.length && qi < maxNodes; qi++) {
      const i = queue[qi];
      if (isGoal(i)) { found = i; break; }
      const cx = i % g.w, cy = (i / g.w) | 0;
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const ni = ny * g.w + nx;
        if (prev[ni] !== -1 || g.solid[ni] || (g.structGrid[ni] && this.structures.get(g.structGrid[ni]).def.block && !isGoal(ni))) continue;
        prev[ni] = i;
        queue.push(ni);
      }
    }
    if (found < 0) return null;
    const path = [];
    for (let i = found; i !== start; i = prev[i]) path.push(i);
    path.reverse();
    return { goal: found, points: path.map((i) => ({ x: tileCenter(i % g.w), y: tileCenter((i / g.w) | 0) })) };
  },

  // Tiles touching a structure's footprint (where a robot stands to use it).
  besideStructure(s) {
    const n = s.def.size || 1;
    return (i, g) => {
      const x = i % g.w, y = (i / g.w) | 0;
      return x >= s.tx - 1 && x <= s.tx + n && y >= s.ty - 1 && y <= s.ty + n && !(x >= s.tx && x < s.tx + n && y >= s.ty && y < s.ty + n);
    };
  },

  walkPath(r, dt) {
    const wp = r.path[0];
    if (!wp) return true;
    const dx = wp.x - r.x, dy = wp.y - r.y, d = Math.hypot(dx, dy);
    const step = r.def.speed * dt;
    if (d <= step) { r.x = wp.x; r.y = wp.y; r.path.shift(); return r.path.length === 0; }
    r.x += (dx / d) * step; r.y += (dy / d) * step;
    r.angle = Math.atan2(dy, dx);
    return false;
  },

  flyTo(r, tx, ty, dt) {
    const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
    if (d < 3) return true;
    const step = Math.min(d, r.def.speed * dt);
    r.x += (dx / d) * step; r.y += (dy / d) * step;
    r.angle = Math.atan2(dy, dx);
    return d < 12;
  },

  cargoTotal(r) { return Object.values(r.cargo).reduce((a, b) => a + b, 0); },

  updateRobots(dt) {
    for (const r of this.robots) {
      r.cd -= dt;
      r.pathT -= dt;
      switch (r.type) {
        case 'salvage_bot': this.botSalvage(r, dt); break;
        case 'repair_bot': this.botRepair(r, dt); break;
        case 'combat_drone': this.botDrone(r, dt); break;
        case 'hauler_bot': this.botHauler(r, dt); break;
        case 'digger_bot': this.botDigger(r, dt); break;
      }
    }
    this.robots = this.robots.filter((r) => !r.dead);
  },

  botSalvage(r, dt) {
    let best = null, bd = 1600 ** 2;
    for (const pk of this.pickups) {
      if (pk.dead || pk.layer !== r.layer || pk.kind !== 'salvage') continue;
      const d = dist2(pk, r);
      if (d < bd) { bd = d; best = pk; }
    }
    if (!best) { r.task = TASK.idle; r.orbit += dt * 0.5; this.flyTo(r, this.hq.x + Math.cos(r.orbit) * 120, this.hq.y + Math.sin(r.orbit) * 120, dt); return; }
    r.task = TASK.collect;
    if (this.flyTo(r, best.x, best.y, dt) || bd < 20 * 20) { addRes(this.res, best.bundle); best.dead = true; this.layerFx(r.layer, { t: 'collect', x: Math.round(best.x), y: Math.round(best.y) }); }
  },

  botRepair(r, dt) {
    let best = null, bd = 900 ** 2;
    for (const s of this.structures.values()) {
      if (s.layer !== r.layer || !s.built || s.hp >= s.maxHp) continue;
      const d = dist2(s, r);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best && this.hq.hp < this.hq.max && r.layer === 0) best = this.hq;
    if (!best) { // nothing broken: go and wipe the dirtiest solar panel
      let dirt = 0.25;
      for (const s of this.structures.values()) if (s.def.solar && s.layer === r.layer && (s.dirt || 0) > dirt) { dirt = s.dirt; best = s; }
      if (best) {
        if (this.flyTo(r, best.x, best.y - 20, dt) || Math.hypot(best.x - r.x, best.y - 20 - r.y) < 30) {
          best.dirt = Math.max(0, best.dirt - 0.35 * dt);
          r.task = TASK.repair;
          if (Math.random() < dt * 3) this.layerFx(r.layer, { t: 'clean', x: best.x, y: best.y });
        }
        return;
      }
    }
    if (!best) { r.task = TASK.idle; r.orbit += dt * 0.6; this.flyTo(r, this.hq.x + Math.cos(r.orbit) * 90, this.hq.y + Math.sin(r.orbit) * 90, dt); return; }
    if (this.flyTo(r, best.x, best.y - 20, dt) || Math.hypot(best.x - r.x, best.y - 20 - r.y) < 30) {
      const max = best === this.hq ? this.hq.max : best.maxHp;
      best.hp = Math.min(max, best.hp + r.def.repair * dt);
      r.task = TASK.repair;
    } else r.task = TASK.idle;
  },

  botDrone(r, dt) {
    const owner = r.owner && this.players.has(r.owner.sid) && !r.owner.dead && r.owner.layer === r.layer ? r.owner : null;
    r.orbit += dt * 0.9;
    const cx = owner ? owner.x : this.hq.x, cy = owner ? owner.y : this.hq.y;
    const e = this.nearestEnemy(r.layer, r, r.def.range);
    if (e) {
      r.angle = Math.atan2(e.y - r.y, e.x - r.x);
      if (r.cd <= 0) {
        r.cd = r.def.cooldown;
        this.damageEnemy(e, r.def.damage * (owner ? owner.stats.damage : 1), { player: owner, kind: 'laser' });
        this.layerFx(r.layer, { t: 'beam', x: Math.round(r.x), y: Math.round(r.y), x2: Math.round(e.x), y2: Math.round(e.y), k: 'drone', z: 26 });
        r.task = TASK.shoot;
      }
    } else r.task = TASK.idle;
    const tx = cx + Math.cos(r.orbit) * 50, ty = cy + Math.sin(r.orbit) * 50;
    const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
    if (d > 3) { const step = Math.min(d, r.def.speed * dt); r.x += (dx / d) * step; r.y += (dy / d) * step; if (!e) r.angle = Math.atan2(dy, dx); }
  },

  elevatorOn(layer) {
    return [...this.structures.values()].find((s) => s.kind === 'elevator' && s.layer === layer && s.built);
  },

  // Hauler: drill/borer buffers -> elevator on the same level (which lifts the ore to the surface).
  botHauler(r, dt) {
    const lift = this.elevatorOn(r.layer);
    if (this.cargoTotal(r) > 0) { // deliver
      r.task = TASK.deliver;
      if (!lift) return;
      if (!r.path.length && r.pathT <= 0) { const res = this.findPath(r.layer, r.x, r.y, (i) => this.besideStructure(lift)(i, this.L(r.layer))); r.path = res ? res.points : []; r.pathT = 2; }
      if (Math.hypot(lift.x - r.x, lift.y - r.y) < TILE * 2 || (this.walkPath(r, dt) && Math.hypot(lift.x - r.x, lift.y - r.y) < TILE * 2.5)) {
        if (lift.powered) { addRes(this.ore, r.cargo); this.layerFx(r.layer, { t: 'deposit', x: r.x, y: r.y, v: this.cargoTotal(r) }); r.cargo = {}; r.path = []; }
      }
      return;
    }
    // find the fullest buffer on this level
    let best = null, bv = 0;
    for (const s of this.structures.values()) {
      if (s.layer !== r.layer || (s.kind !== 'drill' && s.kind !== 'borer')) continue;
      const v = Object.values(s.buffer).reduce((a, b) => a + b, 0);
      if (v > bv) { bv = v; best = s; }
    }
    if (!best) { r.task = TASK.idle; return; }
    r.task = TASK.haul;
    if (r.goal !== best.id || (!r.path.length && r.pathT <= 0)) {
      const res = this.findPath(r.layer, r.x, r.y, (i) => this.besideStructure(best)(i, this.L(r.layer)));
      r.path = res ? res.points : []; r.goal = best.id; r.pathT = 2;
    }
    if (Math.hypot(best.x - r.x, best.y - r.y) < TILE * 1.6 * (best.def.size || 1) || this.walkPath(r, dt)) {
      if (Math.hypot(best.x - r.x, best.y - r.y) < TILE * 2) {
        let room = r.def.carry;
        for (const k of Object.keys(best.buffer)) {
          const take = Math.min(room, best.buffer[k]);
          r.cargo[k] = (r.cargo[k] || 0) + take; best.buffer[k] -= take; room -= take;
          if (best.buffer[k] <= 0) delete best.buffer[k];
        }
        r.path = []; r.goal = null;
      }
    }
  },

  // Digger: finds exposed ore, digs it, and hauls it to the elevator when full.
  botDigger(r, dt) {
    const g = this.L(r.layer);
    if (this.cargoTotal(r) >= r.def.carry) { r.cargo.__full = 0; delete r.cargo.__full; return this.botHauler(r, dt); }
    const touchesOre = (i) => {
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && isOreTile(g.terrain[ny * g.w + nx])) return true; }
      return false;
    };
    if (!r.path.length && r.pathT <= 0 && !r.digI) {
      const res = this.findPath(r.layer, r.x, r.y, (i) => !g.solid[i] && touchesOre(i), 7000);
      r.pathT = 3;
      if (!res) { r.task = this.cargoTotal(r) ? TASK.deliver : TASK.idle; if (this.cargoTotal(r)) this.botHauler(r, dt); return; }
      r.path = res.points;
    }
    if (r.path.length) { r.task = TASK.haul; this.walkPath(r, dt); return; }
    // at a tile touching ore: dig it
    const x = tileOf(r.x), y = tileOf(r.y);
    let target = r.digI;
    if (!target || !isOreTile(g.terrain[target])) {
      target = null;
      for (const [dx, dy] of N4) { const i = (y + dy) * g.w + x + dx; if (isOreTile(g.terrain[i])) { target = i; break; } }
    }
    if (!target) { r.digI = null; return; }
    r.digI = target;
    r.task = TASK.dig;
    r.angle = Math.atan2(tileCenter((target / g.w) | 0) - r.y, tileCenter(target % g.w) - r.x);
    if (this.digAt(g, target, dt * 0.7 / this.digTime(r.layer, g.terrain[target]), { robot: r })) r.digI = null;
  },
};
