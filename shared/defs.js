// Game definitions shared by the server simulation and the browser client.
// Every balance number lives here so both sides always agree.
//
// Setting: a dead, airless planet. A rogue AI machine civilisation attacks the colony base
// on the surface while the colonists mine ever deeper for the resources needed to
// terraform the planet.

export const TILE = 32;
export const MAP_W = 448; // surface tiles (about 2x the area of the 320x240 map)
export const MAP_H = 336;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;
export const UG_W = 272; // underground level tiles (about 2x the area of 192x144)
export const UG_H = 204;
// Machines march in from a ring around the colony rather than the far map edge (it is huge now).
export const SPAWN_RING = [62, 80];
export const DEPTHS = 4; // underground levels below the surface
export const layerSize = (layer) => (layer === 0 ? { w: MAP_W, h: MAP_H } : { w: UG_W, h: UG_H });
export const LAYER_NAMES = ['Surface', 'Depth 1', 'Depth 2', 'Depth 3', 'Depth 4'];

export const TICK_RATE = 30;
export const SNAPSHOT_EVERY = 2; // ticks per snapshot -> 15 Hz
export const INTERP_DELAY = 110; // ms the client renders remote entities in the past
export const MAX_PLAYERS = 5;
export const LIVES_PER_WAVE = 3;
export const RESPAWN_DELAY = 3;
export const FIRST_BUILD_PHASE = 75;
export const BUILD_PHASE = 45;
export const PLAYER_RADIUS = 13;
export const PLAYER_BASE_HP = 100;
export const PLAYER_BASE_SPEED = 175;
export const PLAYER_BASE_STAMINA = 100;
export const SPRINT_MULT = 1.55;
export const BUILD_RANGE = 300;
export const INTERACT_RANGE = 80;
export const HQ_SIZE = 3;
export const MAX_ACTIVE_ENEMIES = 650; // spawn queue throttles above this

// Dynamic difficulty: S = 1 + 0.25 * (players - 1)
export const difficultyScale = (players) => 1 + 0.25 * (Math.max(1, players) - 1);
export const isBossWave = (wave) => wave > 0 && wave % 5 === 0;
export const waveSpawnDuration = (wave) => Math.min(35 + 6 * (wave - 1), 130);
// 10x the original horde size; individual machines are weaker and turrets fire far faster.
export const waveEnemyCount = (wave, scale) => Math.round((8 + wave * 4 + Math.pow(wave, 1.35)) * 10 * scale);
export const waveHpMult = (wave, scale) => (1 + 0.1 * (wave - 1)) * scale;
export const waveDmgMult = (wave, scale) => (1 + 0.05 * (wave - 1)) * (1 + (scale - 1) * 0.5);

// ---------------------------------------------------------------- day / night (drives solar power)
export const DAY_LENGTH = 300; // seconds per full cycle
// The machines only attack at night: a wave starts at DUSK and any survivors retreat at DAWN.
export const DUSK = 0.54, DAWN = 0.96; // fractions of the cycle where the sun is down
export const NIGHT_LENGTH = (DAWN - DUSK) * DAY_LENGTH;
// About one night in five (from wave 2) is a swarm: twice the machines, arriving in big packs.
export const SWARM_CHANCE = 0.2, SWARM_MULT = 2, SWARM_PACK = [30, 45];
export const dayPhase = (t) => (((t / DAY_LENGTH) % 1) + 1) % 1;
export const isNightAt = (t) => { const f = dayPhase(t); return f >= DUSK && f < DAWN; };
// Sun position for a day phase: u runs 0 (sunrise, east) -> 1 (sunset, west); up = false at night.
export function sunPos(phase) {
  const u = ((phase - DAWN + 1) % 1) / (1 - (DAWN - DUSK));
  if (u < 0 || u > 1) return { up: false, u: 0, x: 1, elev: 0 };
  return { up: true, u, x: Math.cos(Math.PI * u), elev: Math.sin(Math.PI * u) };
}
export const secondsUntil = (t, target) => ((((target - dayPhase(t)) % 1) + 1) % 1) * DAY_LENGTH;
// Sun strength 0..1 for a run time in seconds. Roughly 60% day, 40% night.
export function sunAt(t) {
  const phase = dayPhase(t);
  return Math.max(0, Math.min(1, Math.sin(phase * Math.PI * 2) * 1.5 + 0.35));
}

// ---------------------------------------------------------------- resources
export const RESOURCES = {
  iron:     { name: 'Iron', color: '#a8a29e', icon: 'Fe' },
  copper:   { name: 'Copper', color: '#f59e0b', icon: 'Cu' },
  silicon:  { name: 'Silicon', color: '#60a5fa', icon: 'Si' },
  titanium: { name: 'Titanium', color: '#e2e8f0', icon: 'Ti' },
  crystal:  { name: 'Energy Crystal', color: '#c084fc', icon: 'Cr' },
  xenium:   { name: 'Xenium', color: '#34d399', icon: 'Xe' },
  data:     { name: 'Ancient Data', color: '#fde047', icon: 'DA' }, // only from ruins and monoliths
};
export const RES_IDS = Object.keys(RESOURCES);
export const ORE_IDS = ['iron', 'copper', 'silicon', 'titanium', 'crystal', 'xenium'];
export const START_RESOURCES = { iron: 1500, copper: 300, silicon: 120 }; // every run starts with 1,500 iron
export const BACKPACK_CAPACITY = 60; // ore a colonist can carry (before suit upgrades)

// Ore weights per depth; deeper levels hold richer ores.
export const DEPTH_ORES = [null,
  { iron: 6, copper: 4, silicon: 1 },
  { iron: 3, copper: 3, silicon: 3, titanium: 2 },
  { copper: 1, silicon: 2, titanium: 4, crystal: 2 },
  { titanium: 2, crystal: 4, xenium: 3 }];
export const ROCK_DIG_TIME = [0.7, 0.55, 0.85, 1.25, 1.8]; // seconds per rock tile with the base drill
export const HARD_ROCK_MULT = 2.2;
export const ORE_YIELD = [0, 9, 11, 13, 15];
export const DIG_REACH = 120;

