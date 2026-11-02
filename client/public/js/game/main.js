// Game client entry: networking, input, main loop and effect dispatch.
import { World } from './state.js';
import { Renderer } from './renderer.js';
import { Hud } from './hud.js';
import { sfx, unlockAudio, toggleMute, setListener, setAmbience, setMusic, getSettings, setSetting } from './audio.js';
import {
  TILE, STRUCTURES, STRUCTURE_ORDER, BUILD_RANGE, ENEMY_TYPE_IDS, ENEMIES, SHOP_RANGE, RESOURCES, LAYER_NAMES, ORE_IDS,
  footprint, structCenter, scaleCost, canAfford, isDiggable, DIG_REACH, canDig,
} from '/shared/defs.js';
import { structHeight, mountLift } from './art/structures.js';

const $ = (id) => document.getElementById(id);
const world = new World();
const canvas = $('game');
let renderer = null, hud = null;
let roomId = new URLSearchParams(location.search).get('room') || 'quick';
let fatal = false;

// ------------------------------------------------------------------ networking
const socket = io({ transports: ['websocket'], reconnectionDelayMax: 4000 });

function status(text, { back = false, pulse = true } = {}) {
  $('status').classList.toggle('hidden', !text);
  $('status').classList.toggle('flex', !!text);
  $('status-text').textContent = text || '';
  $('status-text').classList.toggle('animate-pulse', pulse);
  $('status-back').classList.toggle('hidden', !back);
}

socket.on('connect', () => {
  status('Landing at the colony...');
  socket.emit('join', { roomId }, (res) => {
    if (res?.error) { fatal = true; status(res.error, { back: true, pulse: false }); socket.disconnect(); return; }
    roomId = res.roomId;
    history.replaceState(null, '', `/game.html?room=${encodeURIComponent(roomId)}`);
  });
});
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') { fatal = true; status('Please sign in first.', { back: true, pulse: false }); socket.disconnect(); }
  else if (err.message === 'not_approved') { fatal = true; status('Your account is awaiting admin approval.', { back: true, pulse: false }); socket.disconnect(); }
  else status('Connection lost - retrying...');
});
socket.on('disconnect', (reason) => {
  if (fatal) return;
  status(reason === 'io server disconnect' ? 'Disconnected by server.' : 'Reconnecting...', { back: reason === 'io server disconnect', pulse: reason !== 'io server disconnect' });
});
socket.on('kicked', ({ reason }) => { fatal = true; status(reason || 'Removed from room', { back: true, pulse: false }); });

// round-trip latency probe every 2s (shown in the crew panel)
let ping = 0;
setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(4000).emit('lat', t0, (err) => {
    if (err) return;
    ping = Math.round(performance.now() - t0);
    world.ping = ping;
    socket.emit('ping-report', ping);
  });
}, 2000);

function devCmd(cmd, v) { socket.emit('dev', { cmd, v }); sfx('click'); }

socket.on('init', (data) => {
  world.isAdmin = !!data.admin;
  $('dev-btn').classList.toggle('hidden', !data.admin);
  world.init(data);
  if (!renderer) {
    renderer = new Renderer(canvas, world);
    renderer.onThunder = () => sfx('thunder', null, { verb: 2 });
    hud = new Hud(world);
    bindUi();
    requestAnimationFrame(loop);
  }
  renderer.camInit = false;
  inspectId = null; hud.setDetail(null);
  $('gameover').classList.add('hidden'); $('gameover').classList.remove('flex');
  $('hud').classList.remove('hidden');
  status('');
});

socket.on('layer', ({ layer, terrain }) => {
  world.setLayerTerrain(layer, terrain);
  hud.openLift(false);
  renderer.camInit = false;
  inspectId = null; hud.setDetail(null); wireFrom = null;
  hud.banner(LAYER_NAMES[layer].toUpperCase(), layer ? 'Hold right mouse to dig · bring ore to the elevator' : 'Back on the surface', layer ? '#fdba74' : '#7dd3fc');
  sfx('elevator');
});

let lastNetStatus = 0, lastO2Alarm = 0;
socket.on('snap', (s) => {
  if (!world.layers) return;
  const prevRl = world.me?.rl;
  world.applySnapshot(s);
  handleFx(s.fx);
  const me = world.me;
  if (me && !prevRl && me.rl) sfx('reload');
  const st = s.pw[9];
  if (st === 3 && lastNetStatus !== 3) { sfx('powerdown'); hud.feed('BLACKOUT - this power grid has no energy left!', 'bad'); }
  else if (lastNetStatus === 3 && st < 3) sfx('powerup');
  lastNetStatus = st;
  if (me && !me.d && me.o2 < me.mo2 * 0.25 && !me.io && performance.now() - lastO2Alarm > 2000) { lastO2Alarm = performance.now(); sfx('o2alarm'); }
  const boss = [...world.enemies.values()].some((z) => z.flags & 8);
  setMusic(world.layer > 0 ? 'under' : s.ph === 'wave' ? (boss ? 'boss' : 'battle') : 'build', Math.min(1, world.enemies.size / 150));
  setAmbience({ wind: s.wx, underground: world.layer > 0, combat: s.ph === 'wave' });
});

