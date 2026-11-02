// Headless simulation tests: drive a GameRoom directly without sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.JSON_DB_FILE = path.join(os.tmpdir(), `ot-sim-${process.pid}.json`);
const { initDb } = await import('../server/db/index.js');
await initDb();
const { GameRoom } = await import('../server/game/GameRoom.js');
const { POWER_TICK, HQ_NODE } = await import('../server/game/power.js');
const defs = await import('../shared/defs.js');
const { TILE } = defs;

const fakeIo = { to: () => ({ emit() {} }) };
const fakeSocket = (id) => {
  const sent = [];
  return { id, sent, emit: (ev, data) => sent.push([ev, data]), join() {}, leave() {} };
};
const user = (id) => ({ id, name: id, level: 5, stats: { power: 3 }, unlockedWeapons: ['bat', 'pistol', 'rifle', 'rocket'] });

function makeRoom() {
  const room = new GameRoom(fakeIo, 'test', 'Test');
  clearInterval(room.timer);
  return room;
}
function setup() {
  const room = makeRoom();
  const sock = fakeSocket(`s${Math.random()}`);
  const { player: p } = room.addPlayer(sock, user(`u${Math.random()}`));
  room.res = { iron: 1e5, copper: 1e5, silicon: 1e5, titanium: 1e5, crystal: 1e5, xenium: 1e5, data: 100 };
  room.storageBonus = 1e6; room.cap = 1e6;
  room.domeRepel = () => false; // most tests put machines right next to the HQ
  room.dome.radius = 70 * TILE; room.dome.target = 70; // most tests build away from the HQ
  room.domeDraw = () => 1.5; // ...without paying for a 70-tile bubble
  return { room, p, sock };
}
const finishBuilds = (room) => { for (const s of room.structures.values()) if (!s.built) { s.built = true; s.progress = 1; s.hp = s.maxHp; } room.L(0).flowDirty = true; };
const kinds = (room, k) => [...room.structures.values()].filter((s) => s.kind === k);
const spot = (room, dx, dy) => ({ tx: Math.floor(room.hq.x / TILE) + dx, ty: Math.floor(room.hq.y / TILE) + dy });
function buildAt(room, p, kind, tx, ty, rot = 0) {
  p.x = tx * TILE + 16; p.y = ty * TILE + 16 + 120;
  const g = room.L(p.layer);
  for (const [x, y] of defs.footprint(kind, tx, ty)) { const i = y * g.w + x; if (g.solid[i] && g.terrain[i] !== 2) { g.terrain[i] = 0; g.solid[i] = 0; } }
  room.handleAction(p, { type: 'build', kind, tx, ty, rot });
  return [...room.structures.values()].reverse().find((s) => s.kind === kind && s.tx === tx && s.ty === ty && s.layer === p.layer);
}
// lift rides take a moment: cage leaves, then arrives
const finishRide = (room, p) => { for (let k = 0; k < 2 && p.ride; k++) { room.time += defs.RIDE_TIME + 0.01; room.updateRide(p); } };
const solve = (room, n = 1) => { for (let i = 0; i < n; i++) room.power.solve(POWER_TICK); };

test('waves are 10x larger and difficulty still scales with players', () => {
  assert.equal(defs.difficultyScale(4), 1.75);
  assert.ok(defs.waveEnemyCount(1, 1) >= 120);
  assert.ok(defs.waveEnemyCount(3, 1.5) > defs.waveEnemyCount(3, 1));
});

test('a run starts with 1500 iron, four solar panels and three batteries wired to the HQ', () => {
  const room = makeRoom();
  room.addPlayer(fakeSocket('a'), user('ua'));
  assert.equal(room.res.iron, 1500);
  assert.equal(kinds(room, 'solar_panel').length, 4);
  assert.equal(kinds(room, 'battery').length, 3);
  for (const s of room.structures.values()) if (s.layer === 0) assert.ok(room.inDome(s.x, s.y), `${s.kind} inside the Mk1 dome`);
  assert.ok(room.dome.shield < defs.DOME[1].shield * 0.1, 'shield starts nearly flat');
  assert.equal(kinds(room, 'generator').length, 0);
  const lifts = kinds(room, 'elevator');
  assert.equal(lifts.length, 2, 'surface elevator + Depth 1 arrival');
  assert.equal(lifts[0].down, lifts[1].id);
  const net = room.power.networkOf(HQ_NODE);
  assert.ok(net.members.length >= 6, 'everything shares one wired network');
  assert.ok(room.pois.filter((o) => o.layer === 0).length >= 10, 'surface has things to explore');
});