// Tile codes. Surface terrain:
export const S_DUST = 0, S_RIDGE = 1, S_HQ = 2, S_CRATER = 3, S_ICE = 4, S_VENT = 5, S_RUIN = 6, S_DARK = 7;
// Underground:
export const U_FLOOR = 0, U_ROCK = 1, U_HARD = 2, U_BEDROCK = 3, U_RUIN_FLOOR = 4, U_RUIN_WALL = 5, U_ORE = 10; // ore = U_ORE + ORE_IDS index
export const isOreTile = (t) => t >= U_ORE && t < U_ORE + ORE_IDS.length;
export const oreOfTile = (t) => ORE_IDS[t - U_ORE];
export function isSolid(layer, t) {
  if (layer === 0) return t === S_RIDGE || t === S_HQ || t === S_RUIN;
  return t !== U_FLOOR && t !== U_RUIN_FLOOR;
}
export const isDiggable = (t) => t === U_ROCK || t === U_HARD || isOreTile(t);
// Layer-aware: on the surface only raised rock (ridges) can be mined, never map edges.
export function canDig(layer, g, i) {
  const x = i % g.w, y = (i / g.w) | 0;
  if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) return false;
  return layer === 0 ? g.terrain[i] === S_RIDGE : isDiggable(g.terrain[i]);
}
export const SURFACE_ROCK_YIELD = { iron: 6 }; // per ridge tile, into the backpack
// Plain rock underground is worth mining too, just less than an ore vein.
export const ROCK_YIELD = { [U_ROCK]: { iron: 2 }, [U_HARD]: { iron: 3, silicon: 1 } };

// The main lift shaft starts at Depth 1; paying for a deeper bore extends it one level at a time.
export const SHAFT_COST = [null, null,
  { iron: 400, copper: 150 },
  { iron: 700, copper: 250, titanium: 60 },
  { iron: 1000, titanium: 150, crystal: 60 }];

// Your personal mining laser (right mouse). Upgrade it at the HQ: faster digging, more ore per block.
export const MINING_TOOL = [
  { name: 'Mk1 Mining Laser', speed: 1, yield: 1 },
  { name: 'Mk2 Mining Laser', speed: 1.5, yield: 1.25, cost: { iron: 150, copper: 60 } },
  { name: 'Mk3 Plasma Cutter', speed: 2.2, yield: 1.5, cost: { iron: 300, copper: 120, silicon: 60 } },
  { name: 'Mk4 Plasma Cutter', speed: 3, yield: 1.8, cost: { iron: 400, titanium: 80, crystal: 20 } },
  { name: 'Mk5 Matter Disruptor', speed: 4, yield: 2.2, cost: { titanium: 150, crystal: 60, xenium: 20 } },
];

// Colony dome: the HQ projects a shield bubble holding a breathable atmosphere. On the surface you
// can only build inside it. The atmosphere creeps outward (growth tiles/s) while the dome is powered,
// up to the level's max radius; upgrade the dome at the HQ to push it further. The shield soaks
// attacks on anything inside. If it collapses (no power or broken), buildings inside start to
// decompress after DOME_GRACE seconds.
// Size is set with a slider (DOME_MIN..DOME_MAX tiles) and costs power with its area; upgrades make
// the emitter more efficient (eff = power per tile² / 50) and raise the shield's capacity and recharge.
export const DOME = [
  null,
  { name: 'Dome Mk1', eff: 1, shield: 1500, regen: 6 },
  { name: 'Dome Mk2', eff: 0.8, shield: 2600, regen: 14, cost: { iron: 400, copper: 150 } },
  { name: 'Dome Mk3', eff: 0.62, shield: 4000, regen: 24, cost: { iron: 700, copper: 250, silicon: 120 } },
  { name: 'Dome Mk4', eff: 0.48, shield: 6000, regen: 36, cost: { iron: 900, titanium: 150, silicon: 150 } },
  { name: 'Dome Mk5', eff: 0.35, shield: 9000, regen: 52, cost: { titanium: 300, crystal: 120, xenium: 30 } },
];
export const DOME_MIN = 4.5, DOME_MAX = 40; // tiles: the smallest bubble only covers the HQ
export const DOME_RESIZE = 0.6; // tiles per second the bubble grows or shrinks
export const domeDrawAt = (level, tiles) => 0.3 + (DOME[level].eff * tiles * tiles) / 50;
export const DOME_START_RADIUS = 8.5;
// ---------------------------------------------------------------- power roles
// Batteries are assigned to systems; consumers draw from the batteries of their system.
export const POWER_ROLES = ['shield', 'weapons', 'refine', 'research', 'general'];
export const ROLE_NAMES = { shield: 'Shield & life support', weapons: 'Weapons', refine: 'Refining', research: 'Research', general: 'General', reserve: 'Emergency reserve' };
export const DEFAULT_WARN = { shield: 30, weapons: 25, refine: 10, research: 10, general: 15 };
export const defaultRoles = () => ({ shield: true, weapons: true, refine: true, research: true, general: true, reserve: false });
export function roleOf(n) {
  if (n.id === 0) return 'shield'; // HQ: life support + dome
  const d = n.def;
  if (n.kind === 'shield_projector' || n.kind === 'wall_energy' || n.kind === 'o2_station') return 'shield';
  if (d.turret) return 'weapons';
  if (n.kind === 'refinery') return 'refine';
  if (n.kind === 'research_lab') return 'research';
  return 'general';
}
// Solar panels gather dust: output drops up to DIRT_LOSS when fully dirty. Clean them with E or a repair bot.
export const DIRT_LOSS = 0.75;
export const DIRT_RATE = { clear: 0.0022, dust: 0.009, storm: 0.016 }; // per second
// Shield emitters: size slider and power with area, like the dome.
export const EMITTER_MIN = 3, EMITTER_MAX = 12;
export const DOME_START_SHIELD = 0.05; // the colony lands with a nearly flat shield that slowly charges
export const DOME_GRACE = 30; // seconds a building survives outside the air before it starts to decompress
export const DOME_DECOMPRESS = 0.012; // fraction of max HP lost per second after that (about 80s more)
export const DOME_REBOOT = 0.1; // a broken dome comes back once it recharges to this fraction