socket.on('inspect', (d) => { if (d.id === inspectId) hud.setDetail(d); });
socket.on('toast', (t) => {
  hud?.feed(t.text, t.kind);
  if (t.kind === 'level') { sfx('level'); hud?.banner('LEVEL UP!', t.text.replace(/^LEVEL UP! /, ''), '#7dd3fc'); }
  else if (t.kind === 'bad') sfx('deny', null, { gap: 150 });
  else if (t.kind === 'good') sfx('pickup', null, { gap: 150 });
});
socket.on('bought', (b) => { sfx('cash'); hud?.feed(`Bought ${b.name}`, 'good'); });
socket.on('progress', (p) => { if (p.xp || p.points) hud?.feed(`+${Math.round(p.xp)} XP  +${Math.round(p.points)} points saved`, 'level'); });
socket.on('chat', (m) => { hud?.chat(m.name, m.text); sfx('click'); });
const showEnd = (title, text, g) => {
  $('go-title').textContent = title;
  $('go-text').textContent = text;
  $('go-rows').innerHTML = g.players.map((p) => `<tr class="border-t border-zinc-800"><td class="py-1 text-left">${escapeHtml(p.name)}</td><td>${p.kills}</td><td>${p.damage}</td><td>${p.built}</td><td>${p.mined || 0}</td></tr>`).join('');
  $('gameover').classList.remove('hidden'); $('gameover').classList.add('flex');
};
socket.on('gameover', (g) => { showEnd('THE COLONY HAS FALLEN', `You held out until wave ${g.wave} with the planet ${g.terraform}% terraformed.`, g); sfx('boss'); });
socket.on('victory', (g) => { showEnd('PLANET TERRAFORMED!', `The atmosphere is breathable. Victory on wave ${g.wave}!`, g); $('go-title').className = 'font-display text-4xl text-emerald-400'; sfx('level'); hud.banner('VICTORY', 'The planet can breathe again', '#34d399'); });

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const act = (a) => socket.emit('act', a);

// ------------------------------------------------------------------ input state
const keys = new Set();
const mouse = { x: 0, y: 0, down: false, rdown: false, wx: 0, wy: 0 };
let buildOpen = false, buildKind = null, buildRot = 0, lastPlacedTile = null;
let wireMode = false, wireFrom = null;
let inspectId = null, inspectTimer = 0;
let researchOpen = false, escOpen = false, chatOpen = false, spectateIdx = 0;
const input = { mx: 0, my: 0, a: 0, f: false, sp: false, i: false, d: false, tx: 0, ty: 0 };
let lastSent = '', lastSentAt = 0;

const STRUCT_KEYS = Object.fromEntries(STRUCTURE_ORDER.filter((k) => STRUCTURES[k].key).map((k) => [STRUCTURES[k].key, k]));
function keyChar(e) {
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (e.code === 'Minus') return '-';
  if (e.code === 'Equal') return '=';
  return null;
}

function setBuild(open, kind = buildKind) {
  buildOpen = open;
  buildKind = open ? kind : null;
  $('build-menu').classList.toggle('hidden', !open);
  if (open) { hud?.openShop(null); setWire(false); }
  hud?.setBuildSelection(buildKind, world.me);
}
function setWire(on) {
  wireMode = on; wireFrom = null;
  if (on) { buildOpen = false; buildKind = null; $('build-menu').classList.add('hidden'); }
}
function openInspect(id) {
  inspectId = id; hud.setDetail(null);
  if (id != null) { act({ type: 'inspect', id }); sfx('click'); }
}
function toggleResearch(force) { researchOpen = force ?? !researchOpen; if (researchOpen) sfx('click'); }
function toggleEsc(force) {
  escOpen = force ?? !escOpen;
  $('esc-menu').classList.toggle('hidden', !escOpen);
  $('esc-menu').classList.toggle('flex', escOpen);
}

function nearbyShop() {
  const me = world.me;
  if (!me || me.d) return null;
  if (world.layer === 0 && Math.hypot(me.rx - world.hq.x, me.ry - world.hq.y) < SHOP_RANGE + 40) return 'hq';
  let best = null, bd = SHOP_RANGE + 20;
  for (const s of world.structures.values()) {
    if (!s.def.shop || !s.built || !s.powered) continue;
    const d = Math.hypot(s.x - me.rx, s.y - me.ry);
    if (d < bd) { bd = d; best = s.kind; }
  }
  return best;
}

function bindUi() {
  $('build-list').addEventListener('click', (e) => {
    const k = e.target.closest('[data-build]')?.dataset.build;
    if (k) { setBuild(true, buildKind === k ? null : k); sfx('click'); }
  });
  $('shop-items').addEventListener('click', (e) => {
    const item = e.target.closest('[data-shop-item]')?.dataset.shopItem;
    if (item && hud.shop) act({ type: 'shop', shop: hud.shop, item });
  });
  $('shop-close').addEventListener('click', () => hud.openShop(null));
  $('lift-close').addEventListener('click', () => hud.openLift(false));
  $('dev-btn').addEventListener('click', () => $('dev').classList.toggle('hidden'));
  $('dev-close').addEventListener('click', () => $('dev').classList.add('hidden'));
  $('dev').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dev]');
    if (!b) return;
    const cmd = b.dataset.dev;
    devCmd(cmd, cmd === 'wave' ? Number($('dev-wave').value) : cmd === 'speed' ? Number(b.dataset.v) : undefined);
  });
  $('char-close').addEventListener('click', () => hud.toggleCharacter(false));
  $('char-upgrades').addEventListener('click', (e) => { const k = e.target.closest('[data-suit]')?.dataset.suit; if (k) act({ type: 'suit', k }); });
  $('lift-levels').addEventListener('click', (e) => {
    const go = e.target.closest('[data-lift]');
    if (go) { act({ type: 'elevator', to: Number(go.dataset.lift) }); hud.openLift(false); return; }
    if (e.target.closest('[data-deepen]')) { act({ type: 'deepen' }); sfx('click'); }
  });
  // build menu tooltips: what it does + its stats
  $('build-list').addEventListener('mousemove', (e) => {
    const k = e.target.closest('[data-build]')?.dataset.build;
    hud.showBuildTip(k || null, e.clientX, e.clientY);
  });
  $('build-list').addEventListener('mouseleave', () => hud.showBuildTip(null));
  $('ready-btn').addEventListener('click', () => act({ type: 'ready' }));
  $('in-close').addEventListener('click', () => openInspect(null));
  $('in-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-in]');
    if (!b || inspectId == null) return;
    const a = b.dataset.in;
    if (a === 'upgrade') { act({ type: 'upgrade', id: inspectId }); }
    else if (a === 'demolish') { act({ type: 'demolish', id: inspectId }); openInspect(null); }
    else if (a === 'wire') { setWire(true); wireFrom = inspectId; }
    else if (a === 'unwire') { act({ type: 'unwire', id: inspectId }); sfx('wire'); }
    else if (a === 'unmod') act({ type: 'module', id: inspectId, slot: Number(b.dataset.slot), module: null });
  });
  $('in-body').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-in="mod"]');
    if (sel && sel.value) act({ type: 'module', id: inspectId, slot: Number(sel.dataset.slot), module: sel.value });
  });
  $('research-list').addEventListener('click', (e) => { const t = e.target.closest('[data-research]')?.dataset.research; if (t) act({ type: 'research', tech: t }); });
  $('research-close').addEventListener('click', () => toggleResearch(false));
  $('esc-resume').addEventListener('click', () => toggleEsc(false));
  // sound settings
  const s = getSettings();
  $('sound-settings').innerHTML = [['master', 'Master volume'], ['music', 'Battle music'], ['sfx', 'Sound effects'], ['ambience', 'Ambience']].map(([k, label]) =>
    `<label class="block"><span class="flex justify-between"><span>${label}</span><span data-vol-label="${k}">${Math.round(s[k] * 100)}%</span></span><input data-vol="${k}" type="range" min="0" max="100" value="${Math.round(s[k] * 100)}" class="w-full" /></label>`).join('');
  $('sound-settings').addEventListener('input', (e) => {
    const k = e.target.dataset.vol;
    if (!k) return;
    setSetting(k, Number(e.target.value) / 100);
    document.querySelector(`[data-vol-label="${k}"]`).textContent = `${e.target.value}%`;
  });
  $('set-mute').checked = s.muted;
  $('set-mute').addEventListener('change', (e) => setSetting('muted', e.target.checked));
}

