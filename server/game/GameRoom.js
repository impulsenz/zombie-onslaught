// Authoritative simulation for one co-op colony. Clients send inputs/actions; the room
// simulates every layer (surface + underground depths) at TICK_RATE and sends each player a
// snapshot of the layer they are on.
//
// Behaviour is split into mixins: sim/enemies.js, sim/structures.js, sim/robots.js.
import {
  TILE, TICK_RATE, SNAPSHOT_EVERY, MAX_PLAYERS, LIVES_PER_WAVE, RESPAWN_DELAY, FIRST_BUILD_PHASE, DUSK, DAWN, NIGHT_LENGTH, isNightAt, dayPhase, secondsUntil, canDig, SURFACE_ROCK_YIELD, ROCK_YIELD, SHAFT_COST, MINING_TOOL, STORAGE_BASE, UNCAPPED, storageOf, LAYER_NAMES, DOME, DOME_START_RADIUS, DOME_MIN, DOME_MAX, DOME_RESIZE, domeDrawAt, POWER_ROLES, DEFAULT_WARN, DIRT_RATE, EMITTER_MIN, EMITTER_MAX, researchEnergy, DOME_START_SHIELD, SUIT, SUIT_IDS, suitInfo, RIDE_TIME, DOME_GRACE, DOME_DECOMPRESS, DOME_REBOOT, SWARM_CHANCE, SWARM_MULT, SWARM_PACK,
  PLAYER_RADIUS, SPRINT_MULT, DEPTHS, MAX_ACTIVE_ENEMIES,
  difficultyScale, isBossWave, waveSpawnDuration, waveEnemyCount, waveHpMult, waveDmgMult, waveComposition,
  WEAPONS, WEAPON_ORDER, CONSUMABLES, ENEMIES, BOSS_ROTATION, ENEMY_TYPE_IDS, STRUCTURE_ORDER, ROBOT_TYPE_IDS,
  PERKS, SHRINE_CAPTURE_TIME, SHRINE_LIFETIME, SHRINE_INTERVAL, derivedStats, XP_PER_WAVE, POINTS_PER_WAVE,
  START_RESOURCES, RES_IDS, ORE_IDS, MODULE_IDS, TECH, O2, BACKPACK_CAPACITY, DIG_REACH, ROCK_DIG_TIME, HARD_ROCK_MULT,
  ORE_YIELD, U_FLOOR, U_HARD, isDiggable, isOreTile, oreOfTile, digSpeedMult, canAfford, payCost, addRes,
  PLAYER_SHIELD, SHOPS, SHOP_RANGE, shopItemInfo, MODULES, rollWeather, sunAt, FALL_DAMAGE, HIGH_GROUND_DAMAGE,
  MED_BAY_HEAL, DAY_LENGTH,
} from '../../shared/defs.js';
import { stepPlayer, updateElevation, overlapsBlocking, playerBlocks, tileOf, tileCenter } from '../../shared/geometry.js';
import { generateWorld, refreshSolid } from './world.js';
import { PowerGrid, POWER_TICK } from './power.js';
import { enemyMethods } from './sim/enemies.js';
import { structureMethods } from './sim/structures.js';
import { robotMethods } from './sim/robots.js';
import { db } from '../db/index.js';
import { awardProgress } from '../progression.js';

const DT = 1 / TICK_RATE;
export const E_INDEX = Object.fromEntries(ENEMY_TYPE_IDS.map((k, i) => [k, i]));
export const S_INDEX = Object.fromEntries(STRUCTURE_ORDER.map((k, i) => [k, i]));
export const PROJ_KINDS = ['bolt', 'beam', 'rocket', 'plasma', 'grenade', 'molotov', 'missile', 'shell'];
const PERK_IDS = Object.keys(PERKS);
const POI_KINDS = ['monolith', 'probe', 'cache'];
const VIEW_X = 1500, VIEW_Y = 1250; // enemy culling box around each player

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const r1 = (v) => Math.round(v * 10) / 10;

export class GameRoom {
  constructor(io, id, name) {
    this.io = io;
    this.id = id;
    this.name = name;
    this.channel = `room:${id}`;
    this.players = new Map();
    this.nextEntityId = 1;
    this.createdAt = Date.now();
    this.emptySince = Date.now();
    this.time = 0;
    this.tickCount = 0;
    this.resetRun();
    this.timer = setInterval(() => this.safeTick(), 1000 / TICK_RATE);
  }

  eid() { return this.nextEntityId++; }
  L(layer) { return this.layers[layer]; }
  structAt(layer, i) { const id = this.layers[layer].structGrid[i]; return id ? this.structures.get(id) : undefined; }

  // ------------------------------------------------------------------ run lifecycle
  resetRun() {
    const world = generateWorld((Math.random() * 2 ** 31) | 0);
    this.world = world;
    this.layers = world.layers;
    for (const l of this.layers) { l.dig = new Map(); l.version = 0; l.sAt = (i) => this.structAt(l.id, i); }
    this.pois = world.pois;
    this.structures = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.robots = [];
    this.shrines = [];
    this.fireZones = [];
    this.fx = Array.from({ length: DEPTHS + 1 }, () => []);
    this.gfx = [];
    this.spawnQueue = [];
    this.wave = 0;
    this.phase = 'build';
    // Start in the afternoon so the first night (and wave 1) falls FIRST_BUILD_PHASE seconds in.
    this.runStart = this.time - (DUSK * DAY_LENGTH - FIRST_BUILD_PHASE);
    this.phaseEnd = this.time + FIRST_BUILD_PHASE;
    this.weather = 'clear';
    this.scale = 1;
    this.hpMult = 1;
    this.dmgMult = 1;
    this.res = Object.fromEntries(RES_IDS.map((k) => [k, START_RESOURCES[k] || 0]));
    this.ore = Object.fromEntries(ORE_IDS.map((k) => [k, 0]));
    this.refineAcc = 0;
    this.refineRate = 0;
    this.modules = Object.fromEntries(MODULE_IDS.map((k) => [k, 0]));
    this.techs = new Set();
    this.shaftDepth = 1;
    this.dome = { level: 1, radius: DOME_START_RADIUS * TILE, target: DOME_START_RADIUS, shield: DOME[1].shield * DOME_START_SHIELD, up: true, downAt: 0, darkFor: 0 };
    this.powerWarn = { ...DEFAULT_WARN };
    this.lowRoles = [];
    this.researching = null;
    this.cap = STORAGE_BASE;
    this.terraform = 0;
    this.hq = { hp: 3000, max: 3000, level: 1, cd: 0, angle: 0, x: world.hq.x, y: world.hq.y, powered: true };
    this.nextShrineAt = Infinity;
    this.powerTimer = 0;
    this.gustTimer = 0;
    this.sessionId = null;
    this.runStarted = false;
    this.sun = sunAt(this.time - this.runStart);
    this.power = new PowerGrid(this);
    this.placeStartingBase();
    this.spawnNatives();
    this.power.solve(POWER_TICK);

    for (const p of this.players.values()) this.resetPlayerForRun(p);
    for (const p of this.players.values()) p.socket.emit('init', this.initPayload(p));
    if (this.players.size) this.beginSession();
  }

  beginSession() {
    if (this.runStarted) return;
    this.runStarted = true;
    db.createSession({ roomId: this.id, roomName: this.name, waveReached: 0, players: this.playerSummary() })
      .then((s) => { this.sessionId = s.id; })
      .catch((err) => console.error('[room] session create failed', err));
  }

  endSession(outcome) {
    if (!this.sessionId) return;
    db.updateSession(this.sessionId, {
      endedAt: new Date().toISOString(), waveReached: this.wave, outcome, players: this.playerSummary(),
    }).catch((err) => console.error('[room] session update failed', err));
    this.sessionId = null;
  }

  playerSummary() {
    return [...this.players.values()].map((p) => ({
      userId: p.userId, name: p.name, kills: p.match.kills, damage: Math.round(p.match.damage), built: p.match.built, mined: p.match.mined,
    }));
  }

  initPayload(p) {
    return {
      you: p.id,
      room: { id: this.id, name: this.name },
      layers: this.layers.map((l) => ({ id: l.id, w: l.w, h: l.h, terrain: Array.from(l.terrain) })),
      hq: this.world.hq,
      hqTiles: this.world.hqTiles,
      admin: !!p.isAdmin,
    };
  }

  // ------------------------------------------------------------------ players
  addPlayer(socket, user) {
    if (this.players.size >= MAX_PLAYERS) return { error: 'Room is full' };
    const p = {
      sid: socket.id, socket, id: this.eid(), userId: user.id, name: user.name.slice(0, 20), level: user.level,
      stats: derivedStats(user.stats),
      baseUnlocked: WEAPON_ORDER.filter((w) => user.unlockedWeapons.includes(w)),
      input: { mx: 0, my: 0, a: 0, f: false, sp: false, i: false, d: false, tx: 0, ty: 0 },
      pending: { xp: 0, points: 0, kills: 0, waves: 0 },
      x: 0, y: 0, layer: 0, isAdmin: user.role === 'admin', ping: 0, god: false,
    };
    if (!p.baseUnlocked.length) p.baseUnlocked = ['bat', 'pistol'];
    this.resetPlayerForRun(p);
    this.players.set(socket.id, p);
    socket.join(this.channel);
    this.emptySince = null;
    this.beginSession();
    socket.emit('init', this.initPayload(p));
    this.toast(`${p.name} landed at the colony`);
    return { player: p };
  }

  removePlayer(sid) {
    const p = this.players.get(sid);
    if (!p) return;
    this.flushProgress(p, this.wave > 0 ? { gamesPlayed: 1, bestWave: this.wave } : {});
    this.players.delete(sid);
    p.socket.leave(this.channel);
    this.toast(`${p.name} left`);
    if (!this.players.size) {
      this.emptySince = Date.now();
      if (this.phase !== 'gameover' && this.wave > 0) this.endSession('abandoned');
    }
  }