test('power: solar follows the sun, batteries cover the night, overloads black out low priority first', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 6, 4);
  const refinery = buildAt(room, p, 'refinery', tx, ty);
  const o2 = buildAt(room, p, 'o2_station', tx + 3, ty);
  finishBuilds(room);
  room.power.connect(refinery.id, HQ_NODE);
  room.power.connect(o2.id, HQ_NODE);
  room.sun = 1; solve(room, 2);
  assert.equal(room.power.networkOf(HQ_NODE).supply, 24);
  assert.ok(refinery.powered && o2.powered, 'daytime: everything runs');
  room.sun = 0;
  const bats = kinds(room, 'battery');
  for (const b of bats) b.charge = 150;
  solve(room, 4);
  assert.ok(bats[0].charge < 150, 'night: battery drains');
  assert.ok(room.hq.powered && o2.powered, 'life support stays on');
  for (const b of bats) b.charge = 0; room.power.hqCharge = 0;
  solve(room, 2);
  assert.equal(refinery.powered, false, 'industry goes dark first in a blackout');
  assert.equal(room.power.networkOf(HQ_NODE).supply, 0);
});

test('wires: buildings only get power when connected', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 8, 6);
  const lamp = buildAt(room, p, 'floodlight', tx, ty);
  finishBuilds(room);
  room.sun = 1; solve(room);
  assert.ok(lamp.powered, 'auto-wired on build');
  room.power.disconnectAll(lamp.id);
  solve(room);
  assert.equal(lamp.powered, false, 'unwired = dark');
  assert.ok(room.power.canWire(lamp, { ...room.hqNode(), x: lamp.x + 5000 }), 'too-long wires are rejected');
  assert.equal(room.power.connect(lamp.id, HQ_NODE), null);
  solve(room);
  assert.ok(lamp.powered);
});

test('turrets spend energy per shot and cannot fire without it', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 7, 5);
  const t = buildAt(room, p, 'laser_m', tx, ty);
  finishBuilds(room);
  room.sun = 1; solve(room);
  const e = room.spawnEnemy('crawler', 0, { x: t.x + 120, y: t.y });
  e.hp = e.maxHp = 1e6;
  room.updateEnemies(0);
  for (let i = 0; i < 30; i++) room.updateStructures(1 / 30);
  assert.ok(e.hp < 1e6, 'powered turret fires');
  room.sun = 0; for (const b of kinds(room, 'battery')) b.charge = 0; room.power.hqCharge = 0;
  solve(room, 2);
  const hp = e.hp;
  for (let i = 0; i < 30; i++) room.updateStructures(1 / 30);
  assert.equal(e.hp, hp, 'no energy, no shots');
});

test('turret upgrades raise stats, count kills, and accept modules found as loot', () => {
  const { room, p, sock } = setup();
  const { tx, ty } = spot(room, 7, 5);
  const t = buildAt(room, p, 'laser_s', tx, ty);
  finishBuilds(room);
  const before = defs.turretStats('laser_s', 1);
  room.handleAction(p, { type: 'upgrade', id: t.id });
  assert.equal(t.level, 2);
  const after = defs.turretStats('laser_s', 2);
  assert.ok(after.damage > before.damage && after.cooldown < before.cooldown && after.range > before.range);
  const detail = sock.sent.filter(([ev]) => ev === 'inspect').pop()[1];
  assert.ok(detail.next.damage > detail.stats.damage, 'panel shows the next level');
  room.sun = 1; solve(room);
  room.spawnEnemy('crawler', 0, { x: t.x + 80, y: t.y });
  room.updateEnemies(0);
  for (let i = 0; i < 60; i++) { room.updateStructures(1 / 30); room.updateEnemies(1 / 30); }
  assert.ok(t.kills >= 1, 'kill counter');
  assert.equal(t.modules.length, 1, 'small turrets have one module slot');
  room.handleAction(p, { type: 'module', id: t.id, slot: 0, module: 'rapid' });
  assert.equal(t.modules[0], null, 'cannot install a module you do not own');
  room.modules.rapid = 1;
  room.handleAction(p, { type: 'module', id: t.id, slot: 0, module: 'rapid' });
  assert.equal(t.modules[0], 'rapid');
  assert.equal(room.modules.rapid, 0);
  assert.ok(defs.turretStats('laser_s', 2, ['rapid']).cooldown < after.cooldown);
});

