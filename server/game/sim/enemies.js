// Rogue AI machines: wave attackers on the surface, flyers, bosses and dormant natives that
// guard caves and ruins underground.
import { TILE, ENEMIES, PLAYER_RADIUS, CRIT_MULT, STRUCTURES, STORM, S_ICE } from '../../../shared/defs.js';
import { moveCircle, overlapsBlocking, tileOf, tileCenter } from '../../../shared/geometry.js';
import { E_INDEX, rand, randInt, dist2 } from '../GameRoom.js';

export const enemyMethods = {
  spawnNatives() {
    this.world.natives.forEach((list, layer) => {
      for (const n of list) {
        const e = this.spawnEnemy(n.type, layer, { x: n.x, y: n.y });
        e.native = true;
        e.dormant = true;
        e.home = { x: n.x, y: n.y };
      }
    });
  },

  // A random open surface spawn tile centre.
  pickSpawnPoint() {
    const g = this.L(0);
    for (let tries = 0; tries < 20; tries++) {
      const [tx, ty] = this.world.spawns[randInt(0, this.world.spawns.length - 1)];
      const i = ty * g.w + tx;
      if (g.solid[i] || g.structGrid[i]) continue;
      return { x: tileCenter(tx), y: tileCenter(ty) };
    }
    return { x: TILE * 2, y: TILE * 2 };
  },

  spawnEnemy(type, layer, at = null, bossMult = 1) {
    const def = ENEMIES[type];
    const p = at || this.pickSpawnPoint();
    const x = p.x + rand(-8, 8), y = p.y + rand(-8, 8);
    const depthMult = layer > 0 ? 1 + 0.35 * (layer - 1) : 1;
    const hp = def.hp * (def.native ? depthMult : this.hpMult) * bossMult;
    const e = {
      id: this.eid(), type, def, layer, x, y, r: def.radius, hp, maxHp: hp,
      damage: def.damage * (def.native ? depthMult : this.dmgMult),
      speed: def.speed * rand(0.9, 1.1) * (def.boss || def.native ? 1 : 1 + Math.min(0.3, this.wave * 0.01)),
      attackCd: 0, rangedCd: rand(0.5, 2), angle: Math.random() * 6.28, kx: 0, ky: 0,
      burnUntil: 0, burnDps: 0, burnOwner: null, slowUntil: 0, revealedUntil: 0,
      ab: { stomp: 5, spit: 3, summon: 8 }, dead: false, native: false, dormant: false, power: bossMult,
    };
    this.enemies.push(e);
    return e;
  },

  ignite(e, dps, owner) {
    e.burnUntil = this.time + 2;
    if (dps >= e.burnDps) { e.burnDps = dps; e.burnOwner = owner; }
  },

  isVisible(e) { return !e.def.stealth || e.revealedUntil > this.time; },

  reveal(layer, src, radius) {
    for (const e of this.L(layer).hash.query(src.x, src.y, radius)) {
      if (e.def.stealth && Math.hypot(e.x - src.x, e.y - src.y) < radius) e.revealedUntil = this.time + 0.6;
    }
  },

  // air: null = any, false = ground only, true = flyers only
  nearestEnemy(layer, from, range, { air = null, exclude = null, includeHidden = false, minRange = 0 } = {}) {
    let best = null, bd = range * range;
    const min2 = minRange * minRange;
    for (const e of this.L(layer).hash.query(from.x, from.y, range)) {
      if (e.dead || e.dormant || (exclude && exclude.has(e)) || (!includeHidden && !this.isVisible(e))) continue;
      if (air !== null && !!e.def.fly !== air) continue;
      const d = dist2(e, from);
      if (d < bd && d >= min2) { bd = d; best = e; }
    }
    return best;
  },

  // src: { player?, structure?, robot?, kind, canCrit?, crit? }
  damageEnemy(e, amount, src) {
    if (e.dead) return;
    let crit = false;
    if (src.canCrit && src.player && Math.random() < src.player.stats.crit) { amount *= CRIT_MULT; crit = true; }
    if (src.crit && Math.random() < src.crit) { amount *= CRIT_MULT; crit = true; }
    const armor = (e.def.armor || 0) * (src.kind === 'laser' || src.kind === 'fire' ? 0.5 : 1);
    const dmg = amount * (1 - armor);
    e.hp -= dmg;
    e.revealedUntil = Math.max(e.revealedUntil, this.time + 1);
    if (e.dormant) e.dormant = false;
    if (src.player) {
      src.player.match.damage += dmg;
      if (src.kind !== 'fire') this.layerFx(e.layer, { t: 'dmg', id: e.id, x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: crit ? 1 : 0 });
    } else if (crit) this.layerFx(e.layer, { t: 'dmg', id: e.id, x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: 1 });
    else if (Math.random() < 0.15) this.layerFx(e.layer, { t: 'hit', id: e.id });
    if (e.hp <= 0) this.killEnemy(e, src);
  },

  killEnemy(e, src) {
    e.dead = true;
    const def = e.def;
    const killer = src.player && this.players.has(src.player.sid) ? src.player : null;
    if (killer) {
      killer.pending.xp += def.xp; killer.pending.points += def.points; killer.pending.kills++; killer.match.kills++;
    }
    if (src.structure && this.structures.has(src.structure.id)) {
      src.structure.kills = (src.structure.kills || 0) + 1;
      const owner = this.playerByUser(src.structure.ownerId);
      if (owner) { owner.pending.xp += Math.ceil(def.xp / 2); owner.pending.points += Math.ceil(def.points / 2); }
    }
    // salvage: metal wreckage the colonists (or salvage bots) collect
    const drops = def.boss ? 8 : def.native ? 2 : Math.random() < 0.5 ? 1 : 0;
    for (let i = 0; i < drops; i++) {
      const bundle = {};
      for (const [k, v] of Object.entries(def.salvage)) bundle[k] = Math.max(1, Math.round(v / Math.max(1, drops / (def.boss ? 1 : 2))));
      this.pickups.push({ id: this.eid(), layer: e.layer, kind: 'salvage', x: e.x + (drops > 1 ? rand(-50, 50) : 0), y: e.y + (drops > 1 ? rand(-50, 50) : 0), bundle, expires: this.time + 60 });
    }
    this.layerFx(e.layer, { t: 'kill', x: Math.round(e.x), y: Math.round(e.y), z: E_INDEX[e.type], a: Math.round(e.angle * 100) / 100 });
    if (def.boss) {
      this.toast(`${def.name} destroyed!${killer ? ` Final blow: ${killer.name}` : ''}`, 'wave');
      for (const p of this.players.values()) { p.pending.xp += def.xp / 2; p.pending.points += def.points / 2; }
    }
  },

  playerByUser(userId) {
    if (!userId) return null;
    for (const p of this.players.values()) if (p.userId === userId) return p;
    return null;
  },

  // air: true = only flyers, false = only ground, undefined = all
  explode(layer, x, y, radius, damage, src, air) {
    for (const e of this.L(layer).hash.query(x, y, radius + 40)) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (e.dead || d > radius + e.r) continue;
      if (air !== undefined && !!e.def.fly !== air) continue;
      this.damageEnemy(e, damage * (1 - Math.min(1, d / (radius + e.r)) * 0.5), { ...src, kind: 'explosion', canCrit: !!src.player });
    }
    this.layerFx(layer, { t: 'boom', x: Math.round(x), y: Math.round(y), r: radius, a: air === true ? 1 : 0 });
  },

  spawnAcid(e, target, damage, speed, spread) {
    const a = Math.atan2(target.y - e.y, target.x - e.x) + spread;
    this.projectiles.push({
      id: this.eid(), kind: 'plasma', layer: e.layer, owner: 'e', x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life: 1.6, damage, pierce: 1, splash: 0,
    });
  },

  updateEnemies(dt) {
    for (const g of this.layers) g.hash.clear();
    for (const e of this.enemies) this.L(e.layer).hash.insert(e);
    const playersBy = this.layers.map(() => []);
    for (const p of this.players.values()) if (!p.dead) playersBy[p.layer].push(p);
    const neighbours = [];

    for (const e of this.enemies) {
      if (e.dead) continue;
      const players = playersBy[e.layer];
      if (e.dormant) { // natives sleep until someone comes close
        if (players.some((p) => dist2(p, e) < e.def.aggro ** 2 && this.lineOfSight(e.layer, e.x, e.y, p.x, p.y))) { e.dormant = false; e.wokeAt = this.time; this.layerFx(e.layer, { t: 'wake', id: e.id, x: Math.round(e.x), y: Math.round(e.y) }); }
        else continue;
      }
      if (e.burnUntil > this.time) {
        this.damageEnemy(e, e.burnDps * dt, { player: e.burnOwner && this.players.has(e.burnOwner.sid) ? e.burnOwner : null, kind: 'fire' });
        if (e.dead) continue;
      } else e.burnDps = 0;
      e.attackCd -= dt;
      e.rangedCd -= dt;

      // only chase / shoot colonists they can actually see: rock and unmined ore block the view
      let target = null, td = (e.def.aggro * (e.native ? 1 : 1)) ** 2;
      if (this.time >= (e.losT || 0)) {
        e.losT = this.time + 0.25 + Math.random() * 0.15;
        e.seen = null;
        for (const p of players) { const d = dist2(p, e); if (d < td && this.lineOfSight(e.layer, e.x, e.y, p.x, p.y)) { td = d; e.seen = p; } }
      }
      if (e.seen && !e.seen.dead && e.seen.layer === e.layer) { target = e.seen; td = dist2(target, e); }
      const tDist = target ? Math.sqrt(td) : Infinity;
      if (e.def.boss) this.bossAbilities(e, target, tDist, dt);
      if (e.def.fly) { this.updateFlyer(e, target, tDist, dt); continue; }

      const rng = e.def.ranged;
      if (rng && target && tDist < rng.range && e.rangedCd <= 0 && !target.elevated) {
        e.rangedCd = rng.cooldown;
        this.spawnAcid(e, target, rng.damage * (e.native ? 1 : this.dmgMult), rng.speed, 0);
      } else if (rng && target && tDist < rng.range && e.rangedCd <= 0) {
        e.rangedCd = rng.cooldown;
        this.spawnAcid(e, target, rng.damage * (e.native ? 1 : this.dmgMult), rng.speed, 0);
      }

      let dx = 0, dy = 0;
      if (target && !(rng && tDist < rng.range * 0.7)) { dx = (target.x - e.x) / tDist; dy = (target.y - e.y) / tDist; }
      else if (!target) {
        if (e.native) { // leash back home and go dormant again
          const hd = Math.hypot(e.home.x - e.x, e.home.y - e.y);
          if (hd > 20) { dx = (e.home.x - e.x) / hd; dy = (e.home.y - e.y) / hd; } else if (this.time - (e.wokeAt || 0) > 6) e.dormant = true;
        } else [dx, dy] = this.flowDir(e);
      }
      for (const o of this.L(e.layer).hash.query(e.x, e.y, e.r * 2 + 8, neighbours)) {
        if (o === e || o.dead || o.def.fly) continue;
        const ox = e.x - o.x, oy = e.y - o.y;
        const d = Math.hypot(ox, oy) || 0.01, min = e.r + o.r;
        if (d < min) { const push = ((min - d) / min) * 1.2; dx += (ox / d) * push; dy += (oy / d) * push; }
      }
      const len = Math.hypot(dx, dy);
      const g = this.L(e.layer);
      const ti = tileOf(e.y) * g.w + tileOf(e.x);
      const slow = (e.slowUntil > this.time ? 1 - STRUCTURES.stasis_field.slow : 1) * (e.layer === 0 && g.terrain[ti] === S_ICE ? 0.85 : 1);
      const step = e.speed * slow * dt;
      let mvx = len > 0 ? (dx / Math.max(1, len)) * step : 0;
      let mvy = len > 0 ? (dy / Math.max(1, len)) * step : 0;
      mvx += e.kx * dt; mvy += e.ky * dt;
      e.kx *= 0.85; e.ky *= 0.85;
      if (len > 0.1) e.angle = Math.atan2(dy, dx);
      const hit = moveCircle(e, mvx, mvy, Math.min(e.r, 14), (i) => this.blocksEnemy(e.layer, i), g.w, g.h);
      if (this.domeRepel(e)) continue;
      if (e.def.boss && hit >= 0 && e.attackCd <= 0) { this.bossSmash(e, g); continue; }
      if (!e.native && this.time - (e.chkT ??= this.time) > 10) { // stuck guard
        if (Math.hypot(e.x - (e.chkX ?? e.x + 99), e.y - (e.chkY ?? 0)) < 10 && e.attackCd < -5 && !e.def.boss) {
          const [sx, sy] = this.world.spawns[randInt(0, this.world.spawns.length - 1)];
          e.x = tileCenter(sx); e.y = tileCenter(sy);
        }
        e.chkT = this.time; e.chkX = e.x; e.chkY = e.y;
      }

      if (e.attackCd > 0) continue;
      if (target && !target.elevated && tDist <= e.r + PLAYER_RADIUS + 6) {
        this.damagePlayer(target, e.damage);
        e.attackCd = e.def.attackRate;
      } else if (hit >= 0) {
        if (e.layer === 0 && g.terrain[hit] === 2) { this.damageHq(e.damage * (e.def.structMult || 1)); e.attackCd = e.def.attackRate; }
        else if (g.structGrid[hit]) { this.damageStructure(this.structures.get(g.structGrid[hit]), e.damage * (e.def.structMult || 1)); e.attackCd = e.def.attackRate; }
      } else {
        const r = this.robotNear(e);
        if (r) { this.damageRobot(r, e.damage); e.attackCd = e.def.attackRate; }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  },

  // Bosses don't get stuck on walls: they smash every blocking building their body overlaps, so they
  // can physically fit through. Heavier bosses (later cycles) hit harder; higher-level walls resist.
  bossSmash(e, g) {
    const r = e.r + 10, hitIds = new Set();
    for (let ty = tileOf(e.y - r); ty <= tileOf(e.y + r); ty++) for (let tx = tileOf(e.x - r); tx <= tileOf(e.x + r); tx++) {
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) continue;
      const id = g.structGrid[ty * g.w + tx];
      if (!id || hitIds.has(id)) continue;
      const st = this.structures.get(id);
      if (!st?.def.block) continue;
      hitIds.add(id);
      this.damageStructure(st, e.damage * e.def.structMult * 1.5 * (e.power || 1) / (1 + 0.45 * (st.level - 1)));
    }
    if (g.id === 0 && Math.hypot(e.x - this.hq.x, e.y - this.hq.y) < r + 60) this.damageHq(e.damage * e.def.structMult);
    e.attackCd = e.def.attackRate;
    this.layerFx(e.layer, { t: 'stomp', id: e.id, x: Math.round(e.x), y: Math.round(e.y) });
  },

  // Clear view between two points? Steps through the tile grid; solid rock/ore blocks it.
  lineOfSight(layer, x0, y0, x1, y1) {
    const g = this.L(layer);
    const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) / 12);
    for (let k = 1; k < n; k++) {
      const tx = tileOf(x0 + (dx * k) / n), ty = tileOf(y0 + (dy * k) / n);
      const i = ty * g.w + tx;
      if (g.solid[i] && !(layer === 0 && g.terrain[i] === 2)) return false;
    }
    return true;
  },

  // Flyers ignore walls and terrain: they dive at players (even on walls), else the nearest building, else the HQ.
  updateFlyer(e, target, tDist, dt) {
    let tx = this.hq.x, ty = this.hq.y, reach = 70, kind = 'hq', obj = null;
    if (target) { tx = target.x; ty = target.y; reach = e.r + PLAYER_RADIUS + 4; kind = 'p'; obj = target; }
    else {
      let bd = 560 ** 2;
      for (const s of this.structures.values()) {
        if (s.layer !== e.layer || !s.built || s.mount) continue;
        const d = dist2(s, e);
        if (d < bd) { bd = d; obj = s; }
      }
      if (obj) { tx = obj.x; ty = obj.y; reach = 22 + (obj.def.size || 1) * 8; kind = 's'; }
    }
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    e.angle = Math.atan2(dy, dx);
    if (d > reach - 4) {
      const step = e.speed * dt;
      const wob = Math.sin(this.time * 4 + e.id) * 0.5;
      e.x += ((dx / d) - (dy / d) * wob) * step + e.kx * dt;
      e.y += ((dy / d) + (dx / d) * wob) * step + e.ky * dt;
      e.kx *= 0.85; e.ky *= 0.85;
    }
    if (this.domeRepel(e)) return;
    if (e.attackCd > 0 || d > reach) return;
    e.attackCd = e.def.attackRate;
    if (kind === 'p') this.damagePlayer(obj, e.damage);
    else if (kind === 's') this.damageStructure(obj, e.damage * 1.5);
    else this.damageHq(e.damage);
  },

  flowDir(e) {
    const g = this.L(0);
    const tx = tileOf(e.x), ty = tileOf(e.y);
    if (!g.flow || tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) {
      const ddx = this.hq.x - e.x, ddy = this.hq.y - e.y, l = Math.hypot(ddx, ddy) || 1;
      return [ddx / l, ddy / l];
    }
    let best = g.flow[ty * g.w + tx], bx = tx, by = ty;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = tx + ox, ny = ty + oy;
      if ((!ox && !oy) || nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      const d = g.terrain[ni] === 2 ? -1 : g.flow[ni];
      if (d < best) { best = d; bx = nx; by = ny; }
    }
    let gx, gy;
    if (bx === tx && by === ty) { gx = this.hq.x; gy = this.hq.y; } else { gx = tileCenter(bx); gy = tileCenter(by); }
    const ddx = gx - e.x, ddy = gy - e.y, l = Math.hypot(ddx, ddy) || 1;
    return [ddx / l, ddy / l];
  },

  bossAbilities(e, target, tDist, dt) {
    for (const k in e.ab) e.ab[k] -= dt;
    const has = (a) => e.def.abilities.includes(a);
    if (has('stomp') && e.ab.stomp <= 0 && target && tDist < 170) {
      e.ab.stomp = 7;
      const g = this.L(e.layer);
      for (const p of this.players.values()) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (p.dead || p.layer !== e.layer || d > 190) continue;
        this.damagePlayer(p, e.damage * 0.8);
        moveCircle(p, ((p.x - e.x) / (d || 1)) * 70, ((p.y - e.y) / (d || 1)) * 70, PLAYER_RADIUS, (i) => this.blocksPlayer(e.layer, i), g.w, g.h);
      }
      for (const s of [...this.structures.values()]) if (s.layer === e.layer && Math.hypot(s.x - e.x, s.y - e.y) < 150) this.damageStructure(s, 140 * this.dmgMult);
      this.layerFx(e.layer, { t: 'stomp', x: Math.round(e.x), y: Math.round(e.y) });
    }
    if (has('spit') && e.ab.spit <= 0 && target && tDist < 440) {
      e.ab.spit = 3.5;
      for (let i = -3; i <= 3; i++) this.spawnAcid(e, target, 10 * this.dmgMult, 340, i * 0.12);
    }
    if (has('summon') && e.ab.summon <= 0) {
      e.ab.summon = 10;
      const n = 8 + Math.floor(this.wave / 5) * 2;
      const g = this.L(e.layer);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const pos = { x: e.x + Math.cos(a) * (e.r + 24), y: e.y + Math.sin(a) * (e.r + 24) };
        if (overlapsBlocking(pos.x, pos.y, 9, (j) => this.blocksEnemy(e.layer, j), g.w, g.h) < 0) this.spawnEnemy(Math.random() < 0.5 ? 'skitter' : 'crawler', e.layer, pos);
      }
      this.layerFx(e.layer, { t: 'summon', x: Math.round(e.x), y: Math.round(e.y) });
    }
  },

  // Solar storms wear down everything not protected by a shield dome, plus random heavy bursts.
  updateStorm(dt) {
    const built = [...this.structures.values()].filter((s) => s.built && s.layer === 0);
    for (const s of built) this.damageStructure(s, STORM.dps * dt, true);
    const hqDmg = this.absorbShield(0, this.hq.x, this.hq.y, STORM.hqDps * dt);
    if (hqDmg > 0) this.hq.hp -= hqDmg;
    this.gustTimer -= dt;
    if (this.gustTimer <= 0 && built.length) {
      this.gustTimer = STORM.gustEvery;
      for (let i = 0; i < STORM.gustTargets; i++) {
        const s = built[randInt(0, built.length - 1)];
        if (!this.structures.has(s.id)) continue;
        this.layerFx(0, { t: 'gust', x: s.x, y: s.y });
        this.damageStructure(s, STORM.gustDamage);
      }
    }
  },
};