  resetPlayerForRun(p) {
    p.unlocked = [...p.baseUnlocked];
    p.layer = 0;
    p.shieldLvl = 0; p.shield = 0; p.lastHurt = 0;
    p.elevated = false;
    p.maxHp = p.stats.maxHp; p.hp = p.maxHp;
    p.up = { tool: 0, o2: 0, pack: 0, armor: 0, boots: 0 };
    p.maxStamina = p.stats.stamina; p.stamina = p.maxStamina;
    p.lives = LIVES_PER_WAVE;
    p.dead = false; p.spectator = false; p.respawnAt = 0;
    p.spawnProtect = this.time + 2;
    p.ammo = {};
    for (const w of p.unlocked) if (WEAPONS[w].kind === 'ranged') p.ammo[w] = { mag: this.magSize(p, w), reserve: this.reserveSize(p, w) };
    p.current = Math.max(0, p.unlocked.indexOf('pistol'));
    p.nextFireAt = 0; p.reloadUntil = 0;
    p.consumables = Object.fromEntries(Object.entries(CONSUMABLES).map(([k, c]) => [k, c.start]));
    p.buffs = {};
    p.match = { kills: 0, damage: 0, built: 0, mined: 0 };
    p.ready = false;
    p.interacting = null;
    p.acc = { heal: 0, repair: 0 };
    p.o2 = this.o2Max(p);
    p.pack = {};
    p.digging = -1; p.beam = 0;
    p.up = { tool: 0, o2: 0, pack: 0, armor: 0, boots: 0 };
    p.ride = null;
    p.lastSwingFx = 0;
    this.placeAtHq(p);
  }

  o2Max(p) { return O2.max * (this.techs.has('suit_o2') ? 2 : 1) * (p ? SUIT.o2.levels[p.up.o2].mult : 1); }
  packCap(p) { return SUIT.pack.levels[p.up.pack].cap; }
  packTotal(p) { return Object.values(p.pack).reduce((a, b) => a + b, 0); }
  magSize(p, w) { return Math.max(1, Math.round(WEAPONS[w].mag * p.stats.ammo)); }
  reserveSize(p, w) { return Math.round(WEAPONS[w].reserve * p.stats.ammo); }

