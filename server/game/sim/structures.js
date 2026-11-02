// Buildings: placement, power-aware behaviour for every turret family and machine, upgrades,
// modules, mining drills / tunnel borers and the terraformer.
import {
  TILE, STRUCTURES, BUILD_RANGE, PLAYER_RADIUS, HQ_SIZE, DEPTHS, MAX_ACTIVE_ENEMIES, SLOTS, MODULES,
  footprint, structCenter, structSize, maxLevel, upgradeCost, structureMaxHp, turretStats, MOUNT_RANGE_BONUS,
  SALVAGE_DEMOLISH, SALVAGE_DESTROYED, canAfford, payCost, addRes, scaleCost, isElectric, supplyAt, capacityAt,
  isDiggable, isOreTile, S_VENT, U_FLOOR, U_BEDROCK, U_RUIN_WALL, ORE_IDS,
} from '../../../shared/defs.js';
import { overlapsBlocking, tileCenter } from '../../../shared/geometry.js';
import { computeFlowField, refreshSolid } from '../world.js';
import { HQ_NODE } from '../power.js';
import { rand, dist2, angleDiff, r1 } from '../GameRoom.js';

const HQ_DEF = { name: 'HQ', draw: 1.5, prio: 0, wireRange: 10, h: 60 };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const BUFFER_CAP = 150;