function openChat(open) {
  chatOpen = open;
  const el = $('chat-input');
  el.classList.toggle('hidden', !open);
  if (open) { keys.clear(); el.value = ''; el.focus(); } else el.blur();
}
$('chat-input').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) socket.emit('chat', t); openChat(false); }
  else if (e.key === 'Escape') openChat(false);
});

function nearestElevator() {
  const me = world.me;
  if (!me) return null;
  let best = null, bd = 120;
  for (const s of world.structures.values()) {
    if (s.kind !== 'elevator') continue;
    const d = Math.hypot(s.x - me.rx, s.y - me.ry);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function nearbyPoi() {
  const me = world.me;
  return me && world.pois.find((p) => !p.looted && Math.hypot(p.x - me.rx, p.y - me.ry) < 90);
}

window.addEventListener('keydown', (e) => {
  if (chatOpen || !world.layers) return;
  unlockAudio();
  if (e.key === 'Enter') { e.preventDefault(); openChat(true); return; }
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (researchOpen) toggleResearch(false);
    else if (hud.charOpen) hud.toggleCharacter(false);
    else if (hud.liftOpen) hud.openLift(false);
    else if (hud.shop) hud.openShop(null);
    else if (inspectId != null) openInspect(null);
    else if (wireMode) setWire(false);
    else if (buildKind) setBuild(true, null);
    else if (buildOpen) setBuild(false);
    else toggleEsc();
    return;
  }
  if (escOpen) return;
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  const me = world.me;
  const ch = keyChar(e);
  switch (e.code) {
    case 'KeyB': setBuild(!buildOpen); return;
    case 'KeyV': setWire(!wireMode); sfx('click'); return;
    case 'KeyJ': toggleResearch(); return;
    case 'KeyC': hud.toggleCharacter(); sfx('click'); return;
    case 'F9': if (world.isAdmin) $('dev').classList.toggle('hidden'); return;
    case 'KeyQ': {
      if (hud.shop) { hud.openShop(null); return; }
      const shop = nearbyShop();
      if (shop) { setBuild(false); hud.openShop(shop); sfx('robot'); } else hud.feed('No powered shop nearby', 'bad');
      return;
    }
    case 'KeyR':
      if (buildKind && STRUCTURES[buildKind].rot) { buildRot = (buildRot + 1) % 4; sfx('click'); }
      else act({ type: 'reload' });
      return;
    case 'KeyE': { if (nearbyPoi()) act({ type: 'use' }); return; }
    case 'KeyF': {
      if (hud.liftOpen) { hud.openLift(false); return; }
      const lift = nearestElevator();
      if (!lift) { hud.feed('Stand next to an elevator', 'bad'); return; }
      hud.openShop(null); setBuild(false);
      hud.openLift(true); sfx('click');
      return;
    }
    case 'KeyG': act({ type: 'throw', item: 'grenade', x: mouse.wx, y: mouse.wy }); return;
    case 'KeyT': act({ type: 'throw', item: 'molotov', x: mouse.wx, y: mouse.wy }); return;
    case 'KeyH': act({ type: 'medkit' }); return;
    case 'KeyU': {
      const h = hoverStructure();
      if (inspectId != null && (!h || h.id === inspectId)) act({ type: 'upgrade', id: inspectId });
      else if (h) openInspect(h.id);
      return;
    }
    case 'KeyX': { const h = hoverStructure(); if (h) { act({ type: 'demolish', id: h.id }); if (inspectId === h.id) openInspect(null); } return; }
    case 'Space': act({ type: 'ready' }); return;
    case 'KeyM': hud?.feed(toggleMute() ? 'Sound muted' : 'Sound on'); return;
  }
  if (ch) {
    if (buildOpen && STRUCT_KEYS[ch]) setBuild(true, STRUCT_KEYS[ch]);
    else if (!buildOpen && me && /^[1-8]$/.test(ch)) act({ type: 'switch', slot: Number(ch) - 1 });
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; mouse.rdown = false; });

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (mouse.down && buildKind) { updateMouseWorld(); tryPlace(true); }
});
canvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  mouse.x = e.clientX; mouse.y = e.clientY;
  updateMouseWorld();
  if (chatOpen) openChat(false);
  if (escOpen) return;
  const me = world.me;
  if (e.button === 2) {
    if (buildKind) { setBuild(true, null); return; }
    if (wireMode) { if (wireFrom != null) wireFrom = null; else setWire(false); return; }
    const h = world.layer === 0 ? hoverStructure() : null;
    if (h) { openInspect(h.id); return; }
    mouse.rdown = true; // mining laser: rock underground, ridges on the surface
    return;
  }
  if (e.button !== 0) return;
  if (me && (me.s || me.d)) { spectateIdx++; return; }
  if (wireMode) {
    const id = hoverNode();
    if (id == null) return;
    if (wireFrom == null) { wireFrom = id; sfx('click'); }
    else if (id !== wireFrom) { act({ type: 'wire', a: wireFrom, b: id }); sfx('wire'); wireFrom = id; }
    return;
  }
  if (buildKind) { lastPlacedTile = null; tryPlace(false); return; }
  if (tryClickBuilding()) return;
  mouse.down = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.rdown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  const me = world.me;
  if (!me || buildOpen) return;
  const n = me.u.length;
  act({ type: 'switch', slot: (me.c + (e.deltaY > 0 ? 1 : -1) + n) % n });
}, { passive: true });