test('anti-air guns only shoot flyers; lasers ignore them', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 7, 5);
  const laser = buildAt(room, p, 'laser_s', tx, ty);
  const flak = buildAt(room, p, 'flak_s', tx + 2, ty);
  finishBuilds(room); room.sun = 1; solve(room);
  const wasp = room.spawnEnemy('wasp', 0, { x: flak.x + 150, y: flak.y });
  room.updateEnemies(0);
  assert.equal(room.nearestEnemy(0, laser, 300, { air: false }), null);
  const hp = wasp.hp;
  for (let i = 0; i < 30; i++) room.updateStructures(1 / 30);
  assert.ok(wasp.dead || wasp.hp < hp);
});

test('mining: dig rock underground, carry ore, deposit at the elevator, refine on the surface', () => {
  const { room, p } = setup();
  const lift = kinds(room, 'elevator')[0];
  p.x = lift.x; p.y = lift.y + 60;
  room.sun = 1; solve(room);
  room.handleAction(p, { type: 'elevator', dir: 1 });
  finishRide(room, p);
  assert.equal(p.layer, 1, 'rode the elevator down');
  const g = room.L(1);
  p.x += 300; // step away from the elevator so the pack is not auto-delivered
  const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
  for (let x = ptx - 1; x <= ptx + 1; x++) { g.terrain[pty * g.w + x] = 0; g.solid[pty * g.w + x] = 0; }
  const i = pty * g.w + ptx + 2;
  g.terrain[i] = defs.U_ORE; g.solid[i] = 1; // iron ore
  p.input = { ...p.input, d: true, tx: (ptx + 2) * TILE + 16, ty: pty * TILE + 16 };
  for (let k = 0; k < 30 * 3 && g.terrain[i] !== 0; k++) room.updatePlayers(1 / 30);
  assert.equal(g.terrain[i], 0, 'tile dug out');
  assert.ok((p.pack.iron || 0) > 0, 'ore in the backpack');
  p.input.d = false;
  const arrival = kinds(room, 'elevator').find((s) => s.layer === 1);
  p.x = arrival.x; p.y = arrival.y + 50;
  room.updatePlayers(1 / 30);
  assert.equal(room.packTotal(p), 0);
  assert.ok(room.ore.iron > 0, 'ore sent up the shaft');
  const iron = room.res.iron, queued = room.ore.iron;
  for (let k = 0; k < 30 * 5; k++) room.updateEconomy(1 / 30);
  assert.ok(room.res.iron > iron && room.ore.iron < queued, 'HQ refines ore into iron');
});

test('paying to bore the shaft deeper opens the next depth, and any lift rides to any reached level', () => {
  const { room, p } = setup();
  const top = kinds(room, 'elevator').find((s) => s.layer === 0);
  p.x = top.x; p.y = top.y + 60;
  room.handleAction(p, { type: 'elevator', to: 2 });
  assert.equal(p.layer, 0, 'Depth 2 is not reachable yet');
  const iron = room.res.iron;
  room.handleAction(p, { type: 'deepen' });
  assert.equal(room.shaftDepth, 2);
  assert.ok(room.res.iron < iron, 'paid for the bore');
  const stop = kinds(room, 'elevator').find((s) => s.layer === 2);
  assert.ok(stop && stop.main, 'lift stop on Depth 2');
  room.handleAction(p, { type: 'elevator', to: 2 });
  finishRide(room, p);
  assert.equal(p.layer, 2, 'rode straight from the surface to Depth 2');
});

test('surface ridges and plain rock can be mined; the mining tool upgrades speed and yield', () => {
  const { room, p } = setup();
  const g = room.L(0);
  const i = g.terrain.findIndex((t, k) => t === defs.S_RIDGE && defs.canDig(0, g, k) && !g.solid[k + g.w] && !g.solid[k + 2 * g.w] && !g.structGrid[k + g.w]);
  p.x = (i % g.w) * TILE + 16; p.y = ((i / g.w) | 0) * TILE + 16 + 60;
  p.angle = -Math.PI / 2; // aim straight at the ridge just north of us
  for (let k = 0; k < 60 && g.terrain[i] === defs.S_RIDGE; k++) room.digTick(p, 1 / 30);
  assert.equal(g.terrain[i], defs.S_DUST, 'ridge dug away');
  assert.ok(p.pack.iron >= defs.SURFACE_ROCK_YIELD.iron, 'rock went into the backpack');
  p.pack = {};
  p.x = room.hq.x; p.y = room.hq.y + 90;
  room.handleAction(p, { type: 'shop', shop: 'hq', item: 'tool' });
  assert.equal(p.up.tool, 1, 'bought the Mk2 laser');
  room.giveOre(p, 0, p.x, p.y, { iron: 8 });
  assert.equal(p.pack.iron, Math.round(8 * defs.MINING_TOOL[1].yield));
});