// Personal suit upgrades, bought from the character menu (C) with colony resources. Level 0 = stock.
export const SUIT = {
  o2: { name: 'Oxygen tank', desc: 'More suit oxygen for long trips out of the dome and underground', levels: [
    { name: 'Standard tank', mult: 1 },
    { name: 'Extended tank', mult: 1.5, cost: { iron: 120, copper: 40 } },
    { name: 'Twin tanks', mult: 2, cost: { iron: 220, copper: 90, silicon: 40 } },
    { name: 'Recycler rig', mult: 3, cost: { titanium: 80, crystal: 20 } }] },
  pack: { name: 'Ore backpack', desc: 'Carry more ore before you have to unload', levels: [
    { name: 'Satchel', cap: 60 },
    { name: 'Cargo pack', cap: 100, cost: { iron: 100, copper: 40 } },
    { name: 'Hauler frame', cap: 150, cost: { iron: 200, copper: 80, silicon: 30 } },
    { name: 'Exo-carrier', cap: 220, cost: { titanium: 70, crystal: 15 } }] },
  armor: { name: 'Suit armour', desc: 'More health', levels: [
    { name: 'Work suit', hp: 1 },
    { name: 'Plated suit', hp: 1.25, cost: { iron: 150, copper: 50 } },
    { name: 'Combat suit', hp: 1.5, cost: { iron: 250, titanium: 40 } },
    { name: 'Hardsuit', hp: 1.85, cost: { titanium: 120, crystal: 30 } }] },
  boots: { name: 'Mag boots', desc: 'Faster movement', levels: [
    { name: 'Standard boots', speed: 1 },
    { name: 'Servo boots', speed: 1.08, cost: { iron: 120, copper: 60 } },
    { name: 'Sprint servos', speed: 1.16, cost: { iron: 200, silicon: 60 } },
    { name: 'Jet-assist boots', speed: 1.25, cost: { titanium: 80, crystal: 20 } }] },
};
export const SUIT_IDS = ['tool', 'o2', 'pack', 'armor', 'boots'];
// Info for one suit upgrade line at a given level (tool uses MINING_TOOL).
export function suitInfo(k, lvl) {
  if (k === 'tool') {
    const cur = MINING_TOOL[lvl], next = MINING_TOOL[lvl + 1];
    return { name: 'Mining laser', desc: 'Right mouse: cuts through rock in front of you (and hurts machines)', cur: cur.name, next: next?.name, cost: next?.cost,
      stat: `dig x${cur.speed} · yield x${cur.yield}`, nextStat: next && `dig x${next.speed} · yield x${next.yield}` };
  }
  const line = SUIT[k], cur = line.levels[lvl], next = line.levels[lvl + 1];
  const st = (l) => (k === 'o2' ? `${Math.round(O2.max * l.mult)}s of air` : k === 'pack' ? `carries ${l.cap}` : k === 'armor' ? `+${Math.round((l.hp - 1) * 100)}% health` : `+${Math.round((l.speed - 1) * 100)}% speed`);
  return { name: line.name, desc: line.desc, cur: cur.name, next: next?.name, cost: next?.cost, stat: st(cur), nextStat: next && st(next) };
}
export const RIDE_TIME = 1.1; // seconds the lift cage takes to leave / arrive

// Storage: the HQ holds STORAGE_BASE of each resource; every warehouse adds its capacity.
// Refining pauses for a resource once it is full (the ore waits in the queue).
export const STORAGE_BASE = 2000;
export const UNCAPPED = new Set(['data']);
export const storageOf = (level) => Math.round(STRUCTURES.warehouse.storage * (1 + 0.6 * (level - 1)));

// ---------------------------------------------------------------- cost helpers
export const canAfford = (res, cost) => Object.entries(cost).every(([k, v]) => (res[k] || 0) >= v);
export function payCost(res, cost) { for (const [k, v] of Object.entries(cost)) res[k] = (res[k] || 0) - v; }
export function addRes(res, bundle, mult = 1) { for (const [k, v] of Object.entries(bundle)) res[k] = (res[k] || 0) + Math.round(v * mult); }
export function scaleCost(cost, m) {
  const out = {};
  for (const [k, v] of Object.entries(cost)) out[k] = Math.max(1, Math.round(v * m));
  return out;
}
export const costText = (cost) => Object.entries(cost).map(([k, v]) => `${v} ${RESOURCES[k]?.icon || k}`).join(' ');

// ---------------------------------------------------------------- weapons (colonist arms)
// Ids are kept from the account unlock system; names fit the new setting.
export const WEAPONS = {
  bat:     { name: 'Arc Baton', kind: 'melee', damage: 34, range: 58, arc: 1.7, cooldown: 0.4, knockback: 220, unlockCost: 0, level: 1, color: '#7dd3fc' },
  katana:  { name: 'Plasma Blade', kind: 'melee', damage: 62, range: 70, arc: 2.0, cooldown: 0.3, knockback: 120, unlockCost: 600, level: 3, color: '#f0abfc' },
  chainsaw:{ name: 'Rip Saw', kind: 'melee', damage: 14, range: 56, arc: 1.1, cooldown: 0.06, knockback: 20, unlockCost: 1500, level: 6, color: '#fb923c' },
  pistol:  { name: 'Pulse Pistol', kind: 'ranged', damage: 22, cooldown: 0.2, mag: 14, reserve: 180, reload: 1.0, speed: 1000, spread: 0.035, pellets: 1, range: 650, unlockCost: 0, level: 1, color: '#e5e7eb', bolt: '#7dd3fc' },
  shotgun: { name: 'Scatter Blaster', kind: 'ranged', damage: 14, cooldown: 0.7, mag: 8, reserve: 64, reload: 1.9, speed: 860, spread: 0.34, pellets: 9, range: 400, unlockCost: 800, level: 2, color: '#fbbf24', bolt: '#fde68a' },
  rifle:   { name: 'Pulse Rifle', kind: 'ranged', damage: 19, cooldown: 0.08, mag: 40, reserve: 320, reload: 1.7, speed: 1200, spread: 0.06, pellets: 1, range: 760, unlockCost: 1200, level: 4, color: '#a3e635', bolt: '#bef264' },
  laser:   { name: 'Beam Rifle', kind: 'ranged', damage: 46, cooldown: 0.16, mag: 24, reserve: 160, reload: 1.9, speed: 1800, spread: 0.01, pellets: 1, pierce: 5, range: 920, unlockCost: 2500, level: 8, color: '#22d3ee', bolt: '#67e8f9' },
  rocket:  { name: 'Rocket Launcher', kind: 'ranged', damage: 130, splash: 120, cooldown: 1.0, mag: 2, reserve: 24, reload: 1.6, speed: 580, spread: 0.0, pellets: 1, range: 920, unlockCost: 3500, level: 10, color: '#f43f5e' },
};
export const WEAPON_ORDER = ['bat', 'katana', 'chainsaw', 'pistol', 'shotgun', 'rifle', 'laser', 'rocket'];
export const STARTING_WEAPONS = ['bat', 'pistol'];
export const WEAPON_PRICE = {
  katana: { iron: 120, copper: 40 }, chainsaw: { iron: 200, copper: 80 }, shotgun: { iron: 150, copper: 40 },
  rifle: { iron: 220, copper: 80, silicon: 20 }, laser: { iron: 260, silicon: 80, titanium: 30 }, rocket: { iron: 300, titanium: 60, crystal: 10 },
};
export const AMMO_PRICE = { iron: 25 };