function updateMouseWorld() { const w = renderer.screenToWorld(mouse.x, mouse.y); mouse.wx = w.x; mouse.wy = w.y; }
function mouseTile() { return [Math.floor(mouse.wx / TILE), Math.floor(mouse.wy / TILE)]; }
function hoverStructure() { return world.layers && renderer ? renderer.pickStructure(mouse.x, mouse.y) : null; }
function hoverNode() {
  const h = hoverStructure();
  if (h) return h.id;
  if (world.layer === 0 && Math.abs(mouse.wx - world.hq.x) < 48 && mouse.wy > world.hq.y - 48 - 140 && mouse.wy < world.hq.y + 48) return 0;
  return null;
}

// Left-clicking a building opens its shop (if it is one and you are close) or the inspector.
function tryClickBuilding() {
  const me = world.me;
  if (!me || me.d) return false;
  const h = hoverStructure();
  const enemyNear = [...world.enemies.values()].some((z) => Math.hypot(z.rx - mouse.wx, z.ry - mouse.wy) < 70);
  if (h && h.def.shop && h.built && Math.hypot(h.x - me.rx, h.y - me.ry) < SHOP_RANGE + 20) {
    if (!h.powered) { hud.feed(`${h.def.name} has no power`, 'bad'); return true; }
    setBuild(false); hud.openShop(h.kind); sfx('robot'); return true;
  }
  if (h && !enemyNear && !h.def.wall) { openInspect(h.id); return true; }
  if (world.layer === 0 && hoverNode() === 0 && !enemyNear && Math.hypot(world.hq.x - me.rx, world.hq.y - me.ry) < SHOP_RANGE + 40) { setBuild(false); hud.openShop('hq'); sfx('robot'); return true; }
  return false;
}