test('colony dome: build only inside, it soaks attacks, and buildings decompress after it fails', () => {
  const room = makeRoom();
  const { player: p } = room.addPlayer(fakeSocket('d'), user('ud'));
  room.res.iron = 1000; room.res.copper = 1000;
  const far = spot(room, 25, 0);
  assert.equal(buildAt(room, p, 'wall_alloy', far.tx, far.ty), undefined, 'cannot build in the vacuum');
  const near = spot(room, 0, 5);
  const wall = buildAt(room, p, 'wall_alloy', near.tx, near.ty);
  assert.ok(wall, 'can build inside the dome');
  finishBuilds(room);
  room.dome.shield = defs.DOME[1].shield;
  const hp = wall.hp, shield = room.dome.shield;
  room.damageStructure(wall, 100);
  assert.equal(wall.hp, hp, 'dome absorbed the hit');
  assert.ok(room.dome.shield < shield);
  room.dome.shield = 1; room.damageStructure(wall, 100);
  assert.equal(room.dome.up, false, 'dome collapsed');
  room.hq.powered = false;
  room.updateDome(0.1); // exposure starts
  const before = wall.hp;
  room.updateDome(0.1);
  assert.equal(wall.hp, before, 'survives a grace period in vacuum');
  room.time += defs.DOME_GRACE + 1;
  room.updateDome(1);
  assert.ok(wall.hp < before, 'decompressing');
});

test('ruins and probes give loot: data, modules and resources', () => {
  const { room, p } = setup();
  const poi = room.pois.find((o) => o.layer === 0 && o.kind === 'monolith');
  const data = room.res.data;
  p.x = poi.x; p.y = poi.y + 30;
  room.handleAction(p, { type: 'use' });
  assert.ok(poi.looted);
  assert.equal(room.res.data, data + 1);
  assert.ok(Object.values(room.modules).reduce((a, b) => a + b, 0) >= 1);
});

test('cave natives sleep until a colonist comes close', () => {
  const { room, p } = setup();
  const native = room.enemies.find((e) => e.native && e.layer === 2);
  assert.ok(native.dormant);
  p.layer = 2; p.x = native.x + 60; p.y = native.y;
  const g = room.L(2);
  for (let x = native.x; x <= p.x; x += 8) { const i = Math.floor(native.y / TILE) * g.w + Math.floor(x / TILE); g.terrain[i] = 0; g.solid[i] = 0; }
  room.updateEnemies(1 / 30);
  assert.equal(native.dormant, false);
});

test('machines cannot see colonists through rock', () => {
  const { room, p } = setup();
  const g = room.L(1);
  p.layer = 1; p.x = 40 * TILE + 16; p.y = 40 * TILE + 16;
  for (let x = 36; x <= 44; x++) { const i = 40 * g.w + x; g.terrain[i] = 0; g.solid[i] = 0; }
  assert.ok(room.lineOfSight(1, 36 * TILE, p.y, p.x, p.y), 'open tunnel: visible');
  g.terrain[40 * g.w + 38] = defs.U_ROCK; g.solid[40 * g.w + 38] = 1;
  assert.ok(!room.lineOfSight(1, 36 * TILE, p.y, p.x, p.y), 'a rock in between hides you');
});

test('bosses smash through the walls in their way', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 10, 0);
  const walls = [0, 1, 2].map((k) => buildAt(room, p, 'wall_alloy', tx, ty + k));
  finishBuilds(room);
  const boss = room.spawnEnemy('boss_warden', 0, { x: (tx + 0.5) * TILE + 40, y: (ty + 1.5) * TILE });
  boss.attackCd = 0;
  room.bossSmash(boss, room.L(0));
  assert.ok(walls.filter((w) => w.hp < w.maxHp).length >= 2, 'several walls hit at once');
});