export const structureMethods = {
  hqNode() {
    if (!this._hqNode || this._hqNode.room !== this.hq) this._hqNode = { id: HQ_NODE, kind: 'hq', def: HQ_DEF, room: this.hq, layer: 0, built: true, level: 1 };
    this._hqNode.x = this.hq.x; this._hqNode.y = this.hq.y;
    return this._hqNode;
  },

  // Starting colony: HQ, two solar panels and a battery wired to it, plus the elevator to Depth 1.
  placeStartingBase() {
    const [hx, hy] = this.world.hqTiles[0];
    const g = this.L(0);
    const clear = (tx, ty, n) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = (ty + y) * g.w + tx + x; g.terrain[i] = 0; refreshSolid(g, i); } };
    const place = (kind, layer, tx, ty) => {
      const s = this.addStructure(kind, layer, tx, ty, null);
      Object.assign(s, { built: true, progress: 1, hp: s.maxHp });
      return s;
    };
    // 4 solar panels and 3 batteries packed inside the small Mk1 dome
    const spots = [['solar_panel', hx - 4, hy - 3], ['solar_panel', hx - 4, hy + 4], ['solar_panel', hx + 4, hy - 3], ['solar_panel', hx + 4, hy + 4],
      ['battery', hx - 3, hy], ['battery', hx - 3, hy + 1], ['battery', hx - 3, hy + 2]];
    for (const [k, x, y] of spots) clear(x, y, STRUCTURES[k].size || 1);
    clear(hx + HQ_SIZE + 2, hy, 2);
    const parts = spots.map(([k, x, y]) => place(k, 0, x, y));
    const lift = place('elevator', 0, hx + HQ_SIZE + 2, hy);
    this.linkSurfaceElevator(lift);
    for (const s of parts) if (s.kind === 'battery') s.charge = s.def.capacity * 0.6;
    this.power.wires = [];
    for (const s of [...parts, lift]) this.power.connect(s.id, HQ_NODE);
  },

  // ------------------------------------------------------------------ placement
  mountTarget(layer, kind, tx, ty) {
    const g = this.L(layer);
    if (!STRUCTURES[kind]?.mountable || tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return null;
    const w = this.structAt(layer, ty * g.w + tx);
    return w && w.def.wall && w.built && !w.mounted ? w : null;
  },

  canPlace(p, kind, tx, ty) {
    const def = STRUCTURES[kind];
    if (!def || p.dead || !Number.isInteger(tx) || !Number.isInteger(ty)) return 'Invalid';
    const layer = p.layer;
    if (def.layer === 'surface' && layer !== 0) return 'Can only be built on the surface';
    if (def.layer === 'underground' && layer === 0) return 'Can only be built underground';
    if (def.tech && !this.techs.has(def.tech)) return 'Research required first';
    const cost = this.buildCost(p, kind);
    if (!canAfford(this.res, cost)) return 'Not enough resources';
    const c = structCenter(kind, tx, ty);
    if (Math.hypot(c.x - p.x, c.y - p.y) > BUILD_RANGE) return 'Too far away';
    if (this.mountTarget(layer, kind, tx, ty)) return null;
    const g = this.L(layer);
    const tiles = footprint(kind, tx, ty);
    for (const [x, y] of tiles) {
      if (x <= 0 || y <= 0 || x >= g.w - 1 || y >= g.h - 1) return 'Out of bounds';
      const i = y * g.w + x;
      if (g.solid[i] || g.structGrid[i]) return 'Space occupied';
    }
    if (layer === 0 && !tiles.every(([x, y]) => this.inDome((x + 0.5) * TILE, (y + 0.5) * TILE))) return 'Outside the colony dome - you can only build inside the atmosphere';
    if (kind === 'geothermal' && layer === 0 && !tiles.some(([x, y]) => g.terrain[y * g.w + x] === S_VENT)) return 'Geothermal taps must sit on a vent (or below Depth 2)';
    if (kind === 'geothermal' && layer === 1) return 'Geothermal needs a vent on the surface or Depth 2+';
    if (kind === 'elevator') {
      if (layer === 0) return 'The surface already has its elevator';
    }
    if (def.block) {
      const half = structSize(kind) * TILE / 2;
      const overlaps = (e, r) => Math.abs(e.x - c.x) < half + r && Math.abs(e.y - c.y) < half + r;
      for (const q of this.players.values()) if (!q.dead && q.layer === layer && overlaps(q, PLAYER_RADIUS)) return 'Someone is standing there';
      for (const e of this.enemies) if (e.layer === layer && !e.def.fly && overlaps(e, 12)) return 'Enemy in the way';
    }
    return null;
  },

  buildCost(p, kind) { return scaleCost(STRUCTURES[kind].cost, p.stats.buildCost); },

  tryBuild(p, kind, tx, ty, rot) {
    const err = this.canPlace(p, kind, tx, ty);
    if (err) { this.deny(p, err); return; }
    const cost = this.buildCost(p, kind);
    payCost(this.res, cost);
    const s = this.addStructure(kind, p.layer, tx, ty, p, this.mountTarget(p.layer, kind, tx, ty), ((rot % 4) + 4) % 4);
    s.invested = cost;
    s.buildRate = p.stats.buildSpeed / s.def.buildTime;
    this.power.autoConnect(s);
    this.powerTimer = 0;
  },

  addStructure(kind, layer, tx, ty, owner, mountOn = null, rot = 0) {
    const def = STRUCTURES[kind];
    const maxHp = structureMaxHp(kind, 1);
    const c = structCenter(kind, tx, ty);
    const s = {
      id: this.eid(), kind, def, layer, tx, ty, x: c.x, y: c.y, level: 1, maxHp, hp: maxHp * 0.1, built: false, progress: 0,
      buildRate: 1 / def.buildTime, ownerId: owner?.userId || null, powered: !isElectric(def), flicker: false, starved: false,
      cd: Math.random() * 0.3, angle: 0, litUntil: 0, invested: { ...def.cost }, hitAt: 0, mount: mountOn?.id || 0, mounted: 0, rot,
      kills: 0, modules: def.tsize ? Array(SLOTS[def.tsize]).fill(null) : null, shieldHp: 0, buffer: {}, cursor: 1, charge: 0,
    };
    this.structures.set(s.id, s);
    const g = this.L(layer);
    if (mountOn) mountOn.mounted = s.id;
    else {
      for (const [x, y] of footprint(kind, tx, ty)) g.structGrid[y * g.w + x] = s.id;
      if (def.block) g.flowDirty = true;
    }
    return s;
  },

  // The surface elevator arrives in the entry chamber of Depth 1.
  linkSurfaceElevator(s) {
    const e = this.world.entries[1];
    const arrival = this.addStructure('elevator', 1, e.tx - 1, e.ty - 1, null);
    Object.assign(arrival, { built: true, progress: 1, hp: arrival.maxHp, up: s.id, link: s.id, main: true });
    s.down = arrival.id; s.link = arrival.id; s.main = true;
  },

  // An elevator built on depth L bores a shaft to L+1 and opens an arrival chamber there.
  digShaftBelow(s) {
    const below = this.L(s.layer + 1);
    for (let y = s.ty - 3; y <= s.ty + 5; y++) for (let x = s.tx - 4; x <= s.tx + 5; x++) {
      if (x < 2 || y < 2 || x >= below.w - 2 || y >= below.h - 2) continue;
      if (Math.hypot((x - s.tx - 0.5) / 5, (y - s.ty - 0.5) / 4.5) > 1) continue;
      const i = y * below.w + x;
      if (below.terrain[i] === U_RUIN_WALL) continue;
      below.terrain[i] = U_FLOOR; refreshSolid(below, i);
    }
    below.version++;
    const arrival = this.addStructure('elevator', s.layer + 1, s.tx, s.ty, null);
    Object.assign(arrival, { built: true, progress: 1, hp: arrival.maxHp, up: s.id, link: s.id, main: true });
    s.down = arrival.id; s.link = arrival.id;
  },

  structureNear(p, id) {
    const s = this.structures.get(id);
    if (!s || p.dead || s.layer !== p.layer || Math.hypot(s.x - p.x, s.y - p.y) > BUILD_RANGE) return null;
    return s;
  },

  tryUpgrade(p, id) {
    const s = this.structureNear(p, id);
    if (!s || !s.built) return;
    if (s.level >= maxLevel(s.kind)) { this.deny(p, 'Already at max level'); return; }
    const cost = scaleCost(upgradeCost(s.kind, s.level), p.stats.buildCost);
    if (!canAfford(this.res, cost)) { this.deny(p, 'Not enough resources to upgrade'); return; }
    payCost(this.res, cost);
    addRes(s.invested, cost);
    s.level++;
    const newMax = structureMaxHp(s.kind, s.level);
    s.hp += newMax - s.maxHp;
    s.maxHp = newMax;
    p.pending.xp += 15 * s.level;
    this.layerFx(s.layer, { t: 'upgrade', x: s.x, y: s.y, id: s.id, lv: s.level });
    p.socket.emit('inspect', this.structureDetail(s));
  },

  tryDemolish(p, id) {
    const s = this.structureNear(p, id);
    if (!s) return;
    if (s.kind === 'elevator') { this.deny(p, 'Elevators cannot be demolished'); return; }
    addRes(this.res, s.invested, s.built ? SALVAGE_DEMOLISH : 0.9);
    this.layerFx(s.layer, { t: 'destroyed', x: s.x, y: s.y, k: s.kind });
    this.removeStructure(s);
  },

  setModule(p, id, slot, module) {
    const s = this.structureNear(p, id);
    if (!s || !s.modules || !Number.isInteger(slot) || slot < 0 || slot >= s.modules.length) return;
    if (module !== null && !MODULES[module]) return;
    if (module !== null && (this.modules[module] || 0) <= 0) { this.deny(p, 'You have no module of that type - find them in ruins'); return; }
    const old = s.modules[slot];
    if (old) this.modules[old] = (this.modules[old] || 0) + 1;
    s.modules[slot] = module;
    if (module) this.modules[module]--;
    this.layerFx(s.layer, { t: 'module', x: s.x, y: s.y });
    p.socket.emit('inspect', this.structureDetail(s));
  },

  removeStructure(s) {
    this.structures.delete(s.id);
    const g = this.L(s.layer);
    if (s.mount) {
      const wall = this.structures.get(s.mount);
      if (wall) wall.mounted = 0;
    } else {
      for (const [x, y] of footprint(s.kind, s.tx, s.ty)) { const i = y * g.w + x; if (g.structGrid[i] === s.id) g.structGrid[i] = 0; }
      if (s.def.block) g.flowDirty = true;
    }
    if (s.mounted) {
      const t = this.structures.get(s.mounted);
      if (t) { this.layerFx(t.layer, { t: 'destroyed', x: t.x, y: t.y, k: t.kind }); this.structures.delete(t.id); this.power.disconnectAll(t.id); }
    }
    for (const linkKey of ['up', 'down']) {
      const other = s[linkKey] && this.structures.get(s[linkKey]);
      if (other) { other.up = other.up === s.id ? 0 : other.up; other.down = other.down === s.id ? 0 : other.down; other.link = 0; }
    }
    this.power.disconnectAll(s.id);
    this.powerTimer = 0;
  },

  damageStructure(s, amount, quiet = false) {
    if (!this.structures.has(s.id)) return;
    if (s.shieldHp > 0) { const a = Math.min(s.shieldHp, amount); s.shieldHp -= a; amount -= a; if (amount <= 0) return; }
    if (s.layer === 0 && !quiet) amount = this.absorbDome(s.x, s.y, amount);
    amount = this.absorbShield(s.layer, s.x, s.y, amount);
    if (amount <= 0) return;
    s.hp -= amount;
    if (!quiet) s.hitAt = this.time;
    if (s.hp <= 0) {
      if (s.kind === 'elevator') { s.hp = 1; s.powered = false; return; } // shafts are indestructible, but get knocked offline
      this.layerFx(s.layer, { t: 'destroyed', x: s.x, y: s.y, k: s.kind });
      if (s.def.supply || s.def.capacity) this.toast(`A ${s.def.name} was destroyed - check your power grid!`, 'bad');
      const salvage = {};
      for (const [k, v] of Object.entries(s.invested)) salvage[k] = Math.floor(v * SALVAGE_DESTROYED);
      this.pickups.push({ id: this.eid(), layer: s.layer, kind: 'salvage', x: s.x, y: s.y, bundle: salvage, expires: this.time + 60 });
      this.removeStructure(s);
    }
  },

  damageHq(amount) {
    amount = this.absorbDome(this.hq.x, this.hq.y, amount);
    amount = this.absorbShield(0, this.hq.x, this.hq.y, amount);
    if (amount > 0) { this.hq.hp -= amount; this.layerFx(0, { t: 'hqhit' }); }
  },

  // Powered shield projectors soak damage aimed at anything inside their dome.
  absorbShield(layer, x, y, amount) {
    for (const s of this.structures.values()) {
      if (s.kind !== 'shield_projector' || s.layer !== layer || !s.built || !s.powered || s.shield <= 0) continue;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 > this.shieldRadius(s) ** 2) continue;
      const a = Math.min(s.shield, amount);
      s.shield -= a; amount -= a;
      if (this.time - (s.lastFx || 0) > 0.12) { s.lastFx = this.time; this.layerFx(layer, { t: 'shieldhit', x: Math.round(x), y: Math.round(y), sx: s.x, sy: s.y }); }
      if (amount <= 0) return 0;
    }
    return amount;
  },

  shieldRadius(s) { return (s.size || 6) * TILE; },

  // Per-structure extra number for snapshots (angle, charge %, buffer, link bits...).
  structExtra(s) {
    const d = s.def;
    if (d.turret || s.kind === 'floodlight') return Math.round(s.angle * 100);
    if (d.capacity) return Math.round(((s.charge || 0) / (s.capacity || capacityAt(s.kind, s.level))) * 100);
    if (d.supply) return Math.round((s.output || 0) * 10);
    if (s.kind === 'shield_projector') return Math.round(((s.shield || 0) / (d.shieldMax * s.level)) * 100);
    if (s.kind === 'wall_energy') return Math.round(((s.shieldHp || 0) / (d.barrier * (1 + 0.5 * (s.level - 1)))) * 100);
    if (s.kind === 'elevator') return (s.down ? 1 : 0) | (s.up ? 2 : 0);
    if (s.kind === 'drill' || s.kind === 'borer') return Math.round(Object.values(s.buffer).reduce((a, b) => a + b, 0)) + (s.kind === 'borer' ? s.cursor * 1000 : 0);
    return 0;
  },

  structureDetail(s) {
    const d = s.def;
    const net = this.power.networkOf(s.id);
    const lvlMax = maxLevel(s.kind);
    return {
      id: s.id, kind: s.kind, level: s.level, maxLevel: lvlMax, hp: Math.round(s.hp), maxHp: s.maxHp, kills: s.kills, built: s.built,
      modules: s.modules, stats: d.turret ? turretStats(s.kind, s.level, (s.modules || []).filter(Boolean)) : null,
      next: d.turret && s.level < lvlMax ? turretStats(s.kind, s.level + 1, (s.modules || []).filter(Boolean)) : null,
      nextHp: s.level < lvlMax ? structureMaxHp(s.kind, s.level + 1) : null,
      upgradeCost: s.level < lvlMax ? upgradeCost(s.kind, s.level) : null,
      power: isElectric(d) ? { powered: s.powered, flicker: s.flicker, starved: s.starved, draw: d.draw ? d.draw * (1 + 0.15 * (s.level - 1)) : 0,
        output: Math.round((s.output || 0) * 10) / 10, charge: Math.round(s.charge || 0), capacity: Math.round(s.capacity || 0),
        network: this.power.summary(net), wires: this.power.degree(s.id) } : null,
      supplyNext: d.supply && s.level < lvlMax ? supplyAt(s.kind, s.level + 1) : null,
      capacityNext: d.capacity && s.level < lvlMax ? capacityAt(s.kind, s.level + 1) : null,
      buffer: s.buffer, mounted: !!s.mount,
      roles: d.capacity ? (s.roles || null) : undefined,
      size: s.kind === 'shield_projector' ? (s.size || 6) : undefined,
      dirt: d.solar ? Math.round((s.dirt || 0) * 100) : undefined,
      barrier: s.kind === 'wall_energy' ? Math.round(s.shieldHp || 0) : undefined,
    };
  },

  rebuildFlowField(layer) {
    const cost = new Float32Array(layer.w * layer.h);
    for (let i = 0; i < cost.length; i++) {
      const id = layer.structGrid[i];
      const s = id && this.structures.get(id);
      cost[i] = s && s.def.block ? 3 + s.hp / 60 : 0;
    }
    layer.flow = computeFlowField(layer, this.world.hqTiles, cost);
    layer.flowDirty = false;
  },

  // ------------------------------------------------------------------ behaviour
  updateHq(dt) {
    // HQ point-defence laser (needs power)
    this.hq.cd -= dt;
    if (!this.hq.powered || this.hq.cd > 0) return;
    const e = this.nearestEnemy(0, this.hq, 300);
    if (!e) return;
    this.hq.angle = Math.atan2(e.y - this.hq.y, e.x - this.hq.x);
    this.hq.cd = 0.35;
    this.damageEnemy(e, 12, { kind: 'laser' });
    this.layerFx(0, { t: 'beam', x: this.hq.x, y: this.hq.y, x2: r1(e.x), y2: r1(e.y), k: 'hq', z: 70 });
  },

  updateStructures(dt) {
    for (const s of this.structures.values()) {
      if (!s.built) {
        s.progress += s.buildRate * dt;
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.9 * s.buildRate * dt);
        if (s.progress >= 1) {
          s.built = true; s.progress = 1;
          const owner = this.playerByUser(s.ownerId);
          if (owner) { owner.pending.xp += 5; owner.match.built++; }
          if (s.def.block) this.L(s.layer).flowDirty = true;
          this.powerTimer = 0;
          this.layerFx(s.layer, { t: 'built', x: s.x, y: s.y, k: s.kind });
        }
        continue;
      }
      s.cd -= dt;
      const d = s.def;
      if (d.turret) {
        const st = turretStats(s.kind, s.level, s.modules.filter(Boolean));
        if (st.shieldMax && s.powered) s.shieldHp = Math.min(st.shieldMax, s.shieldHp + 25 * dt);
        if (!s.powered) continue;
        this.updateTurret(s, st, dt);
        continue;
      }
      if (isElectric(d) && d.draw && !s.powered) continue;
      const lvl = 1 + 0.35 * (s.level - 1);
      switch (s.kind) {
        case 'shock_plate':
          for (const e of this.L(s.layer).hash.query(s.x, s.y, TILE)) {
            if (e.dead || e.def.fly || Math.abs(e.x - s.x) > TILE / 2 + 4 || Math.abs(e.y - s.y) > TILE / 2 + 4) continue;
            this.damageEnemy(e, d.dps * lvl * dt, { structure: s, kind: 'trap' });
            this.damageStructure(s, 3 * dt, true);
            if (Math.random() < 0.05) this.layerFx(s.layer, { t: 'zap', x: s.x, y: s.y });
          }
          break;
        case 'stasis_field':
          for (const e of this.L(s.layer).hash.query(s.x, s.y, d.radius + 20)) {
            if (!e.def.fly && Math.hypot(e.x - s.x, e.y - s.y) < d.radius * (1 + 0.2 * (s.level - 1))) e.slowUntil = this.time + 0.2;
          }
          break;
        case 'floodlight': {
          this.reveal(s.layer, s, 260);
          const e = this.nearestEnemy(s.layer, s, d.light * 0.8, { includeHidden: true });
          if (e) s.angle = Math.atan2(e.y - s.y, e.x - s.x);
          break;
        }
        case 'repair_station': {
          const range2 = d.range ** 2;
          for (const o of this.structures.values()) {
            if (o !== s && o.layer === s.layer && o.built && o.hp < o.maxHp && dist2(o, s) < range2) o.hp = Math.min(o.maxHp, o.hp + d.heal * lvl * dt);
          }
          for (const p of this.players.values()) {
            if (!p.dead && p.layer === s.layer && p.hp < p.maxHp && dist2(p, s) < range2) p.hp = Math.min(p.maxHp, p.hp + d.playerHeal * lvl * dt);
          }
          break;
        }
        case 'shield_projector':
          s.shield = Math.min(d.shieldMax * s.level, (s.shield || 0) + d.shieldRegen * s.level * dt);
          break;
        case 'wall_energy': { // a powered field soaks hits and the wall knits itself back together
          const max = d.barrier * (1 + 0.5 * (s.level - 1));
          if (s.powered) { s.shieldHp = Math.min(max, (s.shieldHp || 0) + d.barrierRegen * s.level * dt); s.hp = Math.min(s.maxHp, s.hp + d.heal * s.level * dt); }
          else s.shieldHp = Math.max(0, (s.shieldHp || 0) - max * 0.5 * dt);
          break;
        }
        case 'drill': this.updateDrill(s, dt); break;
        case 'borer': this.updateBorer(s, dt); break;
        case 'terraformer':
          if (Object.entries(d.burns).every(([k, v]) => (this.res[k] || 0) >= v * dt)) {
            for (const [k, v] of Object.entries(d.burns)) this.res[k] -= v * dt;
            this.terraform = Math.min(100, this.terraform + d.rate * s.level * dt);
            if (Math.random() < dt * 2) this.layerFx(0, { t: 'terra', x: s.x, y: s.y });
          }
          break;
      }
    }
  },

  // Fires one turret; every shot spends energy from its power network.
  updateTurret(s, st, dt) {
    const range = st.range * (s.mount ? MOUNT_RANGE_BONUS : 1);
    const air = st.antiAir ? true : false;
    const target = this.nearestEnemy(s.layer, s, range, { air, minRange: st.minRange });
    if (!target) return;
    s.angle = Math.atan2(target.y - s.y, target.x - s.x);
    if (s.cd > 0) return;
    if (!this.power.drawEnergy(s, st.shot)) { s.cd = 0.25; return; }
    s.cd = st.cooldown;
    const src = { structure: s, kind: 'laser', crit: st.crit };
    const z = s.mount ? 34 : 0;
    switch (s.kind) {
      case 'laser_s': case 'laser_m':
        this.damageEnemy(target, st.damage, src);
        this.layerFx(s.layer, { t: 'beam', x: s.x, y: s.y, x2: r1(target.x), y2: r1(target.y), k: s.kind, lv: s.level, z });
        break;
      case 'laser_l': case 'rail_l': {
        // piercing beam along the line to the target, out to full range
        const ux = Math.cos(s.angle), uy = Math.sin(s.angle);
        const x2 = s.x + ux * range, y2 = s.y + uy * range;
        const hits = [];
        for (const e of this.L(s.layer).hash.query((s.x + x2) / 2, (s.y + y2) / 2, range / 2 + 40)) {
          if (e.dead || e.def.fly || e.dormant) continue;
          const t = (e.x - s.x) * ux + (e.y - s.y) * uy;
          if (t < 0 || t > range) continue;
          const px = s.x + ux * t, py = s.y + uy * t;
          if ((e.x - px) ** 2 + (e.y - py) ** 2 < (e.r + (s.kind === 'rail_l' ? 10 : 7)) ** 2) hits.push([t, e]);
        }
        hits.sort((a, b) => a[0] - b[0]);
        for (const [, e] of hits.slice(0, st.pierce)) this.damageEnemy(e, st.damage, src);
        this.layerFx(s.layer, { t: 'beam', x: s.x, y: s.y, x2: r1(x2), y2: r1(y2), k: s.kind, lv: s.level, z });
        break;
      }
      case 'tesla_s': case 'tesla_l': {
        const pts = [[s.x, s.y]], hit = new Set();
        let dmg = st.damage, z2 = target;
        for (let c = 0; c < st.chains && z2; c++) {
          hit.add(z2);
          pts.push([r1(z2.x), r1(z2.y)]);
          this.damageEnemy(z2, dmg, src);
          dmg *= 0.85;
          z2 = this.nearestEnemy(s.layer, z2, s.kind === 'tesla_l' ? 160 : 120, { air: false, exclude: hit });
        }
        this.layerFx(s.layer, { t: 'arc', pts, k: s.kind, lv: s.level });
        break;
      }
      case 'flak_s':
        this.explode(s.layer, target.x, target.y, st.splash, st.damage, src, true);
        this.layerFx(s.layer, { t: 'flak', x: s.x, y: s.y, x2: r1(target.x), y2: r1(target.y), m: s.mount ? 1 : 0, lv: s.level });
        break;
      case 'missile_l': {
        const targets = [target];
        for (const e of this.L(s.layer).hash.query(s.x, s.y, range)) if (targets.length < st.salvo && e !== target && !e.dead && e.def.fly) targets.push(e);
        targets.forEach((t, i) => {
          const a = s.angle + (i - (targets.length - 1) / 2) * 0.35;
          this.projectiles.push({ id: this.eid(), kind: 'missile', layer: s.layer, owner: 's', src: s, target: t, x: s.x, y: s.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, life: 2.5, damage: st.damage, splash: st.splash });
        });
        this.layerFx(s.layer, { t: 'launch', x: s.x, y: s.y, n: targets.length });
        break;
      }
      case 'mortar_m': {
        const flight = 0.6 + Math.hypot(target.x - s.x, target.y - s.y) / 700;
        // lead the target a little
        const lx = target.x + Math.cos(target.angle) * target.speed * flight * 0.6, ly = target.y + Math.sin(target.angle) * target.speed * flight * 0.6;
        this.projectiles.push({ id: this.eid(), kind: 'shell', layer: s.layer, owner: 's', src: s, x: s.x, y: s.y, sx: s.x, sy: s.y, tx: lx, ty: ly, t0: this.time, flight, fuseAt: this.time + flight, damage: st.damage, splash: st.splash, vx: 0, vy: 0 });
        this.layerFx(s.layer, { t: 'mortar', x: s.x, y: s.y });
        break;
      }
    }
  },

  // Mining drills chew through ore next to them and buffer it for hauler bots (or an adjacent elevator).
  updateDrill(s, dt) {
    const g = this.L(s.layer);
    if (Object.values(s.buffer).reduce((a, b) => a + b, 0) >= BUFFER_CAP) { this.deliverIfNearElevator(s); return; }
    if (s.cd > 0) return;
    s.cd = s.def.mineTime / (1 + 0.5 * (s.level - 1));
    for (let r = 1; r <= 2; r++) {
      for (let y = s.ty - r; y <= s.ty + r; y++) for (let x = s.tx - r; x <= s.tx + r; x++) {
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const i = y * g.w + x;
        if (isOreTile(g.terrain[i])) { this.finishDig(g, i, { structure: s }); this.layerFx(s.layer, { t: 'drill', x: s.x, y: s.y, i }); this.deliverIfNearElevator(s); return; }
      }
    }
    s.idle = true;
  },

  // Tunnel borers dig a straight tunnel up to `reach` tiles in their facing direction.
  updateBorer(s, dt) {
    if (Object.values(s.buffer).reduce((a, b) => a + b, 0) >= BUFFER_CAP) { this.deliverIfNearElevator(s); return; }
    const g = this.L(s.layer);
    const [dx, dy] = DIRS[s.rot || 0];
    while (s.cursor <= s.def.reach) {
      const x = s.tx + dx * s.cursor, y = s.ty + dy * s.cursor;
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) { s.cursor = s.def.reach + 1; break; }
      const t = g.terrain[y * g.w + x];
      if (t === U_BEDROCK || t === U_RUIN_WALL) { s.cursor = s.def.reach + 1; break; }
      if (!isDiggable(t)) { s.cursor++; continue; }
      // dig the 3-wide tunnel face
      const speed = (1 + 0.5 * (s.level - 1)) / (this.digTime(s.layer, t) * s.def.digTime * 2);
      if (this.digAt(g, y * g.w + x, dt * speed, { structure: s })) {
        for (const side of [-1, 1]) {
          const sx = x + dy * side, sy = y + dx * side;
          if (sx > 1 && sy > 1 && sx < g.w - 2 && sy < g.h - 2 && isDiggable(g.terrain[sy * g.w + sx])) this.finishDig(g, sy * g.w + sx, { structure: s });
        }
        s.cursor++;
      }
      break;
    }
    this.deliverIfNearElevator(s);
  },

  deliverIfNearElevator(s) {
    const total = Object.values(s.buffer).reduce((a, b) => a + b, 0);
    if (!total) return;
    for (const e of this.structures.values()) {
      if (e.kind === 'elevator' && e.layer === s.layer && e.powered && Math.hypot(e.x - s.x, e.y - s.y) < TILE * 5) {
        addRes(this.ore, s.buffer);
        s.buffer = {};
        this.layerFx(s.layer, { t: 'deposit', x: s.x, y: s.y, v: total });
        return;
      }
    }
  },
};

export { ORE_IDS };