  placeAtHq(p) {
    p.layer = 0;
    const { hq } = this;
    const grid = this.L(0);
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2, d = rand(80, 140);
      const x = hq.x + Math.cos(a) * d, y = hq.y + Math.sin(a) * d;
      if (overlapsBlocking(x, y, PLAYER_RADIUS, (i) => this.blocksPlayer(0, i), grid.w, grid.h) < 0) { p.x = x; p.y = y; return; }
    }
    p.x = hq.x; p.y = hq.y + 90;
  }

  blocksPlayer(layer, i) { return playerBlocks(i, 'ground', this.L(layer), this.L(layer).sAt); }
  blocksEnemy(layer, i) {
    const l = this.L(layer);
    if (l.solid[i]) return true;
    const id = l.structGrid[i];
    return id !== 0 && this.structures.get(id).def.block;
  }

  setInput(p, d) {
    if (!d || typeof d !== 'object') return;
    const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
    let mx = num(d.mx, -1, 1), my = num(d.my, -1, 1);
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    p.input = { mx, my, a: num(d.a, -10, 10), f: !!d.f, sp: !!d.sp, i: !!d.i, d: !!d.d, tx: num(d.tx, 0, 1e5), ty: num(d.ty, 0, 1e5) };
  }

  // ------------------------------------------------------------------ main loop
  safeTick() {
    try { for (let k = 0; k < (this.speed || 1); k++) this.tick(); } catch (err) { console.error(`[room ${this.id}] tick error`, err); }
  }

  // ------------------------------------------------------------------ developer tools (admins)
  devAction(p, a) {
    if (!a || typeof a !== 'object') return;
    const say = (t) => this.toast(`[DEV] ${p.name}: ${t}`, 'info');
    switch (a.cmd) {
      case 'god': p.god = !p.god; if (p.god) { p.hp = p.maxHp; p.o2 = this.o2Max(p); } say(`god mode ${p.god ? 'ON' : 'OFF'}`); break;
      case 'res':
        this.storageBonus = 1e7; this.cap = STORAGE_BASE + 1e7;
        for (const k of RES_IDS) this.res[k] = 999999;
        say('unlimited resources'); break;
      case 'speed': this.speed = Math.max(1, Math.min(10, Math.round(Number(a.v) || 1))); say(`game speed x${this.speed}`); break;
      case 'wave': {
        const n = Math.max(1, Math.min(60, Math.round(Number(a.v) || 1)));
        for (const e of this.enemies) if (!e.native) e.dead = true;
        this.spawnQueue = []; this.wave = n - 1; this.phase = 'build'; this.quietNight = false;
        this.skipToNight(2); say(`jumping to wave ${n}`); break;
      }
      case 'night': this.skipToNight(1); say('skip to nightfall'); break;
      case 'day': {
        const left = secondsUntil(this.clock(), DAWN + 0.03);
        this.runStart -= left; this.sun = sunAt(this.clock()); say('skip to morning'); break;
      }
      case 'kill': { let n = 0; for (const e of this.enemies) if (!e.native && !e.dead) { e.dead = true; n++; } say(`removed ${n} machines`); break; }
      case 'dome': Object.assign(this.dome, { up: true, shield: DOME[this.dome.level].shield, radius: this.dome.target * TILE }); say('dome fully charged'); break;
      case 'tech': for (const t of Object.keys(TECH)) this.techs.add(t); say('all research unlocked'); break;
      case 'boss': {
        const type = BOSS_ROTATION[Math.floor(Math.random() * BOSS_ROTATION.length)];
        const b = this.spawnEnemy(type, 0); this.gfx.push({ t: 'boss', name: ENEMIES[type].name, id: b.id }); say(`spawned ${ENEMIES[type].name}`); break;
      }
      case 'shaft': while (this.shaftDepth < DEPTHS) { this.digShaftBelow(this.liftStop(this.shaftDepth)); this.shaftDepth++; } say('shaft bored to the bottom'); break;
      case 'build': for (const s of this.structures.values()) if (!s.built) { s.progress = 1; s.built = true; s.hp = s.maxHp; } this.L(0).flowDirty = true; this.powerTimer = 0; say('finished all construction'); break;
      case 'batt': for (const s of this.structures.values()) if (s.def.capacity) s.charge = s.capacity || s.def.capacity; this.power.hqCharge = 120; say('batteries filled'); break;
      case 'suit': for (const k of SUIT_IDS) p.up[k] = (k === 'tool' ? MINING_TOOL.length : SUIT[k].levels.length) - 1;
        p.maxHp = Math.round(p.stats.maxHp * SUIT.armor.levels[p.up.armor].hp); p.hp = p.maxHp; say('suit maxed'); break;
    }
  }

  tick() {
    this.time += DT;
    this.tickCount++;
    if (!this.players.size) return; // paused while empty

    if (this.phase === 'gameover' || this.phase === 'victory') {
      if (this.time >= this.phaseEnd) this.resetRun();
    } else {
      this.sun = sunAt(this.clock());
      const surface = this.L(0);
      if (surface.flowDirty) this.rebuildFlowField(surface);
      this.powerTimer -= DT;
      if (this.powerTimer <= 0) { this.power.solve(POWER_TICK); this.powerTimer = POWER_TICK; }
      this.updatePhase();
      this.updatePlayers(DT);
      this.updateStructures(DT);
      this.updateHq(DT);
      this.updateRobots(DT);
      this.updateEnemies(DT);
      this.updateProjectiles(DT);
      this.updateWorld(DT);
      this.updateEconomy(DT);
      this.updateDome(DT);
      this.updateResearch(DT);
      if (this.tickCount % 15 === 0) for (const s of this.structures.values()) if (s.def.solar && s.built) s.dirt = Math.min(1, (s.dirt || 0) + (DIRT_RATE[this.weather] || DIRT_RATE.clear) * 0.5);
      if (this.hq.hp <= 0) this.gameOver();
      else if (this.terraform >= 100) this.victory();
    }
    if (this.tickCount % SNAPSHOT_EVERY === 0) this.broadcast();
  }

  // ------------------------------------------------------------------ phases & waves
  clock() { return this.time - this.runStart; }

  // Fast-forward the day so night falls in `lead` seconds (everyone pressed ready).
  skipToNight(lead = 3) {
    const left = secondsUntil(this.clock(), DUSK);
    if (isNightAt(this.clock()) || left <= lead) return;
    this.runStart -= left - lead;
    this.sun = sunAt(this.clock());
  }

  updatePhase() {
    if (this.phase === 'build') {
      const ps = [...this.players.values()];
      if (ps.length && ps.every((p) => p.ready)) this.skipToNight();
      const night = isNightAt(this.clock());
      // after an early win the rest of that night is free; the next attack comes at the following dusk
      this.phaseEnd = this.time + (night ? secondsUntil(this.clock(), DAWN) : 0) + secondsUntil(this.clock(), DUSK);
      if (night && !this.quietNight) this.startWave();
      if (!night) this.quietNight = false;
    } else if (this.phase === 'wave') {
      if (!isNightAt(this.clock())) { this.retreat(); return; }
      let active = this.surfaceAttackers();
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.time && active < MAX_ACTIVE_ENEMIES) {
        const q = this.spawnQueue.shift();
        this.spawnEnemy(q.type, 0, q.pack ? { x: q.pack.x + rand(-40, 40), y: q.pack.y + rand(-40, 40) } : null);
        active++;
      }
      if (this.time >= this.nextShrineAt) {
        if (this.shrines.length < 2) this.spawnShrine();
        this.nextShrineAt = this.time + SHRINE_INTERVAL;
      }
      if (!this.spawnQueue.length && this.surfaceAttackers() === 0) this.endWave();
    }
  }

  // Dawn: whatever is left of the assault withdraws, and the wave counts as survived.
  retreat() {
    let n = 0;
    for (const e of this.enemies) {
      if (e.dead || e.native) continue;
      e.dead = true; n++;
      if (n % 3 === 0) this.layerFx(e.layer, { t: 'spark', x: Math.round(e.x), y: Math.round(e.y) });
    }
    this.spawnQueue = [];
    if (n) this.toast(`Dawn breaks - ${n} machines retreat from the light`, 'wave');
    this.endWave();
  }

  surfaceAttackers() { let n = 0; for (const e of this.enemies) if (!e.dead && !e.native) n++; return n; }

  startWave() {
    this.wave++;
    this.phase = 'wave';
    this.scale = difficultyScale(this.players.size);
    this.hpMult = waveHpMult(this.wave, this.scale);
    this.dmgMult = waveDmgMult(this.wave, this.scale);
    this.weather = rollWeather(this.wave);
    const duration = Math.min(waveSpawnDuration(this.wave), NIGHT_LENGTH - 30);
    this.swarm = this.wave > 1 && Math.random() < SWARM_CHANCE;
    const count = waveEnemyCount(this.wave, this.scale) * (this.swarm ? SWARM_MULT : 1);
    const comp = waveComposition(this.wave);
    const keys = Object.keys(comp), total = Object.values(comp).reduce((a, b) => a + b, 0);
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      let roll = Math.random() * total, type = keys[0];
      for (const k of keys) { roll -= comp[k]; if (roll <= 0) { type = k; break; } }
      this.spawnQueue.push({ at: this.time + 1 + Math.pow(i / count, 0.85) * duration + rand(0, 1.5), type });
    }
    this.spawnQueue.sort((a, b) => a.at - b.at);
    if (this.swarm) { // regroup the queue into a few huge packs, each pouring out of one spawn at once
      for (let i = 0; i < this.spawnQueue.length;) {
        const size = randInt(SWARM_PACK[0], SWARM_PACK[1]), pack = this.pickSpawnPoint(), at = this.spawnQueue[i].at;
        for (const q of this.spawnQueue.slice(i, i + size)) { q.pack = pack; q.at = at + rand(0, 2.5); }
        i += size;
      }
      this.spawnQueue.sort((a, b) => a.at - b.at);
    }
    if (isBossWave(this.wave)) {
      const cycle = Math.floor((this.wave / 5 - 1) / BOSS_ROTATION.length);
      const type = BOSS_ROTATION[(this.wave / 5 - 1) % BOSS_ROTATION.length];
      const boss = this.spawnEnemy(type, 0, null, 1 + cycle * 0.6);
      this.gfx.push({ t: 'boss', name: ENEMIES[type].name, id: boss.id });
    }
    for (const p of this.players.values()) p.ready = false;
    this.nextShrineAt = this.time + 15;
    if (this.swarm) this.toast('SWARM NIGHT - the machines are coming in massive packs!', 'bad');
    this.toast(`Wave ${this.wave} - ${count} hostiles inbound${this.weather === 'storm' ? ' (SOLAR STORM)' : this.weather === 'dust' ? ' (dust)' : ''}`, 'wave');
    if (this.weather === 'storm') this.toast('SOLAR STORM - unshielded structures will take damage!', 'bad');
  }

  endWave() {
    this.phase = 'build';
    this.quietNight = isNightAt(this.clock());
    this.shrines = [];
    this.fireZones = this.fireZones.filter((f) => f.layer !== 0);
    this.projectiles = this.projectiles.filter((pr) => pr.owner !== 'e');
    this.weather = 'clear';
    for (const p of this.players.values()) {
      p.pending.xp += XP_PER_WAVE(this.wave);
      p.pending.points += POINTS_PER_WAVE(this.wave);
      p.pending.waves += 1;
      if (p.dead || p.spectator) this.respawn(p);
      p.lives = LIVES_PER_WAVE;
      p.spectator = false;
      for (const w in p.ammo) p.ammo[w].reserve = Math.max(p.ammo[w].reserve, this.reserveSize(p, w));
      p.consumables.grenade = Math.min(CONSUMABLES.grenade.max, p.consumables.grenade + 1);
      this.flushProgress(p);
    }
    if (this.sessionId) db.updateSession(this.sessionId, { waveReached: this.wave }).catch(() => {});
    this.toast(`Wave ${this.wave} repelled! The machines return at nightfall`, 'wave');
  }

  gameOver() {
    this.phase = 'gameover';
    this.phaseEnd = this.time + 15;
    for (const p of this.players.values()) this.flushProgress(p, { gamesPlayed: 1, bestWave: this.wave });
    this.endSession('defeat');
    this.io.to(this.channel).emit('gameover', { wave: this.wave, players: this.playerSummary(), terraform: Math.floor(this.terraform) });
  }

  victory() {
    this.phase = 'victory';
    this.phaseEnd = this.time + 40;
    for (const p of this.players.values()) { p.pending.xp += 3000; p.pending.points += 2000; this.flushProgress(p, { gamesPlayed: 1, bestWave: this.wave }); }
    this.endSession('victory');
    this.io.to(this.channel).emit('victory', { wave: this.wave, players: this.playerSummary() });
  }

  flushProgress(p, extra = {}) {
    const pend = p.pending;
    if (!pend.xp && !pend.points && !pend.kills && !pend.waves && !extra.gamesPlayed) return;
    const payload = { xp: pend.xp, points: pend.points, kills: pend.kills, waves: pend.waves, ...extra };
    p.pending = { xp: 0, points: 0, kills: 0, waves: 0 };
    awardProgress(p.userId, payload).then((res) => {
      if (!res) return;
      p.level = res.user.level;
      p.socket.emit('progress', { xp: payload.xp, points: payload.points, level: res.user.level });
      if (res.levelsGained) p.socket.emit('toast', { text: `LEVEL UP! You are now level ${res.user.level} - spend skill points in the menu`, kind: 'level' });
    });
  }

  toast(text, kind = 'info') { this.gfx.push({ t: 'toast', text, kind }); }
  layerFx(layer, f) { this.fx[layer].push(f); }
  deny(p, text) { p.socket.emit('toast', { text, kind: 'bad' }); }

  // ------------------------------------------------------------------ players update
  respawn(p) {
    p.dead = false;
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    p.o2 = this.o2Max(p);
    p.ride = null;
    p.spawnProtect = this.time + 2;
    p.reloadUntil = 0;
    p.shield = PLAYER_SHIELD.levels[p.shieldLvl];
    p.elevated = false;
    this.placeAtHq(p);
  }

  updatePlayers(dt) {
    for (const p of this.players.values()) {
      if (p.dead) {
        if (!p.spectator && this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      for (const b in p.buffs) if (p.buffs[b] <= this.time) delete p.buffs[b];
      if (p.buffs.regeneration) p.hp = Math.min(p.maxHp, p.hp + 8 * dt);
      const shMax = PLAYER_SHIELD.levels[p.shieldLvl];
      if (p.shield < shMax && this.time - p.lastHurt > PLAYER_SHIELD.delay) p.shield = Math.min(shMax, p.shield + PLAYER_SHIELD.regen * dt);

      if (p.ride) { this.updateRide(p); this.updateOxygen(p, dt); continue; }
      const grid = this.L(p.layer);
      const { mx, my } = p.input;
      const moving = mx || my;
      const sprinting = p.input.sp && moving && p.stamina > 1;
      p.stamina = sprinting ? Math.max(0, p.stamina - 28 * dt) : Math.min(p.maxStamina, p.stamina + 18 * dt);
      p.moveSpeed = p.stats.speed * SUIT.boots.levels[p.up.boots].speed * (p.buffs.speed_boost ? 1.35 : 1);
      const speed = p.moveSpeed * (sprinting ? SPRINT_MULT : 1);
      const fell = moving ? stepPlayer(p, mx * speed * dt, my * speed * dt, grid, grid.sAt, PLAYER_RADIUS) : updateElevation(p, grid, grid.sAt);
      if (fell) { p.hp = Math.max(1, p.hp - FALL_DAMAGE); this.layerFx(p.layer, { t: 'fall', id: p.id }); }
      p.angle = p.input.a;

      if (p.reloadUntil && this.time >= p.reloadUntil) this.finishReload(p);
      if (p.input.f) this.tryFire(p);
      if (p.input.i) this.interact(p, dt); else p.interacting = null;
      if (this.medBayHeal(p, dt) && !p.interacting) p.interacting = 'heal';
      if (p.input.d) this.digTick(p, dt); else { p.digging = -1; p.beam = 0; }
      this.updateOxygen(p, dt);
      if (!p.dead) this.autoDeposit(p);
    }
  }

  updateOxygen(p, dt) {
    const max = this.o2Max(p);
    let refill = !!p.ride || (p.layer === 0 && this.inAtmosphere(p.x, p.y));
    if (!refill) for (const s of this.structures.values()) {
      if (s.kind === 'elevator' && s.layer === p.layer && s.built && s.powered && Math.hypot(s.x - p.x, s.y - p.y) < 140) { refill = true; break; } // every lift stop is pressurised
      if (s.kind === 'o2_station' && s.layer === p.layer && s.built && s.powered && Math.hypot(s.x - p.x, s.y - p.y) < O2.stationRange * (1 + 0.25 * (s.level - 1))) { refill = true; break; }
    }
    p.inO2 = refill;
    if (refill || p.god) p.o2 = Math.min(max, p.o2 + O2.refill * dt);
    else p.o2 = Math.max(0, p.o2 - O2.drain * dt * (1 - this.terraform / 100));
    if (p.o2 <= 0 && this.terraform < 100) {
      p.hp -= O2.suffocateDps * dt;
      if (p.hp <= 0) this.killPlayer(p, 'ran out of oxygen');
    }
  }

  currentWeapon(p) { return p.unlocked[p.current] || 'bat'; }

  tryFire(p) {
    if (this.time < p.nextFireAt) return;
    const wid = this.currentWeapon(p);
    const w = WEAPONS[wid];
    const dmgMult = p.stats.damage * (p.buffs.double_damage ? 2 : 1) * (p.elevated ? HIGH_GROUND_DAMAGE : 1);
    if (w.kind === 'melee') {
      p.nextFireAt = this.time + w.cooldown;
      for (const e of this.L(p.layer).hash.query(p.x, p.y, w.range + 40)) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > w.range + e.r || angleDiff(Math.atan2(e.y - p.y, e.x - p.x), p.angle) > w.arc / 2) continue;
        this.damageEnemy(e, w.damage * dmgMult, { player: p, kind: 'melee', canCrit: true });
        if (w.knockback && !e.def.boss) {
          const k = w.knockback * (e.def.armor ? 0.4 : 1);
          e.kx += ((e.x - p.x) / (d || 1)) * k; e.ky += ((e.y - p.y) / (d || 1)) * k;
        }
      }
      if (this.time - p.lastSwingFx > 0.2) { this.layerFx(p.layer, { t: 'swing', id: p.id, w: wid }); p.lastSwingFx = this.time; }
      return;
    }
    if (p.reloadUntil) return;
    const st = p.ammo[wid];
    const infinite = !!p.buffs.infinite_ammo;
    if (st.mag <= 0 && !infinite) { this.startReload(p); return; }
    if (!infinite) st.mag--;
    p.nextFireAt = this.time + w.cooldown;
    const mx = p.x + Math.cos(p.angle) * 18, my = p.y + Math.sin(p.angle) * 18;
    const kind = wid === 'laser' ? 'beam' : wid === 'rocket' ? 'rocket' : 'bolt';
    for (let i = 0; i < w.pellets; i++) {
      const a = p.angle + (Math.random() - 0.5) * w.spread;
      this.projectiles.push({
        id: this.eid(), kind, layer: p.layer, owner: p, x: mx, y: my, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
        life: w.range / w.speed, damage: w.damage * dmgMult, pierce: w.pierce || 1, splash: w.splash || 0, hit: null, w: wid,
      });
    }
    this.layerFx(p.layer, { t: 'shot', id: p.id, w: wid });
    if (st.mag <= 0 && !infinite) this.startReload(p);
  }

  startReload(p) {
    const wid = this.currentWeapon(p);
    const st = p.ammo[wid];
    if (!st || p.reloadUntil || st.reserve <= 0 || st.mag >= this.magSize(p, wid)) return;
    p.reloadUntil = this.time + WEAPONS[wid].reload / p.stats.reload;
    p.reloadStart = this.time;
    p.reloadWid = wid;
  }

  finishReload(p) {
    const st = p.ammo[p.reloadWid];
    if (st) {
      const take = Math.min(this.magSize(p, p.reloadWid) - st.mag, st.reserve);
      st.mag += take; st.reserve -= take;
    }
    p.reloadUntil = 0;
  }

  // Hold E: repair the nearest damaged structure (costs iron) or the HQ.
  interact(p, dt) {
    let target = null, best = 90 ** 2;
    for (const s of this.structures.values()) {
      if (s.layer !== p.layer || !s.built || s.hp >= s.maxHp) continue;
      const d = dist2(s, p);
      if (d < best) { best = d; target = s; }
    }
    const hqClose = p.layer === 0 && Math.hypot(this.hq.x - p.x, this.hq.y - p.y) < 130 && this.hq.hp < this.hq.max;
    if (!target && !hqClose) { p.interacting = null; return; }
    const obj = target || this.hq;
    const maxHp = target ? target.maxHp : this.hq.max;
    const gain = Math.min(55 * p.stats.buildSpeed * dt, maxHp - obj.hp);
    p.acc.repair += gain / 12;
    const cost = Math.floor(p.acc.repair);
    if (cost > (this.res.iron || 0)) { p.interacting = null; return; }
    this.res.iron -= cost;
    p.acc.repair -= cost;
    obj.hp += gain;
    p.interacting = 'repair';
  }

  medBayHeal(p, dt) {
    if (p.dead || p.hp >= p.maxHp || (this.res.iron || 0) <= 0) return false;
    let near = false;
    for (const s of this.structures.values()) {
      if (s.kind === 'med_bay' && s.layer === p.layer && s.built && s.powered && Math.hypot(s.x - p.x, s.y - p.y) < SHOP_RANGE) { near = true; break; }
    }
    if (!near) return false;
    const heal = Math.min(MED_BAY_HEAL.hps * dt, p.maxHp - p.hp);
    p.acc.heal += heal / MED_BAY_HEAL.hpPerIron;
    const cost = Math.floor(p.acc.heal);
    this.res.iron -= cost;
    p.acc.heal -= cost;
    p.hp += heal;
    return true;
  }

  // ------------------------------------------------------------------ digging
  digTime(layer, t, buildSpeed = 1) {
    return ROCK_DIG_TIME[layer] * (t === U_HARD ? HARD_ROCK_MULT : 1) / (digSpeedMult(this.techs) * buildSpeed);
  }

  // The mining laser fires straight ahead along the aim: it cuts the first rock in its path and
  // burns any machine it crosses. Buildings stop the beam unharmed.
  digTick(p, dt) {
    const g = this.L(p.layer);
    const tool = MINING_TOOL[p.up.tool];
    const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
    p.digging = -1; p.beam = DIG_REACH;
    for (let d = 10; d <= DIG_REACH; d += 6) {
      const x = p.x + ax * d, y = p.y + ay * d;
      const tx = tileOf(x), ty = tileOf(y);
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) { p.beam = d; break; }
      const i = ty * g.w + tx;
      if (this.structAt(p.layer, i)?.def.block || (p.layer === 0 && g.terrain[i] === 2)) { p.beam = d; break; }
      if (!g.solid[i]) continue;
      p.beam = d;
      if (canDig(p.layer, g, i)) { p.digging = i; this.digAt(g, i, dt * tool.speed / this.digTime(p.layer, g.terrain[i], p.stats.buildSpeed), { player: p }); }
      break;
    }
    const e = this.nearestEnemy(p.layer, { x: p.x + ax * p.beam / 2, y: p.y + ay * p.beam / 2 }, p.beam / 2 + 20);
    if (e) {
      const t = (e.x - p.x) * ax + (e.y - p.y) * ay, off = Math.abs((e.x - p.x) * ay - (e.y - p.y) * ax);
      if (t > 0 && t < p.beam && off < e.r + 6) this.damageEnemy(e, 30 * tool.speed * dt, { player: p, kind: 'laser' });
    }
  }

  // Advance dig progress on tile i; `by` = { player } | { robot } | { structure }.
  digAt(g, i, amount, by) {
    const cur = (g.dig.get(i)?.p || 0) + amount;
    if (cur >= 1) { g.dig.delete(i); this.finishDig(g, i, by); return true; }
    g.dig.set(i, { p: cur, t: this.time });
    if (this.tickCount % 3 === 0) this.layerFx(g.id, { t: 'dig', i, x: tileCenter(i % g.w), y: tileCenter((i / g.w) | 0), o: g.terrain[i] });
    return false;
  }

  finishDig(g, i, by) {
    const old = g.terrain[i];
    g.terrain[i] = U_FLOOR;
    refreshSolid(g, i);
    g.version++;
    const x = tileCenter(i % g.w), y = tileCenter((i / g.w) | 0);
    this.layerFx(g.id, { t: 'dug', i, o: old, x, y, s: g.id === 0 ? 1 : 0 });
    if (g.id === 0) { // surface ridge: opens a new path for attackers too
      g.flowDirty = true;
      if (by.player) this.giveOre(by.player, g.id, x, y, SURFACE_ROCK_YIELD);
      return;
    }
    if (!isOreTile(old)) {
      if (by.player && ROCK_YIELD[old]) this.giveOre(by.player, g.id, x, y, ROCK_YIELD[old]);
      return;
    }
    const ore = oreOfTile(old);
    const amount = ORE_YIELD[g.id];
    if (by.player) {
      this.giveOre(by.player, g.id, x, y, { [ore]: amount });
      by.player.pending.xp += 1;
    } else if (by.robot) {
      by.robot.cargo[ore] = (by.robot.cargo[ore] || 0) + amount;
    } else if (by.structure) {
      by.structure.buffer[ore] = (by.structure.buffer[ore] || 0) + amount;
    }
  }

  giveOre(p, layer, x, y, bundle) {
    const mult = MINING_TOOL[p.up.tool].yield;
    for (const [ore, base] of Object.entries(bundle)) {
      const amount = Math.round(base * mult);
      const take = Math.max(0, Math.min(this.packCap(p) - this.packTotal(p), amount));
      if (take > 0) p.pack[ore] = (p.pack[ore] || 0) + take;
      p.match.mined += take;
      if (amount - take > 0) this.dropOre(layer, x, y, { [ore]: amount - take });
      this.layerFx(layer, { t: 'ore', x, y, r: ore, v: take, by: p.id });
    }
    p.pending.xp += 1;
  }

  dropOre(layer, x, y, bundle) {
    this.pickups.push({ id: this.eid(), layer, x: x + rand(-10, 10), y: y + rand(-10, 10), kind: 'ore', bundle: { ...bundle }, expires: this.time + 120 });
  }

  // Standing next to a powered elevator (or the HQ on the surface) unloads your backpack into the
  // logistics chain; the ore travels up to the surface refining queue.
  autoDeposit(p) {
    const total = this.packTotal(p);
    if (!total) return;
    let ok = p.layer === 0 && Math.hypot(p.x - this.hq.x, p.y - this.hq.y) < 140;
    if (!ok) for (const s of this.structures.values()) {
      if (s.kind === 'elevator' && s.layer === p.layer && s.built && s.powered && Math.hypot(s.x - p.x, s.y - p.y) < 110) { ok = true; break; }
    }
    if (!ok) return;
    addRes(this.ore, p.pack);
    p.pack = {};
    p.socket.emit('toast', { text: `Sent ${total} ore up to the refineries`, kind: 'good' });
    this.layerFx(p.layer, { t: 'deposit', id: p.id, v: total });
  }

  // ------------------------------------------------------------------ actions
  handleAction(p, a) {
    if (!a || typeof a !== 'object' || this.phase === 'gameover' || this.phase === 'victory') return;
    switch (a.type) {
      case 'switch': {
        const slot = Number(a.slot);
        if (Number.isInteger(slot) && slot >= 0 && slot < p.unlocked.length && slot !== p.current) {
          p.current = slot; p.reloadUntil = 0; p.nextFireAt = Math.max(p.nextFireAt, this.time + 0.15);
        }
        break;
      }
      case 'reload': if (!p.dead) this.startReload(p); break;
      case 'throw': this.throwItem(p, a.item, Number(a.x), Number(a.y)); break;
      case 'medkit':
        if (!p.dead && p.consumables.medkit > 0 && p.hp < p.maxHp) {
          p.consumables.medkit--; p.hp = Math.min(p.maxHp, p.hp + CONSUMABLES.medkit.heal);
          this.layerFx(p.layer, { t: 'heal', id: p.id });
        }
        break;
      case 'build': this.tryBuild(p, a.kind, Number(a.tx), Number(a.ty), Number(a.rot) || 0); break;
      case 'upgrade': this.tryUpgrade(p, Number(a.id)); break;
      case 'demolish': this.tryDemolish(p, Number(a.id)); break;
      case 'wire': {
        const err = this.power.connect(Number(a.a), Number(a.b));
        if (err) this.deny(p, err); else { this.powerTimer = 0; this.layerFx(p.layer, { t: 'wired', a: Number(a.a), b: Number(a.b) }); }
        break;
      }
      case 'unwire': this.power.disconnectAll(Number(a.id)); this.powerTimer = 0; break;
      case 'shop': this.shopBuy(p, a.shop, String(a.item || '')); break;
      case 'research': this.research(p, String(a.tech || '')); break;
      case 'module': this.setModule(p, Number(a.id), Number(a.slot), a.module ?? null); break;
      case 'inspect': { const s = this.structures.get(Number(a.id)); if (s) p.socket.emit('inspect', this.structureDetail(s)); break; }
      case 'elevator': this.rideElevator(p, a.to != null ? Number(a.to) : p.layer + Number(a.dir)); break;
      case 'deepen': this.deepenShaft(p); break;
      case 'dome-size': this.setDomeSize(p, Number(a.v)); break;
      case 'bat-roles': this.setBatteryRoles(p, a.id, a.roles); break;
      case 'pwarn': this.setPowerWarn(p, String(a.role), Number(a.v)); break;
      case 'emitter-size': this.setEmitterSize(p, a.id, Number(a.v)); break;
      case 'clean': this.cleanPanel(p); break;
      case 'suit': this.buySuit(p, String(a.k || '')); break;
      case 'use': this.usePoi(p); break;
      case 'ready': if (this.phase === 'build') p.ready = !p.ready; break;
    }
  }

  throwItem(p, item, tx, ty) {
    const c = CONSUMABLES[item];
    if (!c || item === 'medkit' || p.dead || p.consumables[item] <= 0 || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
    p.consumables[item]--;
    let dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const range = Math.min(d, 440);
    dx = (dx / d) * range; dy = (dy / d) * range;
    const flight = Math.max(0.25, range / 480);
    this.projectiles.push({
      id: this.eid(), kind: item, layer: p.layer, owner: p, x: p.x, y: p.y, sx: p.x, sy: p.y, tx: p.x + dx, ty: p.y + dy,
      t0: this.time, flight, fuseAt: this.time + (item === 'grenade' ? Math.max(c.fuse, flight) : flight), vx: 0, vy: 0,
    });
  }

  research(p, tech) {
    const t = TECH[tech];
    if (!t || this.techs.has(tech)) return;
    if (![...this.structures.values()].some((s) => s.kind === 'research_lab' && s.built && s.powered)) { this.deny(p, 'You need a powered Research Lab'); return; }
    if (this.researching) { this.deny(p, `Already researching ${TECH[this.researching.tech].name}`); return; }
    if (!canAfford(this.res, t.cost)) { this.deny(p, 'Not enough resources for this research'); return; }
    payCost(this.res, t.cost);
    this.researching = { tech, got: 0, need: researchEnergy(tech), by: p.name };
    this.powerTimer = 0;
    this.toast(`${p.name} started researching ${t.name} - the labs need ${this.researching.need}⚡`, 'info');
  }

  // Powered labs pour energy into the current project.
  updateResearch(dt) {
    const r = this.researching;
    if (!r) return;
    for (const s of this.structures.values()) {
      if (s.kind !== 'research_lab' || !s.built || !s.powered) continue;
      r.got += this.power.drawOf(s) * dt;
    }
    if (r.got < r.need) return;
    this.techs.add(r.tech);
    this.researching = null;
    this.powerTimer = 0;
    this.toast(`Research complete: ${TECH[r.tech].name}!`, 'good');
    this.gfx.push({ t: 'research', tech: r.tech });
  }

  liftNear(p) {
    return [...this.structures.values()].find((s) => s.kind === 'elevator' && s.layer === p.layer && s.built && Math.hypot(s.x - p.x, s.y - p.y) < 110);
  }

  // Where the shaft network stops on a level: the main shaft stop, else any lift built there.
  liftStop(layer) {
    let any = null;
    for (const s of this.structures.values()) {
      if (s.kind !== 'elevator' || s.layer !== layer || !s.built) continue;
      if (s.main) return s;
      any ||= s;
    }
    return any;
  }

  // Every lift is part of one network: ride from any powered lift to any level the shaft reaches.
  rideElevator(p, to) {
    if (p.dead || !Number.isInteger(to) || to === p.layer || to < 0 || to > DEPTHS) return;
    const lift = this.liftNear(p);
    if (!lift) { this.deny(p, 'Stand next to an elevator'); return; }
    if (!lift.powered) { this.deny(p, 'The elevator has no power - wire it to your grid'); return; }
    if (to > this.shaftDepth) { this.deny(p, `The shaft only reaches ${LAYER_NAMES[this.shaftDepth]} - pay to bore deeper`); return; }
    const dest = this.liftStop(to);
    if (!dest) { this.deny(p, 'No lift stop on that level'); return; }
    // step into the cage: it drops (or rises) out of sight, then arrives at the other level
    p.ride = { phase: 1, t0: this.time, from: lift, dest, dir: to > p.layer ? 1 : -1 };
    p.x = lift.x; p.y = lift.y + 6; p.elevated = false; p.digging = -1; p.beam = 0;
    p.spawnProtect = this.time + RIDE_TIME * 2 + 1;
    this.layerFx(p.layer, { t: 'ride', id: p.id, x: lift.x, y: lift.y });
  }

  updateRide(p) {
    const r = p.ride;
    if (this.time - r.t0 < RIDE_TIME) return;
    if (r.phase === 2) { // step out of the cage
      p.ride = null;
      p.x = r.dest.x + rand(-20, 20); p.y = r.dest.y + 56;
      return;
    }
    const dest = r.dest;
    r.phase = 2; r.t0 = this.time;
    p.layer = dest.layer;
    p.elevated = false;
    p.x = dest.x; p.y = dest.y + 6;
    p.digging = -1;
    p.socket.emit('layer', { layer: dest.layer, terrain: Array.from(this.L(dest.layer).terrain) });
    this.layerFx(dest.layer, { t: 'arrive', id: p.id });
  }

  // ------------------------------------------------------------------ colony dome
  domeDraw() { return this.dome && this.dome.up ? domeDrawAt(this.dome.level, this.dome.radius / TILE) : 0.3; }
  emitterDraw(s) { return 0.4 + (s.def.draw * (s.size || 6) ** 2 / 36) * Math.pow(0.85, s.level - 1); }
  inDome(x, y, pad = 0) { return Math.hypot(x - this.hq.x, y - this.hq.y) <= this.dome.radius - pad; }
  inAtmosphere(x, y) { return this.dome.up && this.inDome(x, y); }

  // A standing dome is a wall: machines (walkers and flyers) are held at the shell and batter it.
  domeRepel(e) {
    const d = this.dome;
    if (e.layer !== 0 || !d.up) return false;
    const dx = e.x - this.hq.x, dy = e.y - this.hq.y, dist = Math.hypot(dx, dy) || 1, R = d.radius + e.r;
    if (dist >= R) return false;
    e.x = this.hq.x + (dx / dist) * R; e.y = this.hq.y + (dy / dist) * R;
    if (e.attackCd <= 0) {
      this.absorbDome(this.hq.x + (dx / dist) * d.radius, this.hq.y + (dy / dist) * d.radius, e.damage * (e.def.structMult || 1));
      e.attackCd = e.def.attackRate;
    }
    return true;
  }

  // The bubble eases toward the size on its slider while it has power; without power it shrinks
  // back to cover just the HQ, and only collapses once it is that small and still starved.
  updateDome(dt) {
    const d = this.dome, def = DOME[d.level], step = DOME_RESIZE * TILE * dt;
    if (this.hq.powered) {
      d.darkFor = 0;
      const want = d.target * TILE;
      d.radius = d.radius < want ? Math.min(want, d.radius + step) : Math.max(want, d.radius - step * 2);
      d.shield = Math.min(def.shield, d.shield + def.regen * dt);
      if (!d.up && d.shield >= def.shield * DOME_REBOOT) { d.up = true; this.toast('Colony dome restored - atmosphere holding', 'good'); this.layerFx(0, { t: 'dome', up: 1 }); }
    } else {
      d.darkFor += dt;
      d.radius = Math.max(DOME_MIN * TILE, d.radius - step * 3);
      if (d.up && d.radius <= DOME_MIN * TILE + 1 && d.darkFor > 6) this.domeDown('Colony dome out of power and collapsed! Buildings will decompress');
    }
    // anything left outside the air (bubble shrank, or collapsed) starts to decompress after a grace period
    for (const s of this.structures.values()) {
      if (s.layer !== 0 || s.kind === 'elevator') continue;
      const exposed = !d.up || !this.inDome(s.x, s.y);
      if (!exposed) { s.exposedAt = null; continue; }
      s.exposedAt ??= this.time;
      if (this.time - s.exposedAt > DOME_GRACE) this.damageStructure(s, s.maxHp * DOME_DECOMPRESS * dt, true);
    }
  }

  setDomeSize(p, tiles) {
    if (!Number.isFinite(tiles)) return;
    this.dome.target = Math.max(DOME_MIN, Math.min(DOME_MAX, Math.round(tiles * 2) / 2));
    this.powerTimer = 0;
  }

  domeDown(msg) {
    const d = this.dome;
    d.up = false; d.downAt = this.time;
    this.toast(msg, 'bad');
    this.layerFx(0, { t: 'dome', up: 0 });
  }

  // Attacks on anything inside the raised dome hit the shield first. The impact flares on the shell
  // where the attack came through.
  absorbDome(x, y, amount) {
    const d = this.dome;
    if (!d.up || !this.inDome(x, y, -40)) return amount;
    const a = Math.min(d.shield, amount);
    d.shield -= a;
    if (this.time - (d.lastFx || 0) > 0.05) {
      d.lastFx = this.time;
      const ang = Math.atan2(y - this.hq.y, x - this.hq.x);
      this.layerFx(0, { t: 'domehit', a: Math.round(ang * 100) / 100, v: Math.round(a) });
    }
    if (d.shield <= 0) this.domeDown(`Colony dome collapsed! ${DOME_GRACE}s until buildings start to decompress`);
    return amount - a;
  }

  upgradeDome() {
    const next = DOME[this.dome.level + 1];
    if (!next) return 'The dome is fully upgraded';
    this.dome.level++;
    this.powerTimer = 0;
    this.toast(`Colony dome upgraded to ${next.name}: stronger shield, less power per tile`, 'good');
    return true;
  }

  // ------------------------------------------------------------------ power management actions
  setBatteryRoles(p, id, roles) {
    const s = this.structures.get(Number(id));
    if (!s || !s.def.capacity || !roles || typeof roles !== 'object') return;
    const next = {};
    for (const r of [...POWER_ROLES, 'reserve']) next[r] = !!roles[r];
    if (!POWER_ROLES.some((r) => next[r])) { this.deny(p, 'A battery needs at least one system'); return; }
    s.roles = next;
    this.powerTimer = 0;
    p.socket.emit('inspect', this.structureDetail(s));
  }

  setPowerWarn(p, role, pct) {
    if (!POWER_ROLES.includes(role) || !Number.isFinite(pct)) return;
    this.powerWarn[role] = Math.max(0, Math.min(90, Math.round(pct)));
    this.power.warned.delete(role);
  }

  setEmitterSize(p, id, tiles) {
    const s = this.structures.get(Number(id));
    if (!s || s.kind !== 'shield_projector' || !Number.isFinite(tiles)) return;
    s.size = Math.max(EMITTER_MIN, Math.min(EMITTER_MAX, Math.round(tiles)));
    this.powerTimer = 0;
    p.socket.emit('inspect', this.structureDetail(s));
  }

  // Wipe the dust off the nearest solar panel (E next to it).
  cleanPanel(p) {
    let best = null, bd = 100 ** 2;
    for (const s of this.structures.values()) {
      if (!s.def.solar || s.layer !== p.layer || (s.dirt || 0) < 0.05) continue;
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return false;
    best.dirt = 0;
    this.layerFx(p.layer, { t: 'clean', x: best.x, y: best.y });
    return true;
  }

  // Character menu: personal suit upgrades paid from the colony stockpile.
  buySuit(p, k) {
    if (!SUIT_IDS.includes(k) || p.dead) return;
    const info = suitInfo(k, p.up[k]);
    if (!info.next) { this.deny(p, `${info.name} is fully upgraded`); return; }
    if (!canAfford(this.res, info.cost)) { this.deny(p, 'Not enough resources'); return; }
    payCost(this.res, info.cost);
    p.up[k]++;
    if (k === 'armor') { const old = p.maxHp; p.maxHp = Math.round(p.stats.maxHp * SUIT.armor.levels[p.up.armor].hp); p.hp += p.maxHp - old; }
    if (k === 'o2') p.o2 = this.o2Max(p);
    p.socket.emit('bought', { item: k, name: info.next });
    this.layerFx(p.layer, { t: 'heal', id: p.id });
  }

  // Bore the main shaft one level deeper (opens an arrival chamber and a lift stop there).
  deepenShaft(p) {
    const lift = this.liftNear(p);
    if (!lift || p.dead) { this.deny(p, 'Stand next to an elevator'); return; }
    const next = this.shaftDepth + 1;
    if (next > DEPTHS) { this.deny(p, 'The shaft already reaches the deepest level'); return; }
    const cost = SHAFT_COST[next];
    if (!canAfford(this.res, cost)) { this.deny(p, 'Not enough resources to bore deeper'); return; }
    payCost(this.res, cost);
    this.digShaftBelow(this.liftStop(this.shaftDepth));
    this.shaftDepth = next;
    this.toast(`${p.name} bored the shaft down to ${LAYER_NAMES[next]}!`, 'good');
    this.layerFx(p.layer, { t: 'built', x: lift.x, y: lift.y, k: 'elevator' });
  }

  usePoi(p) {
    const poi = this.pois.find((o) => o.layer === p.layer && !o.looted && Math.hypot(o.x - p.x, o.y - p.y) < 90);
    if (!poi) return;
    poi.looted = true;
    addRes(this.res, poi.loot.res);
    if (poi.loot.module) this.modules[poi.loot.module]++;
    const parts = Object.entries(poi.loot.res).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
    if (poi.loot.module) parts.push(`module: ${MODULES[poi.loot.module].name}`);
    this.toast(`${p.name} recovered ${poi.kind === 'probe' ? 'a crashed probe' : 'ancient technology'}: ${parts.join(', ')}`, 'good');
    this.layerFx(p.layer, { t: 'loot', x: poi.x, y: poi.y, k: poi.kind });
    p.pending.xp += poi.kind === 'probe' ? 20 : 60;
  }

  // ------------------------------------------------------------------ shops
  nearShop(p, shop) {
    if (shop === 'hq') return p.layer === 0 && Math.hypot(p.x - this.hq.x, p.y - this.hq.y) < SHOP_RANGE + 40;
    for (const s of this.structures.values()) {
      if (s.kind === shop && s.layer === p.layer && s.built && s.powered && Math.hypot(s.x - p.x, s.y - p.y) < SHOP_RANGE + 20) return true;
    }
    return false;
  }

  shopBuy(p, shop, item) {
    const def = SHOPS[shop];
    if (!def || !def.items.includes(item) || p.dead) return;
    if (!this.nearShop(p, shop)) { this.deny(p, `Stand next to a powered ${def.name}`); return; }
    const info = shopItemInfo(item, { shieldLvl: p.shieldLvl, techs: this.techs, toolLvl: p.up.tool, domeLvl: this.dome.level });
    if (!info.price) { this.deny(p, info.desc || 'Not available'); return; }
    if (!canAfford(this.res, info.price)) { this.deny(p, 'Not enough resources'); return; }
    const result = this.applyPurchase(p, item);
    if (result !== true) { this.deny(p, result || 'Cannot buy that'); return; }
    payCost(this.res, info.price);
    p.socket.emit('bought', { item, name: info.name });
  }

  applyPurchase(p, item) {
    if (item.startsWith('w:')) {
      const w = item.slice(2);
      if (!WEAPONS[w]) return 'Unknown weapon';
      if (p.unlocked.includes(w)) return 'You already carry that';
      const held = this.currentWeapon(p);
      p.unlocked = WEAPON_ORDER.filter((x) => x === w || p.unlocked.includes(x));
      p.current = p.unlocked.indexOf(held);
      if (WEAPONS[w].kind === 'ranged') p.ammo[w] = { mag: this.magSize(p, w), reserve: this.reserveSize(p, w) };
      return true;
    }
    if (item.startsWith('bot:')) return this.buyRobot(p, item.slice(4));
    switch (item) {
      case 'ammo': {
        const wid = this.currentWeapon(p), st = p.ammo[wid];
        if (!st) return 'Hold a gun to refill its cells';
        if (st.reserve >= this.reserveSize(p, wid)) return 'Already full';
        st.reserve = this.reserveSize(p, wid);
        return true;
      }
      case 'medkit': case 'grenade': case 'molotov':
        if (p.consumables[item] >= CONSUMABLES[item].max) return 'You are carrying the maximum';
        p.consumables[item]++;
        return true;
      case 'dome': return this.upgradeDome();
      case 'tool':
        if (!MINING_TOOL[p.up.tool + 1]) return 'Mining laser is maxed';
        p.up.tool++;
        return true;
      case 'full_heal':
        if (p.hp >= p.maxHp) return 'Already at full health';
        p.hp = p.maxHp;
        this.layerFx(p.layer, { t: 'heal', id: p.id });
        return true;
      case 'shield':
        if (p.shieldLvl >= PLAYER_SHIELD.levels.length - 1) return 'Shield is maxed';
        p.shieldLvl++;
        p.shield = PLAYER_SHIELD.levels[p.shieldLvl];
        return true;
    }
    return 'Unknown item';
  }

  // ------------------------------------------------------------------ damage to players
  damagePlayer(p, amount) {
    if (amount <= 0 || p.dead || p.god || this.time < p.spawnProtect) return;
    p.lastHurt = this.time;
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, amount);
      p.shield -= absorbed; amount -= absorbed;
      this.layerFx(p.layer, { t: 'pshield', id: p.id });
      if (amount <= 0) return;
    }
    p.hp -= amount;
    this.layerFx(p.layer, { t: 'hurt', id: p.id });
    if (p.hp <= 0) this.killPlayer(p);
  }

  killPlayer(p, why = '') {
    if (p.dead) return;
    p.hp = 0;
    p.dead = true;
    p.lives--;
    p.reloadUntil = 0;
    p.digging = -1;
    if (this.packTotal(p)) { this.dropOre(p.layer, p.x, p.y, p.pack); p.pack = {}; }
    if (p.lives > 0) {
      p.respawnAt = this.time + RESPAWN_DELAY;
      this.toast(`${p.name} went down${why ? ` (${why})` : ''} - ${p.lives} ${p.lives === 1 ? 'life' : 'lives'} left`, 'bad');
    } else {
      p.spectator = true;
      this.toast(`${p.name} is out until the wave ends`, 'bad');
    }
    this.layerFx(p.layer, { t: 'death', x: p.x, y: p.y });
  }

  // ------------------------------------------------------------------ projectiles
  updateProjectiles(dt) {
    const near = [];
    for (const pr of this.projectiles) {
      const g = this.L(pr.layer);
      if (pr.kind === 'grenade' || pr.kind === 'molotov' || pr.kind === 'shell') {
        const t = Math.min(1, (this.time - pr.t0) / pr.flight);
        pr.x = pr.sx + (pr.tx - pr.sx) * t; pr.y = pr.sy + (pr.ty - pr.sy) * t;
        if (this.time >= pr.fuseAt) {
          pr.dead = true;
          if (pr.kind === 'grenade') this.explode(pr.layer, pr.x, pr.y, CONSUMABLES.grenade.radius, CONSUMABLES.grenade.damage * pr.owner.stats.damage, { player: pr.owner });
          else if (pr.kind === 'shell') this.explode(pr.layer, pr.x, pr.y, pr.splash, pr.damage, { structure: pr.src }, false);
          else {
            const c = CONSUMABLES.molotov;
            this.fireZones.push({ layer: pr.layer, x: pr.x, y: pr.y, r: c.radius, until: this.time + c.duration, dps: c.dps * pr.owner.stats.damage, owner: pr.owner });
          }
        }
        continue;
      }
      if (pr.kind === 'missile') { // homing anti-air missile
        const tgt = pr.target && !pr.target.dead ? pr.target : null;
        if (tgt) {
          const want = Math.atan2(tgt.y - pr.y, tgt.x - pr.x), cur = Math.atan2(pr.vy, pr.vx);
          const turn = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
          const a = cur + Math.max(-6 * dt, Math.min(6 * dt, turn)), sp = 620;
          pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
          if (dist2(tgt, pr) < (tgt.r + 12) ** 2) { pr.dead = true; this.explode(pr.layer, pr.x, pr.y, pr.splash, pr.damage, { structure: pr.src }, true); continue; }
        }
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
        if (pr.life <= 0) { pr.dead = true; this.explode(pr.layer, pr.x, pr.y, pr.splash, pr.damage, { structure: pr.src }, true); }
        continue;
      }
      const ox = pr.x, oy = pr.y;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.owner === 'e' && pr.layer === 0 && this.dome.up && this.inDome(pr.x, pr.y) && !this.inDome(ox, oy)) {
        pr.dead = true; this.absorbDome(pr.x, pr.y, pr.damage); continue;
      }
      const tx = tileOf(pr.x), ty = tileOf(pr.y);
      if (pr.life <= 0 || tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) { pr.dead = true; if (pr.kind === 'rocket') this.explode(pr.layer, pr.x, pr.y, pr.splash, pr.damage, { player: pr.owner }); continue; }
      const ti = ty * g.w + tx;
      const isHqTile = pr.layer === 0 && g.terrain[ti] === 2;
      if (g.solid[ti] && !isHqTile) {
        pr.dead = true;
        this.layerFx(pr.layer, { t: 'spark', x: Math.round(pr.x), y: Math.round(pr.y) });
        if (pr.kind === 'rocket') this.explode(pr.layer, pr.x, pr.y, pr.splash, pr.damage, { player: pr.owner });
        continue;
      }
      if (pr.owner === 'e') {
        for (const p of this.players.values()) {
          if (!p.dead && p.layer === pr.layer && Math.hypot(p.x - pr.x, p.y - pr.y) < PLAYER_RADIUS + 6) { this.damagePlayer(p, this.absorbShield(pr.layer, p.x, p.y, pr.damage)); pr.dead = true; break; }
        }
        if (pr.dead) continue;
        const s = this.structAt(pr.layer, ti);
        if (isHqTile) { this.damageHq(pr.damage); pr.dead = true; }
        else if (s && s.def.block) { this.damageStructure(s, pr.damage); pr.dead = true; }
        if (pr.dead) this.layerFx(pr.layer, { t: 'splat', x: Math.round(pr.x), y: Math.round(pr.y) });
        continue;
      }
      if (!this.players.has(pr.owner.sid)) { pr.dead = true; continue; }
      const sx = pr.x - ox, sy = pr.y - oy, sl2 = sx * sx + sy * sy || 1;
      for (const e of g.hash.query((ox + pr.x) / 2, (oy + pr.y) / 2, Math.sqrt(sl2) / 2 + 48, near)) {
        if (e.dead || (pr.hit && pr.hit.has(e.id))) continue;
        const t = Math.max(0, Math.min(1, ((e.x - ox) * sx + (e.y - oy) * sy) / sl2));
        const cx = ox + sx * t, cy = oy + sy * t;
        if ((e.x - cx) ** 2 + (e.y - cy) ** 2 > (e.r + 4) ** 2) continue;
        if (pr.kind === 'rocket') { pr.dead = true; this.explode(pr.layer, cx, cy, pr.splash, pr.damage, { player: pr.owner }); break; }
        this.damageEnemy(e, pr.damage, { player: pr.owner, kind: pr.kind === 'beam' ? 'laser' : 'bullet', canCrit: true });
        if (--pr.pierce <= 0) { pr.dead = true; break; }
        (pr.hit ||= new Set()).add(e.id);
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ------------------------------------------------------------------ world entities & economy
  updateWorld(dt) {
    if (this.weather === 'storm' && this.phase === 'wave') this.updateStorm(dt);
    this.fireZones = this.fireZones.filter((f) => f.until > this.time);
    for (const f of this.fireZones) {
      for (const e of this.L(f.layer).hash.query(f.x, f.y, f.r + 20)) {
        if (!e.dead && !e.def.fly && Math.hypot(e.x - f.x, e.y - f.y) < f.r + e.r) this.ignite(e, f.dps, f.owner);
      }
    }
    const tractors = [];
    for (const s of this.structures.values()) if (s.kind === 'tractor' && s.built && s.powered) tractors.push(s);
    // salvage & ore pickups: tractor beams reel in salvage, players hoover up the rest
    for (const pk of this.pickups) {
      if (pk.dead) continue;
      if (pk.expires < this.time) { pk.dead = true; continue; }
      if (pk.kind === 'salvage' && pk.layer === 0 && tractors.length) {
        let tb = null, tbd = Infinity;
        for (const s of tractors) { const d = dist2(s, pk), R = s.def.range * (1 + 0.25 * (s.level - 1)); if (d < R * R && d < tbd) { tbd = d; tb = s; } }
        if (tb) {
          const d = Math.sqrt(tbd);
          pk.expires = Math.max(pk.expires, this.time + 5);
          if (d < 26) { addRes(this.res, pk.bundle); pk.dead = true; tb.collected = (tb.collected || 0) + 1; continue; }
          const sp = tb.def.pullSpeed * (1 + 0.25 * (tb.level - 1));
          pk.x += ((tb.x - pk.x) / d) * sp * dt; pk.y += ((tb.y - pk.y) / d) * sp * dt;
          continue;
        }
      }
      let best = null, bd = 90 * 90;
      for (const p of this.players.values()) {
        if (p.dead || p.layer !== pk.layer) continue;
        if (pk.kind === 'ore' && this.packTotal(p) >= this.packCap(p)) continue;
        const d = dist2(p, pk);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      const d = Math.sqrt(bd);
      if (d < 22) {
        if (pk.kind === 'ore') {
          for (const [k, v] of Object.entries(pk.bundle)) {
            const take = Math.min(v, this.packCap(best) - this.packTotal(best));
            if (take <= 0) continue;
            best.pack[k] = (best.pack[k] || 0) + take;
            pk.bundle[k] -= take;
          }
          if (Object.values(pk.bundle).every((v) => v <= 0)) pk.dead = true;
        } else { addRes(this.res, pk.bundle); pk.dead = true; }
        continue;
      }
      pk.x += ((best.x - pk.x) / d) * 320 * dt; pk.y += ((best.y - pk.y) / d) * 320 * dt;
    }
    this.pickups = this.pickups.filter((p) => !p.dead);
    if (this.pickups.length > 900) this.pickups.splice(0, this.pickups.length - 900);

    const alive = [...this.players.values()].filter((p) => !p.dead && p.layer === 0);
    for (const sh of this.shrines) {
      if (sh.expires < this.time) { sh.dead = true; continue; }
      const capper = alive.find((p) => Math.hypot(p.x - sh.x, p.y - sh.y) < 46);
      if (capper) {
        sh.progress += dt;
        if (sh.progress >= SHRINE_CAPTURE_TIME) {
          sh.dead = true;
          capper.buffs[sh.perk] = this.time + PERKS[sh.perk].duration;
          this.toast(`${capper.name} activated ${PERKS[sh.perk].name}!`, 'good');
          this.layerFx(0, { t: 'shrine', x: sh.x, y: sh.y });
        }
      } else sh.progress = Math.max(0, sh.progress - dt * 0.5);
    }
    this.shrines = this.shrines.filter((s) => !s.dead);
    if (this.tickCount % 30 === 0) for (const g of this.layers) for (const [i, d] of g.dig) if (this.time - d.t > 4) g.dig.delete(i);
  }

  spawnShrine() {
    const g = this.L(0);
    for (let tries = 0; tries < 50; tries++) {
      const a = Math.random() * Math.PI * 2, d = rand(7, 24) * TILE;
      const tx = tileOf(this.hq.x + Math.cos(a) * d), ty = tileOf(this.hq.y + Math.sin(a) * d);
      if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h || g.solid[ty * g.w + tx] || g.structGrid[ty * g.w + tx]) continue;
      this.shrines.push({ id: this.eid(), x: tileCenter(tx), y: tileCenter(ty), perk: PERK_IDS[randInt(0, PERK_IDS.length - 1)], progress: 0, expires: this.time + SHRINE_LIFETIME });
      this.toast('An ancient beacon has activated nearby!', 'good');
      return;
    }
  }

  // Ore in the surface queue is refined into usable resources by powered refineries (and slowly by the HQ).
  updateEconomy(dt) {
    if (this.tickCount % 15 === 0) {
      let cap = STORAGE_BASE + (this.storageBonus || 0);
      for (const s of this.structures.values()) if (s.kind === 'warehouse' && s.built) cap += storageOf(s.level);
      this.cap = cap;
      for (const k of RES_IDS) if (!UNCAPPED.has(k) && this.res[k] > cap) this.res[k] = cap; // loot past capacity is lost
    }
    let rate = this.hq.powered ? 1.5 : 0;
    for (const s of this.structures.values()) if (s.kind === 'refinery' && s.built && s.powered) rate += s.def.refineRate * (1 + 0.6 * (s.level - 1));
    this.refineRate = rate;
    this.refineAcc += rate * dt;
    while (this.refineAcc >= 1) {
      const ore = ORE_IDS.find((k) => this.ore[k] >= 1 && (this.res[k] || 0) < this.cap);
      if (!ore) { this.refineAcc = Math.min(this.refineAcc, 1); break; }
      this.ore[ore] -= 1;
      this.res[ore] = (this.res[ore] || 0) + 1;
      this.refineAcc -= 1;
    }
  }

  // ------------------------------------------------------------------ networking
  broadcast() {
    const now = this.time;
    const layerCache = new Map();
    const common = {
      t: Math.round(now * 1000), ph: this.phase, pt: Math.max(0, Math.ceil(this.phaseEnd - now)), w: this.wave,
      sun: Math.round(this.sun * 100) / 100, wx: this.weather, sc: this.scale, tf: Math.round(this.terraform * 100) / 100,
      hq: [Math.max(0, Math.round(this.hq.hp)), this.hq.max, this.hq.level, Math.round(this.hq.angle * 100), this.hq.powered ? 1 : 0],
      res: Object.fromEntries(RES_IDS.map((k) => [k, Math.floor(this.res[k] || 0)])),
      ore: Object.fromEntries(ORE_IDS.map((k) => [k, Math.floor(this.ore[k] || 0)])),
      rr: Math.round((this.refineRate || 0) * 10) / 10,
      mods: this.modules,
      tech: [...this.techs],
      sd: this.shaftDepth,
      rs: this.researching ? [this.researching.tech, Math.round(this.researching.got), this.researching.need] : 0,
      pwarn: this.powerWarn, low: this.lowRoles,
      dp: Math.round(dayPhase(this.clock()) * 1000) / 1000,
      dome: [Math.round(this.dome.radius), this.dome.target * TILE, Math.round(this.dome.shield), DOME[this.dome.level].shield, this.dome.up ? 1 : 0, this.dome.level,
        this.dome.up ? 0 : Math.max(0, Math.ceil(DOME_GRACE - (this.time - this.dome.downAt)))],
      cap: this.cap,
      left: this.spawnQueue.length + this.surfaceAttackers(),
      nets: this.power.networks.length,
      p: [...this.players.values()].map((p) => this.playerSnap(p, now)),
    };
    for (const p of this.players.values()) {
      if (!layerCache.has(p.layer)) layerCache.set(p.layer, this.layerSnap(p.layer, now));
      const ls = layerCache.get(p.layer);
      p.socket.emit('snap', {
        ...common, ...ls, L: p.layer,
        z: this.enemySnap(p, now),
        pw: this.power.summary(this.playerNetwork(p)),
        mm: this.tickCount % 30 === 0 ? this.minimapDots(p.layer) : undefined,
        fx: [...this.gfx, ...this.fx[p.layer]].slice(-300),
      });
    }
    this.gfx = [];
    for (const f of this.fx) f.length = 0;
  }

  // The network the player is "looking at": nearest electric building on their layer, else the HQ grid.
  playerNetwork(p) {
    let best = null, bd = 400 ** 2;
    for (const s of this.structures.values()) {
      if (s.layer !== p.layer) continue;
      const net = this.power.networkOf(s.id);
      if (!net) continue;
      const d = dist2(s, p);
      if (d < bd) { bd = d; best = net; }
    }
    return best || this.power.networkOf(0);
  }

  playerSnap(p, now) {
    const wid = this.currentWeapon(p);
    const st = p.ammo[wid];
    const buffs = {};
    for (const b in p.buffs) buffs[b] = Math.ceil(p.buffs[b] - now);
    return {
      id: p.id, n: p.name, lv: p.level, L: p.layer, x: r1(p.x), y: r1(p.y), a: Math.round(p.angle * 100) / 100,
      hp: Math.ceil(p.hp), mhp: p.maxHp, st: Math.round(p.stamina), mst: Math.round(p.maxStamina),
      l: p.lives, d: p.dead ? 1 : 0, s: p.spectator ? 1 : 0, ra: p.dead && !p.spectator ? Math.ceil(p.respawnAt - now) : 0,
      u: p.unlocked, c: p.current, w: wid, mag: st ? st.mag : -1, res: st ? st.reserve : -1,
      rl: p.reloadUntil ? Math.min(1, (now - p.reloadStart) / (p.reloadUntil - p.reloadStart)) : 0,
      cs: [p.consumables.grenade, p.consumables.molotov, p.consumables.medkit],
      tl: p.up.tool, up: p.up, pg: p.ping, gd: p.god ? 1 : 0, ad: p.isAdmin ? 1 : 0, pc: this.packCap(p), bm: Math.round(p.beam || 0),
      rd: p.ride ? [p.ride.phase, Math.round(Math.min(1, (this.time - p.ride.t0) / RIDE_TIME) * 100) / 100, p.ride.dir] : 0, b: buffs, spd: Math.round(p.moveSpeed || p.stats.speed), k: p.match.kills, r: p.ready ? 1 : 0,
      it: p.interacting, sp: now < p.spawnProtect ? 1 : 0, bc: p.stats.buildCost,
      el: p.elevated ? 1 : 0, sh: Math.ceil(p.shield), msh: PLAYER_SHIELD.levels[p.shieldLvl], shl: p.shieldLvl,
      o2: Math.ceil(p.o2), mo2: Math.round(this.o2Max(p)), io: p.inO2 ? 1 : 0, pk: p.pack, dg: p.digging,
    };
  }

  layerSnap(layer, now) {
    const g = this.L(layer);
    const structs = [], wires = [];
    for (const s of this.structures.values()) {
      if (s.layer !== layer) continue;
      structs.push(s.id, S_INDEX[s.kind], s.tx, s.ty, Math.ceil((s.hp / s.maxHp) * 100), s.level,
        (s.built ? 1 : 0) | (s.powered ? 2 : 0) | (s.litUntil > now ? 4 : 0) | (s.starved ? 8 : 0) | (now - s.hitAt < 0.15 ? 16 : 0)
          | (s.mount ? 32 : 0) | (s.flicker ? 64 : 0) | (s.shieldHp > 0 ? 128 : 0),
        Math.round(s.progress * 100), this.structExtra(s), s.rot || 0, s.modules ? s.modules.filter(Boolean).length : 0);
    }
    for (const w of this.power.wires) {
      const a = this.power.node(w.a), b = this.power.node(w.b);
      if (!a || !b || a.layer !== layer) continue;
      const net = this.power.networkOf(w.a);
      wires.push(w.a, w.b, net && (net.supply > 0 || net.stored > 0) ? (net.brownout || net.dark ? 2 : 1) : 0);
    }
    const pr = [];
    for (const p of this.projectiles) if (p.layer === layer) pr.push(p.id, PROJ_KINDS.indexOf(p.kind), Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy));
    const rb = [];
    for (const r of this.robots) if (r.layer === layer) rb.push(r.id, ROBOT_TYPE_IDS.indexOf(r.type), Math.round(r.x), Math.round(r.y), Math.round(r.angle * 100), Math.ceil((r.hp / r.maxHp) * 100), r.task);
    const pk = [];
    for (const p of this.pickups) if (p.layer === layer) pk.push(p.id, Math.round(p.x), Math.round(p.y), p.kind === 'ore' ? ORE_IDS.indexOf(Object.keys(p.bundle)[0]) + 1 : 0);
    const dg = [];
    for (const [i, d] of g.dig) dg.push(i, Math.round(d.p * 100));
    return {
      s: structs, wr: wires, pr, rb, pk, dg,
      poi: this.pois.filter((o) => o.layer === layer).map((o) => [o.id, POI_KINDS.indexOf(o.kind), o.x, o.y, o.looted ? 1 : 0]),
      sh: layer === 0 ? this.shrines.map((s) => [s.id, s.x, s.y, PERK_IDS.indexOf(s.perk), Math.round((s.progress / SHRINE_CAPTURE_TIME) * 100), Math.ceil(s.expires - now)]) : [],
      fz: this.fireZones.filter((f) => f.layer === layer).map((f) => [Math.round(f.x), Math.round(f.y), f.r]),
      lv: g.version,
    };
  }

  enemySnap(p, now) {
    const out = [];
    for (const e of this.enemies) {
      if (e.dead || e.layer !== p.layer) continue;
      if (!e.def.boss && (Math.abs(e.x - p.x) > VIEW_X || Math.abs(e.y - p.y) > VIEW_Y)) continue;
      const flags = (e.def.stealth && !this.isVisible(e) ? 1 : 0) | (e.burnUntil > now ? 2 : 0) | (e.slowUntil > now ? 4 : 0)
        | (e.def.boss ? 8 : 0) | (e.def.fly ? 16 : 0) | (e.dormant ? 32 : 0);
      out.push(e.id, E_INDEX[e.type], Math.round(e.x), Math.round(e.y), Math.round(e.angle * 100), Math.ceil((e.hp / e.maxHp) * 100), flags);
    }
    return out;
  }

  minimapDots(layer) {
    const out = [];
    for (const e of this.enemies) if (!e.dead && e.layer === layer && !(e.def.stealth && !this.isVisible(e))) out.push(e.x >> 5, e.y >> 5);
    return out;
  }

  info() {
    return {
      id: this.id, name: this.name, players: this.players.size, maxPlayers: MAX_PLAYERS, wave: this.wave, phase: this.phase,
      hqLevel: this.hq.level, terraform: Math.floor(this.terraform),
      names: [...this.players.values()].map((p) => p.name), createdAt: new Date(this.createdAt).toISOString(),
    };
  }

  destroy(reason) {
    clearInterval(this.timer);
    if (this.wave > 0 && this.phase !== 'gameover') this.endSession('abandoned');
    for (const p of [...this.players.values()]) {
      this.flushProgress(p, this.wave > 0 ? { gamesPlayed: 1, bestWave: this.wave } : {});
      p.socket.emit('kicked', { reason });
      p.socket.leave(this.channel);
    }
    this.players.clear();
  }
}

Object.assign(GameRoom.prototype, enemyMethods, structureMethods, robotMethods);