test('research needs a powered lab, then energy over time, and unlocks tech buildings', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 7, 5);
  room.handleAction(p, { type: 'research', tech: 'laser_l' });
  assert.ok(!room.techs.has('laser_l'));
  const lab = buildAt(room, p, 'research_lab', tx, ty);
  finishBuilds(room); room.sun = 1; solve(room);
  assert.ok(lab.powered);
  room.handleAction(p, { type: 'research', tech: 'laser_l' });
  assert.ok(!room.techs.has('laser_l'), 'not instant');
  assert.equal(room.researching.tech, 'laser_l');
  solve(room);
  assert.ok(room.power.drawOf(lab) >= defs.STRUCTURES.research_lab.researchDraw, 'the lab draws hard while researching');
  for (let k = 0; k < 400 && room.researching; k++) { solve(room); room.updateResearch(1); }
  assert.ok(room.techs.has('laser_l'), 'done once the energy is in');
  assert.ok(buildAt(room, p, 'laser_l', tx + 3, ty), 'Heavy Lance can now be built');
});

test('robots: salvage bot collects wreckage, digger mines ore', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 7, 5);
  buildAt(room, p, 'robot_factory', tx, ty);
  finishBuilds(room); room.sun = 1; solve(room);
  room.techs.add('digger_bots');
  assert.equal(room.buyRobot(p, 'salvage_bot'), true);
  room.pickups.push({ id: 999, layer: 0, kind: 'salvage', x: room.hq.x + 300, y: room.hq.y, bundle: { titanium: 7 }, expires: 1e9 });
  const ti = room.res.titanium;
  for (let i = 0; i < 30 * 6; i++) room.updateRobots(1 / 30);
  assert.equal(room.res.titanium, ti + 7);
  assert.equal(room.buyRobot(p, 'digger_bot'), true);
  const dig = room.robots.find((r) => r.type === 'digger_bot');
  const g = room.L(1);
  const x = Math.floor(dig.x / TILE), y = Math.floor(dig.y / TILE);
  g.terrain[y * g.w + x + 1] = defs.U_ORE + 1; g.solid[y * g.w + x + 1] = 1; // copper
  for (let i = 0; i < 30 * 8; i++) room.updateRobots(1 / 30);
  assert.ok((dig.cargo.copper || 0) > 0 || room.ore.copper > 0, 'digger mined copper');
});

test('terraformers advance the terraforming goal and win the game', () => {
  const { room, p } = setup();
  room.techs.add('terraformer');
  const { tx, ty } = spot(room, 7, 6);
  const tf = buildAt(room, p, 'terraformer', tx, ty);
  finishBuilds(room);
  tf.powered = true;
  for (let i = 0; i < 30 * 10; i++) room.updateStructures(1 / 30);
  assert.ok(room.terraform > 0.4);
  room.terraform = 100;
  room.tick();
  assert.equal(room.phase, 'victory');
});

test('oxygen drains in the vacuum and refills inside the colony dome atmosphere', () => {
  const { room, p } = setup();
  p.x = room.hq.x + 3000; p.y = room.hq.y;
  const o2 = p.o2;
  room.updateOxygen(p, 5);
  assert.ok(p.o2 < o2);
  p.x = room.hq.x + 100;
  room.hq.powered = true;
  room.updateOxygen(p, 2);
  assert.ok(p.o2 > o2 - 5);
  p.o2 = 0; p.x = room.hq.x + 3000;
  const hp = p.hp;
  room.updateOxygen(p, 1);
  assert.ok(p.hp < hp, 'suffocating');
});

test('stairs let players onto walls; turrets mount on walls; rotation is kept', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 6, 8);
  const stairs = buildAt(room, p, 'stairs', tx, ty, 3);
  assert.equal(stairs.rot, 3);
  for (let x = tx + 1; x <= tx + 3; x++) buildAt(room, p, 'wall_alloy', x, ty);
  finishBuilds(room);
  p.x = tx * TILE + 16; p.y = ty * TILE + 16;
  for (let i = 0; i < 25; i++) { room.setInput(p, { mx: 1, my: 0 }); room.updatePlayers(1 / 30); }
  assert.equal(p.elevated, true);
  const wall = kinds(room, 'wall_alloy')[1];
  const t = buildAt(room, p, 'laser_s', wall.tx, wall.ty);
  assert.ok(t && t.mount === wall.id, 'turret mounted on the wall');
});