export const CONSUMABLES = {
  grenade: { name: 'EMP Grenade', damage: 160, radius: 130, fuse: 1.2, price: { iron: 30, copper: 10 }, start: 3, max: 8, key: 'G' },
  molotov: { name: 'Thermite', dps: 50, radius: 100, duration: 6, price: { iron: 25, copper: 15 }, start: 2, max: 6, key: 'T' },
  medkit:  { name: 'Med Pack', heal: 60, price: { iron: 30, silicon: 10 }, start: 2, max: 5, key: 'H' },
};

// ---------------------------------------------------------------- oxygen (no atmosphere)
export const O2 = { max: 150, drain: 1, refill: 30, hqRange: 260, stationRange: 170, suffocateDps: 6 };

// ---------------------------------------------------------------- turret modules (ancient tech loot)
export const MODULES = {
  shield:     { name: 'Shield Unit', desc: 'Adds a 200-point regenerating shield', color: '#60a5fa' },
  rapid:      { name: 'Rapid Fire', desc: '+40% fire rate', color: '#f59e0b' },
  damage:     { name: 'Power Amplifier', desc: '+35% damage', color: '#ef4444' },
  range:      { name: 'Long-Range Optics', desc: '+20% range', color: '#a3e635' },
  efficiency: { name: 'Efficiency Core', desc: '-35% energy per shot', color: '#22d3ee' },
  overcharge: { name: 'Overcharger', desc: '20% chance for double damage', color: '#e879f9' },
};
export const MODULE_IDS = Object.keys(MODULES);
export const SLOTS = { S: 1, M: 2, L: 3 };