// Client-side mirror of the server's placement rules (the server has the final say).
function mountWallAt(kind, tx, ty) {
  const g = world.L();
  if (!STRUCTURES[kind]?.mountable || tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return null;
  const w = world.structures.get(world.structGrid[ty * g.w + tx]);
  if (!w || !w.def.wall || !w.built) return null;
  for (const s of world.structures.values()) if (s.mount && s.tx === tx && s.ty === ty) return null;
  return w;
}
function insideDome(kind, tx, ty) {
  const dm = world.snap?.dome;
  if (!dm) return true;
  return footprint(kind, tx, ty).every(([x, y]) => Math.hypot((x + 0.5) * TILE - world.hq.x, (y + 0.5) * TILE - world.hq.y) <= dm[0]);
}

function rockUnderMouse() {
  const me = world.me, g = world.L();
  if (!me || !g || world.layer !== 0) return false;
  const tx = Math.floor(mouse.wx / TILE), ty = Math.floor(mouse.wy / TILE);
  if (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h) return false;
  return canDig(0, g, ty * g.w + tx) && Math.hypot((tx + 0.5) * TILE - me.rx, (ty + 0.5) * TILE - me.ry) <= DIG_REACH;
}

function placementValid(kind, tx, ty) {
  const me = world.me, d = STRUCTURES[kind], g = world.L();
  if (!me || me.d) return false;
  if ((d.layer === 'surface' && world.layer !== 0) || (d.layer === 'underground' && world.layer === 0)) return false;
  if (d.tech && !world.tech.has(d.tech)) return false;
  const c = structCenter(kind, tx, ty);
  if (Math.hypot(c.x - me.rx, c.y - me.ry) > BUILD_RANGE) return false;
  if (!canAfford(world.res, scaleCost(d.cost, me.bc || 1))) return false;
  if (world.layer === 0 && !insideDome(kind, tx, ty)) return false;
  if (mountWallAt(kind, tx, ty)) return true;
  for (const [x, y] of footprint(kind, tx, ty)) {
    if (x <= 0 || y <= 0 || x >= g.w - 1 || y >= g.h - 1) return false;
    const i = y * g.w + x;
    if (g.solid[i] || world.structGrid[i]) return false;
  }
  return true;
}
function tryPlace(dragging) {
  const [tx, ty] = mouseTile();
  const key = `${tx},${ty}`;
  if (dragging && key === lastPlacedTile) return;
  if (!placementValid(buildKind, tx, ty)) { if (!dragging) sfx('deny'); return; }
  lastPlacedTile = key;
  act({ type: 'build', kind: buildKind, tx, ty, rot: buildRot });
  sfx('build', { x: tx * TILE + 16, y: ty * TILE + 16 });
}

function readInput() {
  let mx = 0, my = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  const len = Math.hypot(mx, my) || 1;
  input.mx = mx / len; input.my = my / len;
  input.sp = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.i = keys.has('KeyE') && !nearbyPoi();
  input.f = mouse.down && !buildKind && !wireMode;
  input.d = mouse.rdown;
  input.tx = mouse.wx; input.ty = mouse.wy;
  if (world.me && world.local) input.a = Math.atan2(mouse.wy - world.local.y, mouse.wx - world.local.x);
}
function sendInput(nowMs) {
  const payload = { mx: +input.mx.toFixed(3), my: +input.my.toFixed(3), a: +input.a.toFixed(3), f: input.f, sp: input.sp, i: input.i, d: input.d, tx: Math.round(input.tx), ty: Math.round(input.ty) };
  const str = JSON.stringify(payload);
  if (str === lastSent && nowMs - lastSentAt < 250) return;
  if (nowMs - lastSentAt < 33) return;
  socket.emit('input', payload);
  lastSent = str; lastSentAt = nowMs;
}

// ------------------------------------------------------------------ effects
let hurtEl = null;
function hurtFlash(color = 'rgba(220,38,38,0.55)') {
  if (!hurtEl) { hurtEl = document.createElement('div'); hurtEl.className = 'pointer-events-none fixed inset-0'; document.body.appendChild(hurtEl); }
  hurtEl.style.background = `radial-gradient(ellipse at center, transparent 45%, ${color})`;
  hurtEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-out', fill: 'forwards' });
}
function jagged(pts, z = 30) {
  const out = [[pts[0][0], pts[0][1], z + 16]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    for (let s = 1; s <= 5; s++) {
      const t = s / 5, j = s < 5 ? 1 : 0;
      out.push([ax + (bx - ax) * t + (Math.random() - 0.5) * 22 * j, ay + (by - ay) * t + (Math.random() - 0.5) * 22 * j, 14 + Math.random() * 10 * j]);
    }
  }
  return out;
}
const structAt = (x, y) => { const g = world.L(); return world.structures.get(world.structGrid[Math.floor(y / TILE) * g.w + Math.floor(x / TILE)]); };
const turretAt = (x, y) => {
  for (const s of world.structures.values()) if (Math.abs(s.x - x) < 2 && Math.abs(s.y - y) < 2) return s;
  return structAt(x, y);
};
const P = (x, y) => ({ x, y });
const BEAM_COLOR = { laser_s: '#f87171', laser_m: '#fb923c', laser_l: '#fca5a5', rail_l: '#67e8f9', hq: '#7dd3fc', drone: '#f87171' };
const BEAM_WIDTH = { laser_s: 1.4, laser_m: 2.4, laser_l: 5, rail_l: 4, hq: 1.6, drone: 1.2 };
const TILE_DEBRIS = (o) => (o >= 10 ? RESOURCES[ORE_IDS[o - 10]].color : o === 2 ? '#3a3633' : '#6b5d50');

function handleFx(list) {
  if (!renderer) return;
  const now = renderer.time;
  const g = world.L();
  for (const f of list) {
    switch (f.t) {
      case 'toast':
        hud.feed(f.text, f.kind);
        if (f.kind === 'wave') {
          const m = /^Wave (\d+) - (\d+)/.exec(f.text);
          if (m) { hud.banner(`WAVE ${m[1]}`, `${m[2]} hostile machines inbound`, '#fca5a5'); sfx('wave'); }
          else if (/repelled/.test(f.text)) { hud.banner('WAVE REPELLED', 'Mine, build and recharge the grid', '#86efac'); sfx('cleared'); }
        }
        break;
      case 'dmg': {
        const z = world.enemies.get(f.id); if (z) z.hitAt = now;
        renderer.floatText(f.x + (Math.random() - 0.5) * 10, f.y, 28, String(f.v), f.c ? '#fde047' : '#f5f5f4', !!f.c);
        renderer.burst(f.x, f.y, f.c ? 6 : 3, '#fbbf24', 120, 2, 0.3, 18, { kind: 'spark' });
        sfx('hit', P(f.x, f.y), { gap: 45 });
        break;
      }
      case 'hit': { const z = world.enemies.get(f.id); if (z) { z.hitAt = now; if (Math.random() < 0.5) renderer.burst(z.rx, z.ry, 2, '#fde68a', 90, 2, 0.25, 14, { kind: 'spark' }); } break; }
      case 'kill': {
        const def = ENEMIES[ENEMY_TYPE_IDS[f.z]];
        const big = def.boss ? 4 : def.radius / 9;
        renderer.burst(f.x, f.y, 10 * big, '#fbbf24', 200, 2, 0.5, 14, { kind: 'spark' });
        renderer.burst(f.x, f.y, 6 * big, shade2(def.color), 140, 4 * Math.min(2, big), 1, 14, { kind: 'gib' });
        renderer.smoke(f.x, f.y, 10, Math.ceil(2 * big), 'rgba(60,60,60,', 8, 1.4);
        renderer.flash(f.x, f.y, 80 * Math.min(3, big), 0.12, 14);
        renderer.wreck(f.x, f.y, ENEMY_TYPE_IDS[f.z], f.a || 0, def.radius);
        if (def.boss) { renderer.addShake(16); renderer.ring(f.x, f.y, 280, '#fde047', 0.8); sfx('boom', P(f.x, f.y)); }
        else sfx('metalkill', P(f.x, f.y), { gap: 35 });
        break;
      }
      case 'shot': {
        const p = world.players.get(f.id);
        if (!p) break;
        p.flashAt = now; p.recoil = 1;
        const mx = p.rx + Math.cos(p.ra) * 26, my = p.ry + Math.sin(p.ra) * 26;
        renderer.flash(mx, my, f.w === 'rocket' ? 180 : 110, 0.08, p.rz + 18);
        if (f.id === world.you && (f.w === 'shotgun' || f.w === 'rocket')) renderer.addShake(f.w === 'rocket' ? 6 : 4);
        sfx(f.w, P(p.rx, p.ry), { gap: f.w === 'rifle' ? 55 : 35 });
        break;
      }
      case 'swing': {
        const p = world.players.get(f.id);
        if (!p) break;
        p.swingAt = now;
        sfx(f.w === 'chainsaw' ? 'chainsaw' : f.w === 'katana' ? 'katana' : 'swing', P(p.rx, p.ry));
        break;
      }
      case 'hurt': {
        const p = world.players.get(f.id);
        if (p) { p.hurtAt = now; renderer.burst(p.rx, p.ry, 4, '#fca5a5', 80, 3, 0.4, p.rz + 18); }
        if (f.id === world.you) { hurtFlash(); sfx('hurt', null, { gap: 120 }); renderer.addShake(5); }
        break;
      }
      case 'pshield': {
        const p = world.players.get(f.id);
        if (p) { p.shieldHitAt = now; renderer.burst(p.rx, p.ry, 6, '#7dd3fc', 120, 2, 0.4, p.rz + 20, { kind: 'spark' }); sfx('shieldhit', P(p.rx, p.ry), { gap: 80 }); }
        if (f.id === world.you) hurtFlash('rgba(56,189,248,0.4)');
        break;
      }
      case 'death': renderer.burst(f.x, f.y, 40, '#e4e4e7', 220, 4, 1, 16, { kind: 'gib' }); renderer.flash(f.x, f.y, 200, 0.3); sfx('destroyed', P(f.x, f.y)); break;
      case 'fall': if (f.id === world.you) { renderer.addShake(6); sfx('fall'); } break;
      case 'beam': {
        const st = f.k === 'hq' || f.k === 'drone' ? null : turretAt(f.x, f.y);
        if (st) st.flashAt = now;
        const z0 = f.z ?? (st ? structHeight(st) * 0.7 + 8 + (st.mount ? mountLift(renderer, st) : 0) : 20);
        const lvl = f.lv || 1;
        const color = lvl >= 5 ? '#e9d5ff' : lvl >= 4 && f.k !== 'rail_l' ? '#fecaca' : BEAM_COLOR[f.k] || '#fca5a5';
        renderer.line([[f.x, f.y, z0], [f.x2, f.y2, 14]], color, (BEAM_WIDTH[f.k] || 1.5) * (1 + (lvl - 1) * 0.15), f.k === 'rail_l' || f.k === 'laser_l' ? 0.22 : 0.07);
        renderer.flash(f.x, f.y, f.k === 'rail_l' ? 200 : 70, 0.06, z0);
        renderer.burst(f.x2, f.y2, f.k === 'rail_l' ? 10 : 2, color, 100, 2, 0.25, 14, { kind: 'spark' });
        if (f.k === 'rail_l') renderer.addShake(2);
        sfx(f.k, P(f.x, f.y), { gap: f.k === 'laser_s' ? 70 : 60, vol: 0.8 });
        break;
      }
      case 'arc': {
        const st = turretAt(f.pts[0][0], f.pts[0][1]);
        if (st) st.flashAt = now;
        const z0 = st ? structHeight(st) + 6 + (st.mount ? mountLift(renderer, st) : 0) : 40;
        renderer.line(jagged(f.pts, z0), '#e0f2fe', f.k === 'tesla_l' ? 3.5 : 2.2, 0.2);
        renderer.line(jagged(f.pts, z0), '#7dd3fc', 1.2, 0.15);
        renderer.flash(f.pts[0][0], f.pts[0][1], 180, 0.2, z0);
        for (const [x, y] of f.pts.slice(1)) renderer.burst(x, y, 5, '#bae6fd', 100, 2, 0.3, 16, { kind: 'spark' });
        sfx('tesla', P(f.pts[0][0], f.pts[0][1]));
        break;
      }
      case 'flak': {
        const st = turretAt(f.x, f.y); if (st) st.flashAt = now;
        renderer.line([[f.x, f.y, 34], [f.x2, f.y2, 50]], 'rgba(226,232,240,0.8)', 1.4, 0.08);
        renderer.particle({ x: f.x2, y: f.y2, z: 50, vx: 0, vy: 0, vz: 5, life: 1.1, color: 'rgba(30,30,30,', size: 10, kind: 's', grow: 18 });
        renderer.burst(f.x2, f.y2, 10, '#fdba74', 160, 3, 0.35, 50, { kind: 'spark', g: 50 });
        renderer.flash(f.x2, f.y2, 160, 0.12, 50);
        sfx('flak', P(f.x, f.y), { gap: 90 });
        break;
      }
      case 'launch': { const st = turretAt(f.x, f.y); if (st) st.flashAt = now; renderer.smoke(f.x, f.y, 30, 4, 'rgba(200,200,200,', 10, 1.2); sfx('launch', P(f.x, f.y), { gap: 120 }); break; }
      case 'mortar': { const st = turretAt(f.x, f.y); if (st) st.flashAt = now; renderer.flash(f.x, f.y, 160, 0.15, 30, '#c084fc'); renderer.smoke(f.x, f.y, 30, 3, 'rgba(120,80,160,', 9, 1.2); sfx('mortar', P(f.x, f.y), { gap: 120 }); break; }
      case 'boom': {
        const z = f.a ? 50 : 10;
        renderer.burst(f.x, f.y, 40, '#f97316', 280, 5, 0.6, z);
        renderer.burst(f.x, f.y, 20, '#fde047', 200, 3, 0.4, z, { kind: 'spark' });
        renderer.smoke(f.x, f.y, z, 8, 'rgba(60,60,60,', 14, 2);
        if (!f.a) { renderer.ring(f.x, f.y, f.r * 1.2, '#fdba74', 0.4); renderer.addDecal(f.x, f.y, f.r * 0.5, '#1c1917', 60); }
        renderer.flash(f.x, f.y, 340, 0.4, z);
        const me = world.me;
        renderer.addShake(Math.max(1, 12 - Math.hypot(f.x - (me?.rx || 0), f.y - (me?.ry || 0)) / 90));
        sfx('boom', P(f.x, f.y), { gap: 60 });
        break;
      }
      case 'stomp': renderer.ring(f.x, f.y, 200, '#a16207', 0.6); renderer.burst(f.x, f.y, 50, '#78716c', 240, 6, 0.9, 2); renderer.addShake(18); sfx('stomp', P(f.x, f.y)); break;
      case 'summon': renderer.ring(f.x, f.y, 140, '#a855f7', 0.7); renderer.burst(f.x, f.y, 30, '#c084fc', 160, 3, 0.8, 10, { kind: 'spark' }); break;
      case 'boss': hud.feed(`BOSS INCOMING: ${f.name}`, 'bad'); hud.banner(f.name.toUpperCase(), 'BOSS MACHINE INCOMING', '#f87171'); renderer.addShake(14); sfx('boss'); break;
      case 'splat': renderer.burst(f.x, f.y, 10, '#e879f9', 100, 3, 0.5, 14, { kind: 'spark' }); renderer.flash(f.x, f.y, 70, 0.1, 14, '#e879f9'); sfx('splat', P(f.x, f.y), { gap: 80 }); break;
      case 'spark': renderer.burst(f.x, f.y, 4, '#fde68a', 90, 2, 0.25, 14, { kind: 'spark' }); break;
      case 'shieldhit': {
        const st = structAt(f.sx, f.sy); if (st) st.shieldHitAt = now;
        if (f.sx === world.hq.x && f.sy === world.hq.y) renderer.domeHitAt = now;
        renderer.ripples.push({ x: f.x, y: f.y, life: 0.5 });
        renderer.burst(f.x, f.y, 6, '#bfdbfe', 120, 2, 0.4, 20, { kind: 'spark' });
        sfx('shieldhit', P(f.x, f.y), { gap: 90 });
        break;
      }
      case 'domehit':
        (renderer.domeHits ||= []).push({ a: f.a, t: now });
        renderer.domeHitAt = now;
        sfx('shieldhit', P(world.hq.x + Math.cos(f.a) * (world.snap?.dome?.[0] || 300), world.hq.y + Math.sin(f.a) * (world.snap?.dome?.[0] || 300)), { gap: 60 });
        break;
      case 'ride': sfx('elevator'); break;
      case 'dome':
        if (f.up) { hud.banner('DOME RESTORED', 'The atmosphere is holding again', '#7dd3fc'); sfx('upgrade'); }
        else { hud.banner('DOME DOWN', 'Restore power to the HQ before the buildings decompress', '#f87171'); sfx('powerdown'); renderer.addShake(8); }
        break;
      case 'destroyed':
        renderer.burst(f.x, f.y, 30, STRUCTURES[f.k]?.color || '#999', 180, 6, 1.2, 20, { kind: 'gib' });
        renderer.smoke(f.x, f.y, 10, 8, 'rgba(90,90,90,', 12, 2);
        renderer.flash(f.x, f.y, 140, 0.2, 20);
        renderer.addShake(3);
        sfx('destroyed', P(f.x, f.y));
        break;
      case 'upgrade': renderer.burst(f.x, f.y, 40, '#fbbf24', 160, 3, 1, 30, { kind: 'spark' }); renderer.ring(f.x, f.y, 70, '#fbbf24', 0.5); renderer.flash(f.x, f.y, 140, 0.3, 30); sfx('upgrade', P(f.x, f.y)); if (f.id === inspectId) act({ type: 'inspect', id: f.id }); break;
      case 'module': renderer.burst(f.x, f.y, 20, '#e879f9', 120, 2, 0.8, 30, { kind: 'spark' }); sfx('module', P(f.x, f.y)); break;
      case 'built': renderer.burst(f.x, f.y, 12, '#fde68a', 100, 2, 0.6, 20, { kind: 'spark' }); sfx('built', P(f.x, f.y), { gap: 100 }); break;
      case 'wired': sfx('wire'); break;
      case 'dig': {
        if (!g) break;
        renderer.burst(f.x, f.y + 14, 3, TILE_DEBRIS(f.o), 110, 3, 0.6, 18);
        renderer.burst(f.x, f.y + 14, 2, '#fdba74', 160, 2, 0.25, 20, { kind: 'spark' });
        sfx('dig', P(f.x, f.y), { gap: 90 });
        break;
      }
      case 'dug': {
        world.digTile(world.layer, f.i);
        renderer.invalidateTile(world.layer, f.i);
        renderer.burst(f.x, f.y, 22, TILE_DEBRIS(f.o), 160, 5, 1.1, 30, { kind: 'gib' });
        renderer.smoke(f.x, f.y, 10, 6, 'rgba(120,105,90,', 12, 1.8);
        renderer.addShake(1.5);
        sfx('dug', P(f.x, f.y), { gap: 60 });
        break;
      }
      case 'ore': {
        const res = RESOURCES[f.r];
        renderer.floatText(f.x, f.y, 34, `+${f.v} ${res.icon}`, res.color, true);
        renderer.burst(f.x, f.y, 14, res.color, 140, 3, 0.8, 24, { kind: 'spark' });
        if (f.by === world.you) sfx(['crystal', 'xenium', 'titanium'].includes(f.r) ? 'ore_rare' : 'ore');
        break;
      }
      case 'deposit': {
        const p = f.id ? world.players.get(f.id) : null;
        const x = p ? p.rx : f.x, y = p ? p.ry : f.y;
        renderer.burst(x, y, 16, '#fde68a', 120, 2, 0.8, 30, { kind: 'spark' });
        renderer.floatText(x, y, 40, `↑ ${f.v} ore`, '#fde68a');
        sfx('deposit', P(x, y), { gap: 200 });
        break;
      }
      case 'arrive': { const p = world.players.get(f.id); if (p) { renderer.flash(p.x, p.y, 200, 0.4, 20); renderer.burst(p.x, p.y, 20, '#fde68a', 120, 2, 0.6, 20, { kind: 'spark' }); } break; }
      case 'loot': renderer.burst(f.x, f.y, 60, '#fde047', 220, 3, 1.4, 40, { kind: 'spark' }); renderer.ring(f.x, f.y, 140, '#38bdf8', 0.8); renderer.flash(f.x, f.y, 300, 0.5, 40); sfx('loot', P(f.x, f.y)); hud.banner(f.k === 'probe' ? 'PROBE SALVAGED' : 'ANCIENT TECH RECOVERED', '', '#fde047'); break;
      case 'wake': renderer.flash(f.x, f.y, 120, 0.3, 20, '#ef4444'); sfx('servo', P(f.x, f.y), { gap: 300 }); break;
      case 'research': sfx('research'); hud.banner('RESEARCH COMPLETE', '', '#e879f9'); break;
      case 'gust': renderer.burst(f.x, f.y, 18, '#fbbf24', 220, 3, 0.8, 20, { kind: 'spark' }); renderer.flash(f.x, f.y, 120, 0.15, 20); sfx('destroyed', P(f.x, f.y), { gap: 200, vol: 0.5 }); break;
      case 'terra': renderer.ring(f.x, f.y, 160, 'rgba(52,211,153,0.6)', 1.2); break;
      case 'collect': renderer.burst(f.x, f.y, 6, '#fbbf24', 80, 2, 0.4, 20, { kind: 'spark' }); break;
      case 'rdie': renderer.burst(f.x, f.y, 30, '#9ca3af', 200, 3, 0.8, 22, { kind: 'gib' }); renderer.flash(f.x, f.y, 120, 0.2, 22); sfx('destroyed', P(f.x, f.y)); break;
      case 'heal': { const p = world.players.get(f.id); if (p) { renderer.burst(p.rx, p.ry, 20, '#4ade80', 60, 4, 1, 20); sfx('heal', P(p.rx, p.ry)); } break; }
      case 'shrine': renderer.burst(f.x, f.y, 50, '#fef3c7', 220, 4, 1.2, 30, { kind: 'spark' }); renderer.ring(f.x, f.y, 110, '#fde68a', 0.7); sfx('level'); break;
      case 'zap': renderer.burst(f.x, f.y, 3, '#fde047', 80, 2, 0.2, 4, { kind: 'spark' }); break;
      case 'hqhit': renderer.hqHitAt = now; if (Math.random() < 0.1) sfx('alarm', null, { gap: 4000 }); break;
    }
  }
}
function shade2(hex) { return hex; }

// ------------------------------------------------------------------ main loop
let lastFrame = performance.now();
let ambientTimer = 1, stepAcc = 0, fpsAcc = 0, fpsFrames = 0;
function loop(nowMs) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  if (!world.snap) return;
  // adaptive particle quality keeps the frame rate up during huge waves
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 1) { const fps = fpsFrames / fpsAcc; renderer.quality = Math.max(0.35, Math.min(1, renderer.quality + (fps < 45 ? -0.15 : fps > 57 ? 0.05 : 0))); fpsAcc = 0; fpsFrames = 0; }

  updateMouseWorld();
  if (!chatOpen && !escOpen) readInput(); else { input.mx = input.my = 0; input.f = input.i = input.sp = input.d = false; }
  const me = world.me;
  if (me && (me.d || me.s)) { input.f = false; input.i = false; input.d = false; }
  sendInput(nowMs);
  world.update(dt, input);

  let focus = me ? { x: me.rx, y: me.ry } : world.hq, focusZ = me?.rz || 0;
  if (me && (me.d || me.s)) {
    const alive = [...world.players.values()].filter((p) => !p.d && p.id !== me.id && p.L === world.layer);
    if (alive.length) { const p = alive[spectateIdx % alive.length]; focus = { x: p.rx, y: p.ry }; focusZ = p.rz; }
    else focus = { x: me.x, y: me.y };
  }
  setListener(focus.x, focus.y);

  ambientTimer -= dt;
  if (ambientTimer <= 0) {
    ambientTimer = 0.6 + Math.random() * 1.2;
    const zs = [...world.enemies.values()];
    if (zs.length) { const z = zs[(Math.random() * zs.length) | 0]; sfx(z.flags & 16 ? 'wasp' : 'servo', P(z.rx, z.ry), { gap: 200, vol: 0.7 }); }
  }
  if (me && !me.d && me.moved > 0.3) {
    stepAcc += me.moved;
    if (stepAcc > (input.sp ? 42 : 34)) { stepAcc = 0; sfx('footstep', null, { gap: 0, vol: 0.6, verb: 0.2 }); }
  }
  if (inspectId != null) {
    inspectTimer -= dt;
    if (inspectTimer <= 0) { inspectTimer = 1; act({ type: 'inspect', id: inspectId }); }
    if (inspectId !== 0 && !world.structures.has(inspectId)) { inspectId = null; hud.setDetail(null); }
  }

  const shopNear = nearbyShop();
  if (hud.shop && hud.shop !== shopNear) hud.openShop(null);
  if (hud.liftOpen && !nearestElevator()) hud.openLift(false);
  const tile = mouseTile();
  const mw = buildKind ? mountWallAt(buildKind, tile[0], tile[1]) : null;
  const view = {
    focus, focusZ, mouse, me, cam: renderer.cam, size: { w: renderer.w, h: renderer.h },
    mouseWorld: { x: mouse.wx, y: mouse.wy },
    hover: wireMode || buildKind ? hoverStructure() : hoverStructure(),
    selected: inspectId, wire: wireMode, wireFrom, shopNear, poiNear: !!nearbyPoi(), rockNear: rockUnderMouse(),
    build: buildOpen ? { tile, kind: buildKind, valid: buildKind && placementValid(buildKind, tile[0], tile[1]), me, mount: mw ? structHeight(mw) : 0, rot: buildRot } : null,
  };
  renderer.draw(dt, view);
  hud.update(dt, view);
  hud.renderInspect(inspectId != null);
  hud.renderResearch(researchOpen);
  if (buildOpen) hud.setBuildSelection(buildKind, me);
}

export { isDiggable, DIG_REACH };