test('a wave with defenses runs fast enough with hundreds of attackers', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 6, 4);
  for (let k = 0; k < 4; k++) buildAt(room, p, 'laser_m', tx + k, ty);
  room.techs.add('solar_array');
  buildAt(room, p, 'solar_array', tx, ty + 2);
  buildAt(room, p, 'solar_array', tx + 2, ty + 2);
  room.techs.add('battery_bank'); // waves come at night, so the turrets run on stored energy
  buildAt(room, p, 'battery_bank', tx + 4, ty + 2);
  buildAt(room, p, 'battery_bank', tx + 6, ty + 2);
  finishBuilds(room);
  for (const b of kinds(room, 'battery_bank')) b.charge = 900;
  room.skipToNight(0);
  const t0 = Date.now();
  let maxEnemies = 0;
  for (let i = 0; i < 30 * 60; i++) { room.tick(); maxEnemies = Math.max(maxEnemies, room.enemies.length); }
  const ms = Date.now() - t0;
  assert.ok(maxEnemies > 100, `swarm size ${maxEnemies}`);
  assert.ok(ms < 20000, `60s of game took ${ms}ms`);
  assert.ok(kinds(room, 'laser_m').reduce((n, s) => n + s.kills, 0) > 20, 'turrets are killing attackers');
});

test('developer tools: god mode, resources, game speed and jumping to a wave', () => {
  const { room, p } = setup();
  room.devAction(p, { cmd: 'god' });
  room.damagePlayer(p, 999);
  assert.equal(p.hp, p.maxHp, 'god mode ignores damage');
  room.devAction(p, { cmd: 'res' });
  assert.equal(room.res.titanium, 999999);
  room.devAction(p, { cmd: 'speed', v: 4 });
  assert.equal(room.speed, 4);
  room.devAction(p, { cmd: 'wave', v: 12 });
  for (let k = 0; k < 120 && room.wave < 12; k++) room.tick();
  assert.equal(room.wave, 12, 'night falls and wave 12 starts');
});

test('battery roles: all-purpose batteries drain first, then dedicated ones, reserve last', () => {
  const { room } = setup();
  const [a, b, c] = kinds(room, 'battery');
  for (const x of [a, b, c]) x.charge = 200;
  b.roles = { shield: false, weapons: true, refine: false, research: false, general: false, reserve: false };
  c.roles = { shield: true, weapons: true, refine: true, research: true, general: true, reserve: true };
  room.sun = 0; solve(room);
  const net = room.power.networkOf(HQ_NODE);
  assert.ok(a.charge < 200, 'all-purpose battery covers the night first');
  assert.equal(b.charge, 200, 'weapons-only battery untouched by the colony draw');
  assert.equal(c.charge, 200, 'reserve untouched while others have charge');
  const taken = room.power.drain(net.batteries, 'weapons', 300, true);
  assert.equal(Math.round(taken), 300);
  assert.ok(b.charge < 200, 'weapons fire reached its own battery after the shared one');
  a.charge = 0; b.charge = 0; solve(room);
  assert.ok(c.charge < 200 || room.power.hqCharge < 120, 'reserve kicks in when everything else is empty');
});

test('dome size slider costs power with area and the bubble shrinks without power', () => {
  const room = makeRoom();
  const { player: p } = room.addPlayer(fakeSocket('ds'), user('uds'));
  const small = room.domeDraw();
  room.handleAction(p, { type: 'dome-size', v: 20 });
  assert.equal(room.dome.target, 20);
  room.dome.radius = 20 * TILE;
  assert.ok(room.domeDraw() > small * 4, 'a bigger bubble draws much more');
  room.dome.level = 3;
  const eff = room.domeDraw();
  assert.ok(eff < defs.domeDrawAt(1, 20), 'upgrades cut the power per tile');
  room.hq.powered = false;
  for (let k = 0; k < 60; k++) room.updateDome(0.5);
  assert.ok(room.dome.radius <= defs.DOME_MIN * TILE + 1, 'shrank to cover just the HQ');
});

test('electrified walls soak damage with a powered field and heal; dirty solar panels lose output', () => {
  const { room, p } = setup();
  const { tx, ty } = spot(room, 6, 0);
  const w = buildAt(room, p, 'wall_energy', tx, ty);
  finishBuilds(room); room.sun = 1; solve(room);
  room.updateStructures(5);
  assert.ok(w.shieldHp > 0, 'field charged');
  const hp = w.hp;
  room.damageStructure(w, 100, true);
  assert.equal(w.hp, hp, 'field took the hit');
  const panel = kinds(room, 'solar_panel')[0];
  solve(room); const clean = panel.output;
  panel.dirt = 1; solve(room);
  assert.ok(panel.output < clean * 0.5, 'dust cuts output');
  p.x = panel.x; p.y = panel.y + 40;
  room.handleAction(p, { type: 'clean' });
  assert.equal(panel.dirt, 0, 'wiped clean');
});