// ---------------------------------------------------------------- structures
// size: footprint in tiles (n x n). block: enemies must destroy it to pass. wall: walkable top
// (reach via stairs). draw: idle power use per second; prio: 0 life support, 1 defense,
// 2 support/lights, 3 industry & shops (shed first in a blackout). supply: peak power output.
// capacity/rate: battery storage. turret: weapon stats at level 1; tsize S/M/L sets module slots.
// tech: research needed. layer: 'surface' | 'underground' | 'any'. rot: can be rotated (R).
export const STRUCTURES = {
  wall_alloy:   { name: 'Alloy Wall', cat: 'Defense', cost: { iron: 12 }, hp: 320, buildTime: 1, block: true, wall: true, h: 30, color: '#64748b', key: '1', layer: 'any' },
  wall_titan:   { name: 'Titanium Wall', cat: 'Defense', cost: { iron: 10, titanium: 8 }, hp: 950, buildTime: 1.8, block: true, wall: true, h: 34, color: '#cbd5e1', key: '2', layer: 'any' },
  stairs:       { name: 'Stairwell', cat: 'Defense', cost: { iron: 15 }, hp: 300, buildTime: 1.2, block: true, stairs: true, rot: true, h: 26, color: '#78716c', key: '3', layer: 'any' },

  laser_s:   { name: 'Pulse Laser (S)', cat: 'Turrets', cost: { iron: 60, copper: 20 }, hp: 220, buildTime: 3, block: true, mountable: true, tsize: 'S', draw: 0.3, prio: 1, h: 18, color: '#ef4444', key: '4', layer: 'any',
    turret: { damage: 7, cooldown: 0.1, range: 250, shot: 0.3, beam: '#f87171' } },
  laser_m:   { name: 'Beam Laser (M)', cat: 'Turrets', cost: { iron: 120, copper: 50, silicon: 20 }, hp: 340, buildTime: 4, block: true, mountable: true, tsize: 'M', draw: 0.6, prio: 1, h: 22, color: '#f97316', key: '5', layer: 'any',
    turret: { damage: 20, cooldown: 0.2, range: 310, shot: 1, beam: '#fb923c' } },
  laser_l:   { name: 'Heavy Lance (L)', cat: 'Turrets', cost: { iron: 300, copper: 120, titanium: 40 }, hp: 900, buildTime: 7, block: true, size: 2, tsize: 'L', draw: 1.5, prio: 1, h: 34, color: '#dc2626', tech: 'laser_l', layer: 'any',
    turret: { damage: 70, cooldown: 0.55, range: 420, shot: 5, pierce: 6, beam: '#fca5a5' } },
  tesla_s:   { name: 'Arc Coil (S)', cat: 'Turrets', cost: { iron: 80, copper: 60 }, hp: 240, buildTime: 4, block: true, mountable: true, tsize: 'S', draw: 0.4, prio: 1, h: 36, color: '#38bdf8', key: '6', layer: 'any',
    turret: { damage: 14, cooldown: 0.55, range: 190, shot: 1.6, chains: 4, beam: '#bae6fd' } },
  tesla_l:   { name: 'Storm Spire (L)', cat: 'Turrets', cost: { iron: 220, copper: 200, titanium: 40 }, hp: 800, buildTime: 7, block: true, size: 2, tsize: 'L', draw: 1.2, prio: 1, h: 58, color: '#0ea5e9', tech: 'tesla_l', layer: 'any',
    turret: { damage: 30, cooldown: 0.8, range: 270, shot: 7, chains: 10, beam: '#e0f2fe' } },
  flak_s:    { name: 'Flak Gun (S, AA)', cat: 'Turrets', cost: { iron: 80, copper: 30 }, hp: 240, buildTime: 3, block: true, mountable: true, tsize: 'S', draw: 0.3, prio: 1, h: 22, color: '#94a3b8', key: '7', layer: 'surface',
    turret: { damage: 14, cooldown: 0.28, range: 380, shot: 0.8, splash: 50, antiAir: true } },
  missile_l: { name: 'Missile Array (L, AA)', cat: 'Turrets', cost: { iron: 240, silicon: 100, titanium: 50 }, hp: 760, buildTime: 7, block: true, size: 2, tsize: 'L', draw: 1, prio: 1, h: 30, color: '#e2e8f0', tech: 'missile_l', layer: 'surface',
    turret: { damage: 55, cooldown: 0.45, range: 540, shot: 4, splash: 70, salvo: 4, antiAir: true } },
  mortar_m:  { name: 'Plasma Mortar (M)', cat: 'Turrets', cost: { iron: 150, copper: 60, silicon: 40 }, hp: 360, buildTime: 5, block: true, mountable: true, tsize: 'M', draw: 0.6, prio: 1, h: 24, color: '#a855f7', tech: 'mortar_m', layer: 'surface',
    turret: { damage: 40, cooldown: 1.1, range: 470, minRange: 80, shot: 3.5, splash: 75, beam: '#d8b4fe' } },
  rail_l:    { name: 'Railgun (L)', cat: 'Turrets', cost: { iron: 250, titanium: 80, crystal: 20 }, hp: 820, buildTime: 8, block: true, size: 2, tsize: 'L', draw: 2, prio: 1, h: 30, color: '#22d3ee', tech: 'rail_l', layer: 'any',
    turret: { damage: 260, cooldown: 2, range: 720, shot: 18, pierce: 12, beam: '#a5f3fc' } },

  shock_plate:  { name: 'Shock Plate', cat: 'Traps', cost: { iron: 25, copper: 10 }, hp: 160, buildTime: 1.5, block: false, dps: 30, draw: 0.2, prio: 1, h: 0, color: '#facc15', key: '8', layer: 'any' },
  stasis_field: { name: 'Stasis Field', cat: 'Traps', cost: { iron: 40, silicon: 15 }, hp: 140, buildTime: 2, block: false, slow: 0.45, radius: 60, draw: 1, prio: 1, h: 0, color: '#a78bfa', key: '9', layer: 'any' },
  floodlight:   { name: 'Floodlight', cat: 'Support', cost: { iron: 30, copper: 10 }, hp: 200, buildTime: 2, block: true, mountable: true, light: 650, draw: 0.5, prio: 2, h: 34, color: '#fde68a', key: '0', layer: 'any' },
  o2_station:   { name: 'Oxygen Station', cat: 'Support', cost: { iron: 40, copper: 20 }, hp: 260, buildTime: 3, block: true, draw: 1, prio: 0, h: 30, color: '#67e8f9', layer: 'any' },
  repair_station: { name: 'Repair Station', cat: 'Support', cost: { iron: 120, copper: 60 }, hp: 420, buildTime: 4, block: true, size: 2, range: 190, heal: 22, playerHeal: 6, draw: 2, prio: 2, h: 30, color: '#4ade80', layer: 'any' },
  shield_projector: { name: 'Shield Emitter', cat: 'Support', cost: { iron: 150, copper: 60, silicon: 40 }, hp: 420, buildTime: 5, block: true, size: 2, radius: 180, shieldMax: 600, shieldRegen: 35, draw: 4, prio: 1, h: 38, color: '#60a5fa', layer: 'any' },
  wall_energy:  { name: 'Electrified Wall', cat: 'Defense', cost: { iron: 30, copper: 20, silicon: 10 }, hp: 600, buildTime: 2, block: true, wall: true, barrier: 900, barrierRegen: 45, heal: 18, draw: 0.6, prio: 1, h: 32, color: '#22d3ee', layer: 'any' },
  research_lab: { name: 'Research Lab', cat: 'Support', cost: { iron: 200, copper: 80, silicon: 40 }, hp: 500, buildTime: 6, block: true, size: 2, draw: 0.8, researchDraw: 8, prio: 3, h: 40, color: '#e879f9', layer: 'surface' },

  solar_panel:  { name: 'Solar Panel', cat: 'Power', cost: { iron: 50, copper: 20 }, hp: 260, buildTime: 2.5, block: true, size: 2, supply: 6, solar: true, h: 14, color: '#1d4ed8', key: '-', layer: 'surface' },
  solar_array:  { name: 'Solar Array', cat: 'Power', cost: { iron: 120, copper: 60, silicon: 60 }, hp: 480, buildTime: 5, block: true, size: 2, supply: 20, solar: true, h: 16, color: '#1e40af', tech: 'solar_array', layer: 'surface' },
  battery:      { name: 'Battery', cat: 'Power', cost: { iron: 40, copper: 30 }, hp: 260, buildTime: 2, block: true, capacity: 300, rate: 20, h: 22, color: '#22c55e', key: '=', layer: 'any' },
  battery_bank: { name: 'Battery Bank', cat: 'Power', cost: { iron: 120, copper: 80, titanium: 20 }, hp: 600, buildTime: 5, block: true, size: 2, capacity: 900, rate: 60, h: 28, color: '#16a34a', tech: 'battery_bank', layer: 'any' },
  pylon:        { name: 'Power Pylon', cat: 'Power', cost: { iron: 15, copper: 10 }, hp: 160, buildTime: 1, block: true, wireRange: 12, h: 44, color: '#fbbf24', layer: 'any' },
  geothermal:   { name: 'Geothermal Tap', cat: 'Power', cost: { iron: 200, titanium: 40 }, hp: 700, buildTime: 6, block: true, size: 2, supply: 30, geo: true, h: 30, color: '#f97316', tech: 'geothermal', layer: 'any' },
  fusion:       { name: 'Fusion Reactor', cat: 'Power', cost: { iron: 300, titanium: 120, crystal: 60 }, hp: 1400, buildTime: 10, block: true, size: 2, supply: 90, burns: { crystal: 0.03 }, h: 56, color: '#a855f7', tech: 'fusion', layer: 'surface' },

  refinery:     { name: 'Refinery', cat: 'Industry', cost: { iron: 150, copper: 50 }, hp: 600, buildTime: 5, block: true, size: 2, refineRate: 4, draw: 3, prio: 3, h: 40, color: '#ea580c', layer: 'surface' },
  elevator:     { name: 'Elevator Shaft', cat: 'Industry', cost: { iron: 250, copper: 80 }, hp: 900, buildTime: 6, block: true, size: 2, draw: 1, prio: 2, h: 46, color: '#facc15', layer: 'any', elevator: true },
  drill:        { name: 'Mining Drill', cat: 'Industry', cost: { iron: 80, copper: 30 }, hp: 300, buildTime: 3, block: true, draw: 1.5, prio: 3, mineTime: 3, h: 30, color: '#f59e0b', layer: 'underground' },
  borer:        { name: 'Tunnel Borer', cat: 'Industry', cost: { iron: 200, copper: 80, titanium: 20 }, hp: 500, buildTime: 4, block: true, rot: true, draw: 4, prio: 3, reach: 40, digTime: 0.6, h: 26, color: '#eab308', tech: 'tunnel_borer', layer: 'underground' },
  robot_factory:{ name: 'Robot Factory', cat: 'Industry', cost: { iron: 200, copper: 100, silicon: 30 }, hp: 600, buildTime: 6, block: true, size: 2, shop: true, draw: 2, prio: 3, h: 40, color: '#0ea5e9', layer: 'surface' },
  terraformer:  { name: 'Atmosphere Terraformer', cat: 'Industry', cost: { iron: 800, titanium: 300, crystal: 200, xenium: 100 }, hp: 3000, buildTime: 20, block: true, size: 2, draw: 20, prio: 2, rate: 0.05, burns: { xenium: 0.02 }, h: 80, color: '#34d399', tech: 'terraformer', layer: 'surface' },

  warehouse:    { name: 'Warehouse', cat: 'Industry', cost: { iron: 150, copper: 40 }, hp: 700, buildTime: 4, block: true, size: 2, storage: 1500, h: 34, color: '#a16207', layer: 'any',
    desc: 'Raises how much of every resource the colony can hold. Shows how full your stores are.' },
  tractor:      { name: 'Tractor Beam', cat: 'Industry', cost: { iron: 120, copper: 60 }, hp: 420, buildTime: 4, block: true, range: 560, pullSpeed: 300, draw: 0.8, prio: 2, h: 46, color: '#22d3ee', layer: 'surface' },
  armory:       { name: 'Armory', cat: 'Shops', cost: { iron: 150, copper: 40 }, hp: 520, buildTime: 5, block: true, size: 2, shop: true, draw: 1, prio: 3, h: 38, color: '#b45309', layer: 'surface' },
  med_bay:      { name: 'Med Bay', cat: 'Shops', cost: { iron: 120, copper: 40, silicon: 20 }, hp: 480, buildTime: 5, block: true, size: 2, shop: true, draw: 2, prio: 2, h: 34, color: '#e11d48', layer: 'any' },
};
export const STRUCTURE_ORDER = Object.keys(STRUCTURES);
export const STRUCTURE_CATS = ['Defense', 'Turrets', 'Traps', 'Support', 'Power', 'Industry', 'Shops'];
export const structSize = (kind) => STRUCTURES[kind].size || 1;
export function footprint(kind, tx, ty) {
  const n = structSize(kind), out = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push([tx + x, ty + y]);
  return out;
}
export const structCenter = (kind, tx, ty) => ({ x: (tx + structSize(kind) / 2) * TILE, y: (ty + structSize(kind) / 2) * TILE });
// Turrets idle on a trickle; their real cost is the energy each shot pulls from the grid.
export const TURRET_IDLE = { S: 0.05, M: 0.1, L: 0.2 };
export const idleDraw = (d) => (d.turret ? TURRET_IDLE[d.tsize] : d.draw || 0);
export const isElectric = (d) => !!(d.draw || d.supply || d.capacity || d.wireRange || d.turret || d.elevator);
export const WIRE_RANGE = 9; // tiles a normal building's wire can reach
export const wireRangeOf = (d) => (d.wireRange || WIRE_RANGE) * TILE;
export const MOUNT_RANGE_BONUS = 1.25;
export const HIGH_GROUND_DAMAGE = 1.2;
export const FALL_DAMAGE = 10;
export const SALVAGE_DEMOLISH = 0.5;
export const SALVAGE_DESTROYED = 0.25;
export const REPAIR_RATE = 55;
export const maxLevel = (kind) => (STRUCTURES[kind].turret ? 5 : 3);
export const structureMaxHp = (kind, level) => Math.round(STRUCTURES[kind].hp * Math.pow(1.4, level - 1));

// Upgrade cost from `level` to `level + 1`; higher tiers need rarer materials.
export function upgradeCost(kind, level) {
  const base = STRUCTURES[kind].cost;
  const out = scaleCost(base, 0.6 * level);
  const big = structSize(kind);
  if (level >= 1) out.copper = (out.copper || 0) + Math.round(8 * level * big);
  if (level >= 2) out.silicon = (out.silicon || 0) + Math.round(8 * level * big);
  if (level >= 3) out.titanium = (out.titanium || 0) + Math.round(10 * level * big);
  if (level >= 4) out.crystal = (out.crystal || 0) + Math.round(8 * level * big);
  return out;
}

// Effective turret stats for a level and set of installed modules.
export function turretStats(kind, level = 1, modules = []) {
  const t = STRUCTURES[kind].turret;
  if (!t) return null;
  const L = level - 1;
  const s = {
    damage: t.damage * Math.pow(1.28, L), cooldown: t.cooldown * Math.pow(0.92, L), range: t.range * (1 + 0.07 * L),
    shot: t.shot * Math.pow(1.12, L), splash: t.splash ? t.splash * (1 + 0.06 * L) : 0, chains: t.chains ? t.chains + L : 0,
    pierce: t.pierce ? t.pierce + L : 0, salvo: t.salvo || 1, crit: 0, shieldMax: 0, antiAir: !!t.antiAir, minRange: t.minRange || 0,
  };
  for (const m of modules) {
    if (m === 'rapid') s.cooldown *= 0.714;
    else if (m === 'damage') s.damage *= 1.35;
    else if (m === 'range') s.range *= 1.2;
    else if (m === 'efficiency') s.shot *= 0.65;
    else if (m === 'overcharge') s.crit += 0.2;
    else if (m === 'shield') s.shieldMax += 200;
  }
  return s;
}
export const supplyAt = (kind, level) => (STRUCTURES[kind].supply || 0) * (1 + 0.5 * (level - 1));
export const capacityAt = (kind, level) => (STRUCTURES[kind].capacity || 0) * (1 + 0.6 * (level - 1));

// ---------------------------------------------------------------- research
// Research also takes energy: a powered lab pours researchDraw into the project until it is done.
export const researchEnergy = (id) => Math.round(150 + Object.values(TECH[id].cost).reduce((a, b) => a + b, 0) * 2.5);
export const TECH = {
  drill_mk2:    { name: 'Drill Mk II', desc: 'Dig 60% faster', cost: { iron: 200, titanium: 40 } },
  solar_array:  { name: 'Solar Arrays', desc: 'Unlocks the 2x2 Solar Array (20 power)', cost: { copper: 60, silicon: 80 } },
  battery_bank: { name: 'Battery Banks', desc: 'Unlocks 900-capacity Battery Banks', cost: { copper: 100, titanium: 30 } },
  mortar_m:     { name: 'Plasma Mortar', desc: 'Unlocks the medium artillery turret', cost: { iron: 150, silicon: 60 } },
  laser_l:      { name: 'Heavy Lance', desc: 'Unlocks the large piercing laser', cost: { copper: 80, titanium: 60 } },
  tesla_l:      { name: 'Storm Spire', desc: 'Unlocks the large chain-lightning tower', cost: { copper: 150, titanium: 40 } },
  missile_l:    { name: 'Missile Array', desc: 'Unlocks the large anti-air battery', cost: { silicon: 100, titanium: 50 } },
  suit_o2:      { name: 'Suit Rebreather', desc: 'Doubles suit oxygen', cost: { copper: 40, silicon: 50 } },
  digger_bots:  { name: 'Digger Robots', desc: 'Robots that dig ore on their own', cost: { copper: 80, silicon: 60, data: 1 } },
  tunnel_borer: { name: 'Tunnel Borer', desc: 'Digging machine that bores long tunnels', cost: { titanium: 80, data: 1 } },
  geothermal:   { name: 'Geothermal Taps', desc: 'Steady 30 power on vents or below Depth 2', cost: { titanium: 60, data: 1 } },
  drill_mk3:    { name: 'Drill Mk III', desc: 'Dig 2.5x faster than the base drill', cost: { crystal: 40, data: 1 } },
  rail_l:       { name: 'Railgun', desc: 'Unlocks the long-range railgun', cost: { titanium: 120, crystal: 40, data: 2 } },
  fusion:       { name: 'Fusion Power', desc: 'Unlocks the 90-power Fusion Reactor', cost: { titanium: 120, crystal: 100, data: 3 } },
  terraformer:  { name: 'Terraforming', desc: 'Unlocks the Atmosphere Terraformer - the way to win', cost: { crystal: 80, xenium: 60, data: 4 } },
};
export const TECH_IDS = Object.keys(TECH);
export const digSpeedMult = (techs) => (techs.has('drill_mk3') ? 2.5 : techs.has('drill_mk2') ? 1.6 : 1);

// ---------------------------------------------------------------- robots (built at the Robot Factory)
export const ROBOTS = {
  salvage_bot:  { name: 'Salvage Bot', cost: { iron: 80, copper: 30 }, hp: 90, speed: 170, layer: 'surface', color: '#fbbf24', desc: 'Collects salvage from destroyed attackers' },
  hauler_bot:   { name: 'Hauler Bot', cost: { iron: 90, copper: 40 }, hp: 110, speed: 150, layer: 'underground', carry: 40, color: '#f59e0b', desc: 'Carries ore from drills and borers to the elevator' },
  digger_bot:   { name: 'Digger Bot', cost: { iron: 120, copper: 60, silicon: 30 }, hp: 140, speed: 120, layer: 'underground', carry: 30, color: '#eab308', tech: 'digger_bots', desc: 'Digs ore by itself and brings it to the elevator' },
  repair_bot:   { name: 'Repair Bot', cost: { iron: 100, copper: 50 }, hp: 120, speed: 140, layer: 'surface', repair: 30, color: '#4ade80', desc: 'Repairs damaged structures' },
  combat_drone: { name: 'Combat Drone', cost: { iron: 150, copper: 60, silicon: 30 }, hp: 160, speed: 180, layer: 'surface', damage: 11, cooldown: 0.22, range: 280, color: '#f87171', desc: 'Follows its owner and shoots attackers' },
};
export const ROBOT_TYPE_IDS = Object.keys(ROBOTS);
export const MAX_ROBOTS = 30;

// ---------------------------------------------------------------- enemies: rogue AI machines
// salvage: resources dropped on destruction. native: lives in caves/ruins underground.
export const ENEMIES = {
  crawler:    { name: 'Crawler', hp: 14, speed: 62, damage: 3, attackRate: 0.8, radius: 8, xp: 2, points: 1, salvage: { iron: 2 }, aggro: 230, color: '#64748b', eye: '#ef4444' },
  skitter:    { name: 'Skitter', hp: 9, speed: 135, damage: 2, attackRate: 0.6, radius: 7, xp: 2, points: 1, salvage: { iron: 1, copper: 1 }, aggro: 330, color: '#94a3b8', eye: '#f97316' },
  juggernaut: { name: 'Juggernaut', hp: 140, speed: 34, damage: 12, attackRate: 1.3, radius: 16, armor: 0.4, structMult: 3, xp: 10, points: 4, salvage: { iron: 8, titanium: 1 }, aggro: 220, color: '#475569', eye: '#ef4444' },
  gunner:     { name: 'Gunner', hp: 22, speed: 50, damage: 2, attackRate: 1, radius: 9, xp: 4, points: 2, salvage: { iron: 2, silicon: 1 }, aggro: 340, color: '#7c3aed', eye: '#e879f9',
                ranged: { damage: 4, range: 280, cooldown: 2, speed: 340 } },
  phantom:    { name: 'Phantom', hp: 26, speed: 90, damage: 6, attackRate: 0.8, radius: 9, stealth: true, xp: 5, points: 2, salvage: { silicon: 2 }, aggro: 420, color: '#1e293b', eye: '#22d3ee' },
  wasp:       { name: 'Wasp Drone', hp: 12, speed: 115, damage: 3, attackRate: 0.9, radius: 8, fly: true, xp: 3, points: 1, salvage: { copper: 1, silicon: 1 }, aggro: 420, color: '#b91c1c', eye: '#fde047' },
  sentinel:   { name: 'Cave Sentinel', hp: 70, speed: 72, damage: 7, attackRate: 0.8, radius: 11, native: true, xp: 12, points: 4, salvage: { titanium: 2, silicon: 2 }, aggro: 320, color: '#57534e', eye: '#22c55e',
                ranged: { damage: 6, range: 260, cooldown: 1.8, speed: 320 } },
  construct:  { name: 'Ancient Construct', hp: 280, speed: 52, damage: 16, attackRate: 1.1, radius: 15, armor: 0.3, native: true, xp: 40, points: 15, salvage: { crystal: 3, titanium: 4 }, aggro: 300, color: '#854d0e', eye: '#fde047' },
  boss_warden:   { name: 'The Warden', boss: true, hp: 3600, speed: 40, damage: 40, attackRate: 1.2, radius: 34, armor: 0.25, structMult: 4, xp: 500, points: 250, salvage: { iron: 120, titanium: 30, crystal: 10 }, aggro: 500, abilities: ['stomp'], color: '#7f1d1d', eye: '#fde047' },
  boss_hive:     { name: 'Hive Mind', boss: true, hp: 3200, speed: 36, damage: 30, attackRate: 1, radius: 30, armor: 0.15, structMult: 3, xp: 650, points: 320, salvage: { silicon: 80, titanium: 40, crystal: 15 }, aggro: 520, abilities: ['summon', 'spit'], color: '#581c87', eye: '#f0abfc' },
  boss_colossus: { name: 'Colossus', boss: true, hp: 5200, speed: 38, damage: 50, attackRate: 1.1, radius: 38, armor: 0.3, structMult: 4, xp: 900, points: 450, salvage: { titanium: 80, crystal: 30, xenium: 10 }, aggro: 560, abilities: ['stomp', 'spit', 'summon'], color: '#14532d', eye: '#4ade80' },
};
export const BOSS_ROTATION = ['boss_warden', 'boss_hive', 'boss_colossus'];
export const ENEMY_TYPE_IDS = Object.keys(ENEMIES);

export function waveComposition(wave) {
  const w = { crawler: 10 };
  if (wave >= 2) w.skitter = 2 + wave * 0.6;
  if (wave >= 3) w.gunner = 1 + wave * 0.3;
  if (wave >= 4) { w.juggernaut = 0.4 + wave * 0.12; w.wasp = 1 + wave * 0.35; }
  if (wave >= 6) w.phantom = 1 + wave * 0.25;
  return w;
}

// ---------------------------------------------------------------- perk shrines -> ancient beacons
export const PERKS = {
  double_damage: { name: 'Double Damage', duration: 15, color: '#ef4444' },
  infinite_ammo: { name: 'Infinite Ammo', duration: 15, color: '#f59e0b' },
  speed_boost:   { name: 'Speed Boost', duration: 15, color: '#22d3ee' },
  regeneration:  { name: 'Regeneration', duration: 15, color: '#22c55e' },
};
export const SHRINE_CAPTURE_TIME = 2.5;
export const SHRINE_LIFETIME = 30;
export const SHRINE_INTERVAL = 25;

// ---------------------------------------------------------------- shops
export const SHOP_RANGE = 130;
export const PLAYER_SHIELD = { levels: [0, 40, 80, 130], cost: [null, { iron: 80, silicon: 20 }, { iron: 120, silicon: 50 }, { titanium: 40, crystal: 15 }], regen: 15, delay: 3 };
export const MED_BAY_HEAL = { hps: 14, hpPerIron: 4 };
export const SHOPS = {
  hq: { name: 'HQ Command', items: ['dome', 'tool', 'ammo', 'medkit', 'grenade'] }, // dome = efficiency/capacity upgrade
  armory: { name: 'Armory', items: ['w:katana', 'w:chainsaw', 'w:shotgun', 'w:rifle', 'w:laser', 'w:rocket', 'ammo', 'grenade', 'molotov'] },
  med_bay: { name: 'Med Bay', items: ['medkit', 'full_heal', 'shield'] },
  robot_factory: { name: 'Robot Factory', items: ROBOT_TYPE_IDS.map((r) => `bot:${r}`) },
};

export function shopItemInfo(id, { shieldLvl = 0, techs = new Set(), toolLvl = 0, domeLvl = 1 } = {}) {
  if (id.startsWith('w:')) { const w = id.slice(2); return { name: WEAPONS[w].name, price: WEAPON_PRICE[w], desc: 'Carry it for the rest of this run' }; }
  if (id.startsWith('bot:')) {
    const r = ROBOTS[id.slice(4)];
    if (r.tech && !techs.has(r.tech)) return { name: r.name, price: null, desc: `Research ${TECH[r.tech].name} first` };
    return { name: r.name, price: r.cost, desc: r.desc };
  }
  switch (id) {
    case 'dome': {
      const next = DOME[domeLvl + 1], cur = DOME[domeLvl];
      if (!next) return { name: `${cur.name} (max)`, price: null, desc: 'The colony dome is fully upgraded' };
      return { name: `Upgrade to ${next.name}`, price: next.cost, desc: `Shield ${cur.shield} → ${next.shield} · recharge ${cur.regen} → ${next.regen}/s · ${Math.round((1 - next.eff / cur.eff) * 100)}% less power per tile` };
    }
    case 'tool': {
      const next = MINING_TOOL[toolLvl + 1];
      if (!next) return { name: `${MINING_TOOL[toolLvl].name} (max)`, price: null, desc: 'Your mining laser is fully upgraded' };
      const cur = MINING_TOOL[toolLvl];
      return { name: `Upgrade to ${next.name}`, price: next.cost, desc: `Dig speed x${cur.speed} → x${next.speed} · yield x${cur.yield} → x${next.yield}` };
    }
    case 'ammo': return { name: 'Power cells (held weapon)', price: AMMO_PRICE, desc: 'Refill reserve ammo' };
    case 'medkit': case 'grenade': case 'molotov': {
      const c = CONSUMABLES[id];
      return { name: c.name, price: c.price, desc: `Press ${c.key}` };
    }
    case 'full_heal': return { name: 'Field Surgery', price: { iron: 30 }, desc: 'Instantly restore full HP' };
    case 'shield': return shieldLvl >= PLAYER_SHIELD.levels.length - 1 ? { name: 'Personal shield maxed', price: null, desc: '' } :
      { name: `Suit Shield Mk${shieldLvl + 1}`, price: PLAYER_SHIELD.cost[shieldLvl + 1], desc: `${PLAYER_SHIELD.levels[shieldLvl + 1]}-point shield that regenerates` };
  }
  return { name: id, price: null, desc: '' };
}

// ---------------------------------------------------------------- RPG progression (persistent account)
export const STATS = {
  vitality:    { name: 'Vitality', desc: '+10% max HP per rank' },
  agility:     { name: 'Agility', desc: '+4% move speed, +10% stamina per rank' },
  power:       { name: 'Power', desc: '+6% weapon damage, +1.5% crit chance per rank' },
  handling:    { name: 'Handling', desc: '+7% reload speed, +8% ammo capacity per rank' },
  engineering: { name: 'Engineering', desc: '+12% build & dig speed, -4% build cost per rank' },
};
export const STAT_MAX_RANK = 10;
export const BASE_CRIT = 0.05;
export const CRIT_MULT = 2;

export function derivedStats(stats = {}) {
  const r = (k) => Math.min(STAT_MAX_RANK, stats[k] || 0);
  return {
    maxHp: Math.round(PLAYER_BASE_HP * (1 + 0.10 * r('vitality'))),
    speed: PLAYER_BASE_SPEED * (1 + 0.04 * r('agility')),
    stamina: PLAYER_BASE_STAMINA * (1 + 0.10 * r('agility')),
    damage: 1 + 0.06 * r('power'),
    crit: BASE_CRIT + 0.015 * r('power'),
    reload: 1 + 0.07 * r('handling'),
    ammo: 1 + 0.08 * r('handling'),
    buildSpeed: 1 + 0.12 * r('engineering'),
    buildCost: 1 - 0.04 * r('engineering'),
  };
}

export const xpForLevel = (level) => Math.round(120 * Math.pow(level, 1.6));
export const SKILL_POINTS_PER_LEVEL = 1;
export function applyXp(level, xp, gained) {
  let lv = level, cur = xp + gained, levelsGained = 0;
  while (cur >= xpForLevel(lv)) { cur -= xpForLevel(lv); lv++; levelsGained++; }
  return { level: lv, xp: cur, levelsGained };
}
export const XP_PER_WAVE = (wave) => 40 + wave * 15;
export const POINTS_PER_WAVE = (wave) => 20 + wave * 10;

export const WEATHERS = ['clear', 'dust', 'storm'];
export function rollWeather(wave, r = Math.random()) {
  if (wave >= 3 && r < 0.12) return 'storm'; // radiation/dust storm: damages unshielded structures
  if (r < 0.32) return 'dust';
  return 'clear';
}
export const STORM = { dps: 4, hqDps: 3, gustEvery: 3, gustDamage: 35, gustTargets: 5 };

export const VIEW_TILT = 0.72; // vertical squash for the 3/4 camera
