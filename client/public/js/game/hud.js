// DOM HUD: stockpile, vitals, power panel, build menu, structure inspector, research, shop,
// minimap. Updates are diffed so the DOM is only touched on change.
import {
  WEAPONS, CONSUMABLES, STRUCTURES, STRUCTURE_ORDER, STRUCTURE_CATS, PERKS, ENEMIES, TILE, RESOURCES, RES_IDS, ORE_IDS,
  MODULES, MODULE_IDS, TECH, TECH_IDS, SHOPS, shopItemInfo, ROBOTS, LAYER_NAMES, canAfford, scaleCost, costText,
  isOreTile, S_RIDGE, S_RUIN, S_ICE, S_VENT, S_CRATER, U_FLOOR, U_RUIN_FLOOR, U_BEDROCK, oreOfTile,
  turretStats, structureMaxHp, idleDraw, SUIT_IDS, suitInfo, DEPTHS, SHAFT_COST, UNCAPPED, storageOf, MINING_TOOL, DOME,
} from '/shared/defs.js';

// What each building is for (shown in the build menu tooltip).
const ABOUT = {
  wall_alloy: 'Cheap barrier. Machines must chew through it; walls on the outer edge get a fence. Walk on top via a stairwell.',
  wall_titan: 'Heavy armoured wall for choke points. Over three times the toughness of alloy.',
  stairs: 'Lets colonists climb onto walls for +20% damage. Rotate with R before placing.',
  laser_s: 'Rapid pulse laser. Cheap, accurate, sips power. Fits on walls.',
  laser_m: 'Sustained beam that hits hard. Fits on walls.',
  laser_l: 'Huge piercing lance that cuts through a whole line of machines.',
  tesla_s: 'Arc coil whose lightning jumps between several targets.',
  tesla_l: 'Storm spire: massive chain lightning across a swarm.',
  flak_s: 'Anti-air flak. Shreds flying wasps; cannot hit ground units.',
  missile_l: 'Long-range homing missile salvos against flyers.',
  mortar_m: 'Lobs plasma shells over walls onto ground swarms. Has a minimum range.',
  rail_l: 'Railgun: one enormous piercing shot across the map.',
  shock_plate: 'Floor trap that electrocutes machines walking over it.',
  stasis_field: 'Slows every machine inside its field.',
  floodlight: 'Lights a big area at night and reveals cloaked phantoms.',
  o2_station: 'Refills suit oxygen nearby (useful underground).',
  repair_station: 'Slowly repairs nearby buildings and heals colonists.',
  shield_projector: 'Extra local shield that soaks damage to everything under it.',
  research_lab: 'Unlocks research (J): bigger turrets, robots, power tech and terraforming.',
  solar_panel: 'Large solar panel. Makes power only while the sun is up - pair it with batteries.',
  solar_array: 'Field of panels with several times the output.',
  battery: 'Stores spare energy for the night and covers shortfalls.',
  battery_bank: 'Large battery bank for long nights and heavy turret fire.',
  pylon: 'Relays wires further across the base.',
  geothermal: 'Steady power around the clock from a vent.',
  fusion: 'Huge output, burns energy crystals.',
  refinery: 'Turns mined ore in the queue into usable resources much faster.',
  elevator: 'Extra lift stop on this level: ride to any level the shaft reaches and drop off ore here.',
  drill: 'Automatically mines ore next to it. Hauler bots collect it.',
  borer: 'Tunnels forward in its facing direction, collecting what it digs.',
  robot_factory: 'Builds salvage, hauler, digger, repair and combat robots.',
  terraformer: 'Builds the planet\'s atmosphere. Keep it powered and fed with xenium to win.',
  warehouse: 'Raises how much of every resource the colony can hold.',
  armory: 'Buy weapons and power cells.',
  med_bay: 'Heals you over time, sells med packs, surgery and suit shields.',
};

function structureTip(kind, world) {
  const d = STRUCTURES[kind];
  const row = (k, v) => `<div class="flex justify-between gap-3"><span class="text-zinc-400">${k}</span><span class="font-semibold">${v}</span></div>`;
  const rows = [row('Health', structureMaxHp(kind, 1)), row('Size', `${d.size || 1}x${d.size || 1}`)];
  if (d.turret) rows.push(row('Power use', `${idleDraw(d)}⚡/s idle + per shot`));
  else if (d.draw) rows.push(row('Power use', `${d.draw}⚡/s`));
  if (d.supply) rows.push(row('Power output', `${d.supply}⚡/s${d.solar ? ' at full sun' : ''}`));
  if (d.capacity) rows.push(row('Stores', `${d.capacity}⚡ (${d.rate}/s)`));
  if (d.storage) rows.push(row('Storage', `+${storageOf(1)} of each resource`));
  const t = turretStats(kind, 1);
  if (t) {
    rows.push(row('Damage', `${Math.round(t.damage)}${t.splash ? ` · splash ${Math.round(t.splash)}` : ''}${t.chains ? ` · ${t.chains} chains` : ''}${d.turret.pierce ? ` · pierces ${d.turret.pierce}` : ''}`));
    rows.push(row('Fire rate', `${(1 / t.cooldown).toFixed(1)}/s (${Math.round(t.damage / t.cooldown)} DPS)`));
    rows.push(row('Range', `${Math.round(t.range / TILE)} tiles`));
    rows.push(row('Energy per shot', `${t.shot.toFixed(1)}⚡`));
    rows.push(row('Targets', d.turret.antiAir ? 'Air only' : 'Ground'));
    rows.push(row('Module slots', `${{ S: 1, M: 2, L: 3 }[d.tsize]}`));
  }
  if (d.light) rows.push(row('Light radius', `${Math.round(d.light / TILE)} tiles`));
  if (d.radius) rows.push(row('Radius', `${Math.round(d.radius / TILE)} tiles`));
  const where = d.layer === 'surface' ? 'Surface only (inside the dome)' : d.layer === 'underground' ? 'Underground only' : 'Inside the dome or underground';
  const lock = d.tech && !world.tech.has(d.tech) ? `<p class="mt-1 text-fuchsia-300">Needs research: ${TECH[d.tech].name}</p>` : '';
  return `<p class="font-display text-lg leading-tight" style="color:${d.color}">${d.name}</p>
    <p class="mt-1 text-zinc-300">${ABOUT[kind] || ''}</p>
    <div class="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-xs">${rows.join('')}</div>
    <p class="mt-2 text-xs">${costHtml(d.cost, world.res)}</p>
    <p class="mt-1 text-[11px] text-zinc-500">${where}</p>${lock}`;
}
import { playerColor } from './renderer.js';

const $ = (id) => document.getElementById(id);
const FOG_CELL = 4; // minimap fog resolution in tiles
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cache = new Map();
function set(id, prop, value) {
  const key = `${id}.${prop}`;
  if (cache.get(key) === value) return;
  cache.set(key, value);
  const el = $(id);
  if (!el) return;
  if (prop === 'text') el.textContent = value;
  else if (prop === 'html') el.innerHTML = value;
  else if (prop === 'width') el.style.width = value;
  else if (prop === 'hidden') el.classList.toggle('hidden', value);
}
const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString();
export const costHtml = (cost, res) => Object.entries(cost).filter(([, v]) => v > 0).map(([k, v]) =>
  `<span class="${(res?.[k] ?? 0) >= v ? 'text-zinc-200' : 'text-blood-400'}"><span style="color:${RESOURCES[k].color}">${RESOURCES[k].icon}</span> ${v}</span>`).join(' ');

export class Hud {
  constructor(world) {
    this.world = world;
    this.mini = $('minimap').getContext('2d');
    this.miniTimer = 0;
    this.miniBg = null;
    this.miniKey = '';
    this.shop = null;
    this.detail = null;
    this.buildList();
  }

  // ---------------------------------------------------------------- build menu
  buildList() {
    $('build-list').innerHTML = STRUCTURE_CATS.map((cat) => `
      <div>
        <p class="mb-1 text-[11px] font-bold uppercase tracking-widest text-zinc-500">${cat}</p>
        <div class="grid grid-cols-2 gap-1.5">
        ${STRUCTURE_ORDER.filter((k) => STRUCTURES[k].cat === cat).map((k) => {
          const s = STRUCTURES[k];
          const t = s.turret;
          const tags = [t ? `${t.antiAir ? 'anti-air' : 'ground'}${s.tsize ? ` · ${s.tsize}` : ''}` : '', s.draw ? `⚡${s.draw}/s` : '', s.supply ? `+${s.supply}⚡${s.solar ? ' (sun)' : ''}` : '',
            s.capacity ? `stores ${s.capacity}` : '', s.size ? '2x2' : '', s.wall ? 'walkable' : '', s.mountable ? 'wall-mount' : '', s.shop ? 'shop' : ''].filter(Boolean).join(' · ');
          return `<button data-build="${k}" class="flex flex-col items-start rounded-lg border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-left transition hover:border-amber-400">
            <span class="flex w-full items-center justify-between gap-1 text-sm font-semibold"><span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:${s.color}"></span>${s.name}</span>${s.key ? `<span class="kbd">${s.key}</span>` : ''}</span>
            <span class="text-[11px]" data-cost="${k}"></span>
            <span class="text-[10px] text-zinc-500">${tags || '&nbsp;'}</span>
          </button>`;
        }).join('')}
        </div>
      </div>`).join('');
  }

  setBuildSelection(kind, me) {
    const w = this.world;
    for (const el of document.querySelectorAll('[data-build]')) {
      const k = el.dataset.build, d = STRUCTURES[k];
      el.classList.toggle('border-amber-400', k === kind);
      el.classList.toggle('bg-amber-400/10', k === kind);
      const cost = scaleCost(d.cost, me?.bc || 1);
      const wrongLayer = (d.layer === 'surface' && w.layer !== 0) || (d.layer === 'underground' && w.layer === 0);
      const locked = d.tech && !w.tech.has(d.tech);
      let html;
      if (locked) html = `<span class="text-fuchsia-300">Research: ${TECH[d.tech].name}</span>`;
      else if (wrongLayer) html = `<span class="text-zinc-500">${d.layer === 'surface' ? 'Surface only' : 'Underground only'}</span>`;
      else html = costHtml(cost, w.res);
      const node = el.querySelector('[data-cost]');
      if (node.dataset.html !== html) { node.innerHTML = html; node.dataset.html = html; }
      el.classList.toggle('opacity-40', locked || wrongLayer || !canAfford(w.res, cost));
    }
  }

  showBuildTip(kind, x, y) {
    const el = $('build-tip');
    if (!kind) { el.classList.add('hidden'); return; }
    el.innerHTML = structureTip(kind, this.world);
    el.classList.remove('hidden');
    const h = el.offsetHeight;
    el.style.left = `${Math.min(window.innerWidth - 336, x + 18)}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y - 20))}px`;
  }

  // ---------------------------------------------------------------- character menu (C)
  toggleCharacter(force) {
    this.charOpen = force ?? !this.charOpen;
    set('char', 'hidden', !this.charOpen);
    cache.delete('char-upgrades.html');
  }

  renderCharacter(me) {
    if (!this.charOpen || !me?.up) return;
    const w = this.world;
    set('char-upgrades', 'html', SUIT_IDS.map((k) => {
      const lvl = me.up[k] || 0, info = suitInfo(k, lvl);
      const can = info.next && canAfford(w.res, info.cost);
      return `<li class="rounded-lg border border-zinc-700 bg-zinc-950/70 p-3">
        <div class="flex items-center justify-between gap-2"><span class="font-semibold">${info.name} <span class="text-xs text-amber-300">Mk${lvl + 1}</span></span>
          ${info.next ? `<button data-suit="${k}" class="btn-primary btn-sm" ${can ? '' : 'disabled'}>Upgrade</button>` : '<span class="text-xs text-toxic-400">MAX</span>'}</div>
        <p class="text-xs text-zinc-400">${info.desc}</p>
        <p class="mt-1 text-sm"><span class="text-zinc-300">${info.cur}</span> · ${info.stat}${info.next ? ` <span class="text-amber-300">→ ${info.next} · ${info.nextStat}</span>` : ''}</p>
        ${info.next ? `<p class="mt-1 text-xs">${costHtml(info.cost, w.res)}</p>` : ''}</li>`;
    }).join(''));
  }

  // ---------------------------------------------------------------- lift shaft
  openLift(open) {
    this.liftOpen = open;
    set('lift', 'hidden', !open);
    cache.delete('lift-levels.html');
  }

  renderLift() {
    if (!this.liftOpen) return;
    const w = this.world, sd = w.snap?.sd ?? 1;
    const rows = [];
    for (let L = 0; L <= DEPTHS; L++) {
      let right;
      if (L === w.layer) right = '<span class="text-xs text-zinc-500">You are here</span>';
      else if (L <= sd) right = `<button data-lift="${L}" class="btn-primary btn-sm">Go</button>`;
      else if (L === sd + 1) right = `<span class="flex flex-col items-end gap-1"><span class="text-xs">${costHtml(SHAFT_COST[L], w.res)}</span><button data-deepen class="btn-sm btn-ghost border border-amber-400 text-amber-300" ${canAfford(w.res, SHAFT_COST[L]) ? '' : 'disabled'}>Bore shaft deeper</button></span>`;
      else right = '<span class="text-xs text-zinc-600">Bore the levels above first</span>';
      rows.push(`<li class="flex items-center justify-between gap-3 rounded-lg border ${L === w.layer ? 'border-amber-400/60 bg-amber-400/10' : 'border-zinc-700 bg-zinc-950/70'} px-3 py-2">
        <span><span class="block font-semibold">${LAYER_NAMES[L]}</span><span class="block text-[11px] text-zinc-500">${L === 0 ? 'Colony dome, refining, defenses' : L <= sd ? 'Reached by the shaft' : 'Not bored yet'}</span></span>${right}</li>`);
    }
    set('lift-levels', 'html', rows.join(''));
  }

  // ---------------------------------------------------------------- shop
  openShop(shop) {
    this.shop = shop;
    set('shop', 'hidden', !shop);
    if (shop) { set('shop-title', 'text', SHOPS[shop].name); cache.delete('shop-items.html'); }
  }

  renderShop(me) {
    if (!this.shop || !me) return;
    const ctx = { shieldLvl: me.shl || 0, techs: this.world.tech, toolLvl: me.tl || 0, domeLvl: this.world.snap?.dome?.[5] || 1 };
    set('shop-items', 'html', SHOPS[this.shop].items.map((id) => {
      const info = shopItemInfo(id, ctx);
      let owned = '';
      if (id.startsWith('w:') && me.u.includes(id.slice(2))) owned = 'Carrying';
      if (['medkit', 'grenade', 'molotov'].includes(id)) owned = `${me.cs[['grenade', 'molotov', 'medkit'].indexOf(id)]}/${CONSUMABLES[id].max}`;
      const disabled = !info.price || !canAfford(this.world.res, info.price) || owned === 'Carrying';
      return `<li><button data-shop-item="${id}" ${disabled ? 'disabled' : ''} class="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 py-2 text-left transition hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-40">
        <span><span class="block font-semibold">${esc(info.name)}</span><span class="block text-xs text-zinc-500">${esc(info.desc || '')}</span></span>
        <span class="shrink-0 text-right text-xs">${info.price ? costHtml(info.price, this.world.res) : '-'}<span class="block text-[10px] text-zinc-500">${owned}</span></span>
      </button></li>`;
    }).join(''));
  }

  // ---------------------------------------------------------------- research
  renderResearch(open) {
    set('research', 'hidden', !open);
    $('research').classList.toggle('flex', open);
    if (!open) return;
    const w = this.world;
    const hasLab = [...w.structures.values()].some((s) => s.kind === 'research_lab' && s.built && s.powered);
    set('research-note', 'text', hasLab ? 'Research is shared by the whole colony. Ancient Data comes from monoliths and ruin caches.' : 'You need a powered Research Lab to research (build one from the Support tab).');
    set('research-list', 'html', TECH_IDS.map((id) => {
      const t = TECH[id];
      const done = w.tech.has(id);
      const can = hasLab && !done && canAfford(w.res, t.cost);
      return `<div class="rounded-lg border ${done ? 'border-emerald-600/60 bg-emerald-900/10' : 'border-zinc-700 bg-zinc-950/70'} p-3">
        <div class="flex items-center justify-between"><p class="font-semibold">${t.name}</p>${done ? '<span class="chip bg-emerald-500/20 text-emerald-300">Done</span>' : ''}</div>
        <p class="text-xs text-zinc-400">${t.desc}</p>
        ${done ? '' : `<div class="mt-1 flex items-center justify-between gap-2"><span class="text-xs">${costHtml(t.cost, w.res)}</span><button data-research="${id}" class="btn-primary btn-sm" ${can ? '' : 'disabled'}>Research</button></div>`}
      </div>`;
    }).join(''));
  }

  // ---------------------------------------------------------------- structure inspector
  setDetail(d) { this.detail = d; cache.delete('in-body.html'); }

  renderInspect(open) {
    set('inspect', 'hidden', !open || !this.detail);
    if (!open || !this.detail) return;
    const d = this.detail, def = STRUCTURES[d.kind];
    const w = this.world;
    set('in-title', 'text', def.name);
    set('in-sub', 'text', `Level ${d.level} / ${d.maxLevel}${def.tsize ? ` · ${def.tsize === 'S' ? 'Small' : def.tsize === 'M' ? 'Medium' : 'Large'} turret` : ''}${d.mounted ? ' · wall-mounted (+25% range)' : ''}`);
    const rows = [];
    const row = (label, cur, next, unit = '', better = 'up', digits = 1) => {
      let delta = '';
      if (next !== null && next !== undefined && Math.abs(next - cur) > 1e-6) {
        const diff = next - cur;
        const good = better === 'up' ? diff > 0 : diff < 0;
        delta = `<span class="${good ? 'text-emerald-400' : 'text-blood-400'}">${diff > 0 ? '+' : ''}${fmt(diff, digits)}${unit} → ${fmt(next, digits)}${unit}</span>`;
      }
      rows.push(`<tr><td class="py-0.5 pr-2 text-zinc-400">${label}</td><td class="pr-2 font-semibold">${fmt(cur, digits)}${unit}</td><td class="text-right text-xs">${delta}</td></tr>`);
    };
    row('Hit points', d.maxHp, d.nextHp, '', 'up', 0);
    if (d.stats) {
      const s = d.stats, n = d.next;
      row('Damage', s.damage, n?.damage);
      row('Fire rate', 1 / s.cooldown, n ? 1 / n.cooldown : null, '/s');
      row('Range', s.range, n?.range, '', 'up', 0);
      row('Energy / shot', s.shot, n?.shot, '⚡', 'down', 2);
      if (s.splash) row('Splash radius', s.splash, n?.splash, '', 'up', 0);
      if (s.chains) row('Chain targets', s.chains, n?.chains, '', 'up', 0);
      if (s.pierce) row('Pierces', s.pierce, n?.pierce, '', 'up', 0);
      if (s.crit) row('Crit chance', s.crit * 100, n ? n.crit * 100 : null, '%', 'up', 0);
      if (s.shieldMax) row('Turret shield', s.shieldMax, n?.shieldMax, '', 'up', 0);
    }
    if (d.power?.output !== undefined && def.supply) row('Output', d.power.output, d.supplyNext ?? null, '⚡/s');
    if (def.capacity) row('Capacity', d.power.capacity, d.capacityNext ?? null, '⚡', 'up', 0);
    const parts = [`<table class="w-full text-sm">${rows.join('')}</table>`];
    if (def.turret) parts.push(`<p class="text-sm">Kills: <span class="font-display text-lg text-amber-300">${d.kills}</span></p>`);
    if (d.upgradeCost) {
      const can = canAfford(w.res, d.upgradeCost);
      parts.push(`<div class="flex items-center justify-between gap-2 rounded-lg bg-zinc-950/60 p-2"><span class="text-xs">Upgrade: ${costHtml(d.upgradeCost, w.res)}</span><button data-in="upgrade" class="btn-primary btn-sm" ${can ? '' : 'disabled'}>Upgrade [U]</button></div>`);
    } else parts.push('<p class="text-xs text-amber-300">Maximum level reached</p>');
    if (d.modules) {
      const owned = MODULE_IDS.filter((m) => (w.mods[m] || 0) > 0);
      parts.push(`<div><p class="mb-1 text-[11px] uppercase tracking-widest text-zinc-500">Module slots</p>${d.modules.map((m, i) => `
        <div class="mb-1 flex items-center justify-between gap-2 rounded bg-zinc-950/60 px-2 py-1">
          <span class="text-xs" style="color:${m ? MODULES[m].color : '#71717a'}">${m ? `${MODULES[m].name} - ${MODULES[m].desc}` : 'Empty slot'}</span>
          ${m ? `<button data-in="unmod" data-slot="${i}" class="btn-ghost btn-sm">Remove</button>`
            : owned.length ? `<select data-in="mod" data-slot="${i}" class="input w-32 py-0.5 text-xs"><option value="">Install...</option>${owned.map((o) => `<option value="${o}">${MODULES[o].name} (${w.mods[o]})</option>`).join('')}</select>`
              : '<span class="text-[10px] text-zinc-600">find modules in ruins</span>'}
        </div>`).join('')}</div>`);
    }
    if (d.power) {
      const p = d.power;
      const status = !d.built ? 'Under construction' : p.powered ? (p.starved ? 'Powered - not enough energy to fire' : p.flicker ? 'Brownout - flickering' : 'Powered') : 'NO POWER';
      parts.push(`<div class="rounded-lg bg-zinc-950/60 p-2 text-xs">
        <p class="${p.powered ? 'text-emerald-300' : 'text-blood-400'} font-semibold">⚡ ${status}</p>
        ${p.draw ? `<p class="text-zinc-400">Draws ${fmt(p.draw, 1)}/s idle${d.stats ? ` + ${fmt(d.stats.shot, 2)} per shot` : ''}</p>` : ''}
        <p class="text-zinc-400">Network: ${fmt(p.network[0], 1)} generated · ${fmt(p.network[2], 1)} used · ${p.network[3]}/${p.network[4]} stored · ${p.network[6]} buildings</p>
        <p class="text-zinc-400">${p.wires} wire${p.wires === 1 ? '' : 's'} connected</p>
        <div class="mt-1 flex gap-1"><button data-in="wire" class="btn-secondary btn-sm">Wire from here [V]</button><button data-in="unwire" class="btn-ghost btn-sm">Cut wires</button></div>
      </div>`);
    }
    if (d.buffer && Object.keys(d.buffer).length) parts.push(`<p class="text-xs text-amber-200">Buffered ore: ${Object.entries(d.buffer).map(([k, v]) => `${v} ${k}`).join(', ')} (Hauler Bots collect it)</p>`);
    if (d.kind !== 'elevator') parts.push('<button data-in="demolish" class="btn-ghost btn-sm text-blood-400">Demolish (50% refund) [X]</button>');
    set('in-body', 'html', parts.join(''));
  }

  // ---------------------------------------------------------------- messages
  feed(text, kind = 'info') {
    const el = document.createElement('div');
    const color = { bad: 'border-blood-500 text-blood-400', good: 'border-toxic-500 text-toxic-400', wave: 'border-amber-400 text-amber-300', level: 'border-sky-400 text-sky-300' }[kind] || 'border-zinc-500 text-zinc-200';
    el.className = `hud-box border-l-4 px-2 py-1 transition-all duration-500 ${color}`;
    el.style.transform = 'translateX(-20px)'; el.style.opacity = '0';
    el.textContent = text;
    $('feed').prepend(el);
    requestAnimationFrame(() => { el.style.transform = ''; el.style.opacity = '1'; });
    while ($('feed').children.length > 6) $('feed').lastChild.remove();
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }, 6000);
  }

  banner(title, sub = '', color = '#fcd34d') {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-title').style.color = color;
    $('banner-sub').textContent = sub;
    el.classList.remove('hidden');
    el.animate([
      { opacity: 0, transform: 'scale(1.6)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', offset: 0.15 },
      { opacity: 1, transform: 'scale(1.02)', offset: 0.8 },
      { opacity: 0, transform: 'scale(0.95) translateY(-20px)' },
    ], { duration: 2600, easing: 'ease-out' }).onfinish = () => el.classList.add('hidden');
  }

  chat(name, text) {
    const li = document.createElement('li');
    li.className = 'hud-box px-2 py-0.5 w-fit max-w-full';
    li.innerHTML = `<span class="font-semibold text-amber-300">${esc(name)}:</span> ${esc(text)}`;
    $('chat-log').append(li);
    while ($('chat-log').children.length > 6) $('chat-log').firstChild.remove();
    setTimeout(() => li.remove(), 15000);
  }

  center(title, sub = '') {
    set('center-msg', 'hidden', !title);
    set('center-title', 'text', title || '');
    set('center-sub', 'text', sub);
  }

  // ---------------------------------------------------------------- per-frame update
  update(dt, view) {
    const w = this.world;
    const s = w.snap;
    const me = w.me;
    if (!s || !me) return;

    set('phase-label', 'text', s.ph === 'build' ? 'Build phase' : s.ph === 'wave' ? 'Under attack' : s.ph === 'victory' ? 'Victory' : 'Game over');
    set('wave-num', 'text', String(s.w));
    set('phase-timer', 'text', s.ph === 'wave' ? String(s.left) : String(s.pt));
    set('phase-sub', 'text', s.ph === 'wave' ? 'hostiles left' : s.ph === 'build' ? `until wave ${s.w + 1}` : 'new colony soon');
    set('layer-label', 'text', LAYER_NAMES[w.layer].toUpperCase());
    const sunPct = Math.round((s.sun ?? 0) * 100);
    set('env-label', 'text', w.layer > 0 ? 'Underground · no sunlight' : `${sunPct > 40 ? '☀ Day' : sunPct > 0 ? '☼ Dusk' : '☾ Night'} ${sunPct}% · ${s.wx === 'storm' ? 'Solar storm' : s.wx === 'dust' ? 'Dust' : 'Clear'}`);
    set('tf-text', 'text', `${s.tf.toFixed(2)}%`);
    set('tf-bar', 'width', `${Math.min(100, s.tf)}%`);
    set('hq-text', 'text', `${s.hq[0]} / ${s.hq[1]}${s.hq[4] ? '' : ' · NO POWER'}`);
    set('hq-bar', 'width', `${(s.hq[0] / s.hq[1]) * 100}%`);

    let boss = null;
    for (const z of w.enemies.values()) if (z.flags & 8) { boss = z; break; }
    set('boss-box', 'hidden', !boss);
    if (boss) { set('boss-name', 'text', ENEMIES[boss.type].name); set('boss-text', 'text', `${boss.hp}%`); set('boss-bar', 'width', `${boss.hp}%`); }

    // stockpile (with storage fill bars)
    const cap = s.cap || 2000;
    set('res', 'html', RES_IDS.map((k) => {
      const ore = w.ore[k] || 0, v = w.res[k] || 0, capped = !UNCAPPED.has(k);
      const frac = capped ? Math.min(1, v / cap) : 0;
      const full = capped && frac >= 0.999;
      return `<div><div class="flex items-center justify-between"><span><span class="font-bold" style="color:${RESOURCES[k].color}">${RESOURCES[k].icon}</span> <span class="text-zinc-300 text-sm">${RESOURCES[k].name}</span></span><span class="font-semibold ${full ? 'text-blood-400' : ''}">${v.toLocaleString()}${ore ? `<span class="text-xs text-orange-300"> +${ore}</span>` : ''}</span></div>
        ${capped ? `<div class="bar mt-0.5 h-1.5"><span style="width:${frac * 100}%;background:${full ? '#ef4444' : RESOURCES[k].color}"></span></div>` : ''}</div>`;
    }).join(''));
    set('refine-rate', 'text', `refining ${s.rr}/s`);
    const fullOnes = RES_IDS.filter((k) => !UNCAPPED.has(k) && (w.res[k] || 0) >= cap);
    set('storage-note', 'html', `Storage ${cap.toLocaleString()} each${fullOnes.length ? ` · <span class="text-blood-400">${fullOnes.map((k) => RESOURCES[k].name).join(', ')} full - build a Warehouse</span>` : ' · Warehouses add more'}`);

    // colony dome
    if (s.dome) {
      const [rad, maxRad, sh, shMax, up, lvl, grace] = s.dome;
      set('dome-label', 'text', `${DOME[lvl].name} shield`);
      set('dome-text', 'text', up ? `${sh} / ${shMax}` : grace > 0 ? `DOWN · decompression in ${grace}s` : 'DOWN · BUILDINGS DECOMPRESSING');
      set('dome-bar', 'width', `${(sh / shMax) * 100}%`);
      const f = sh / shMax;
      $('dome-bar').style.background = f < 0.1 ? '#ef4444' : f < 0.4 ? '#f59e0b' : 'linear-gradient(90deg,#0ea5e9,#67e8f9)';
      set('dome-sub', 'text', `Atmosphere ${(rad / TILE).toFixed(1)} / ${maxRad / TILE} tiles${rad < maxRad ? ' · expanding' : ''} · upgrade it at the HQ (Q)`);
      $('dome-box').classList.toggle('border-blood-500', !up);
      $('dome-box').classList.toggle('animate-pulse', !up);
    }
    const mods = MODULE_IDS.filter((m) => w.mods[m] > 0).map((m) => `${MODULES[m].name} x${w.mods[m]}`).join(' · ');
    set('mods', 'text', mods ? `Modules: ${mods}` : '');

    // vitals
    set('lives', 'text', '♥'.repeat(me.l) + '♡'.repeat(Math.max(0, 3 - me.l)));
    set('my-level', 'text', String(me.lv));
    set('my-kills', 'text', String(me.k));
    set('hp-text', 'text', `${me.hp} / ${me.mhp}`);
    set('hp-bar', 'width', `${(me.hp / me.mhp) * 100}%`);
    set('shield-wrap', 'hidden', !me.msh);
    if (me.msh) { set('sh-text', 'text', `${me.sh} / ${me.msh}`); set('sh-bar', 'width', `${(me.sh / me.msh) * 100}%`); }
    set('o2-text', 'text', `${me.o2}s${me.io ? ' · refilling' : ''}`);
    set('o2-bar', 'width', `${(me.o2 / me.mo2) * 100}%`);
    set('o2-label', 'text', me.o2 < me.mo2 * 0.25 ? 'OXYGEN LOW - get back inside the dome' : 'Suit oxygen');
    set('st-bar', 'width', `${(me.st / me.mst) * 100}%`);
    const packTotal = Object.values(me.pk || {}).reduce((a, b) => a + b, 0);
    set('tool-name', 'text', MINING_TOOL[me.tl || 0].name);
    set('pack', 'html', packTotal ? `${Object.entries(me.pk).map(([k, v]) => `<span style="color:${RESOURCES[k].color}">${RESOURCES[k].icon} ${v}</span>`).join(' ')} <span class="text-zinc-500">(${packTotal}/${me.pc || 60})</span>` : '<span class="text-zinc-500">empty</span>');
    set('elevated', 'hidden', !me.el);
    set('buffs', 'html', Object.entries(me.b).map(([k, t]) => `<span class="chip text-black" style="background:${PERKS[k].color}">${PERKS[k].name} ${t}s</span>`).join(''));

    set('weapons', 'html', me.u.map((wid, i) => {
      const wp = WEAPONS[wid];
      const active = i === me.c;
      const ammo = active && wp.kind === 'ranged' ? (me.b.infinite_ammo ? '∞' : `${me.mag}/${me.res}`) : '';
      return `<div class="hud-box min-w-[64px] px-2 py-1 text-center transition ${active ? 'scale-110 border-amber-400 bg-amber-400/15' : 'opacity-70'}">
        <p class="text-[10px] text-zinc-400">${i + 1}</p><p class="text-xs font-bold" style="color:${wp.color}">${wp.name}</p>
        <p class="font-display text-sm leading-tight">${ammo}</p></div>`;
    }).join(''));
    set('consumables', 'html', Object.entries(CONSUMABLES).map(([k, c], i) =>
      `<span class="hud-box px-2 py-0.5"><span class="kbd">${c.key}</span> ${c.name} <b class="text-amber-300">${me.cs[i]}</b></span>`).join(''));
    set('reload-wrap', 'hidden', !me.rl);
    set('reload-bar', 'width', `${me.rl * 100}%`);

    const pingCol = (ms) => (ms < 80 ? 'text-toxic-400' : ms < 160 ? 'text-amber-300' : 'text-blood-400');
    set('net-line', 'html', `<span class="text-toxic-400">●</span> Connected · ${w.players.size}/5 colonists · your ping <b class="${pingCol(w.ping || 0)}">${w.ping || '-'} ms</b>`);
    set('team', 'html', [...w.players.values()].map((p) => `<li class="flex items-center justify-between gap-2">
      <span class="truncate" style="color:${playerColor(p.id)}">${esc(p.n)} <span class="text-zinc-500">Lv${p.lv}</span>${p.gd ? ' <span class="text-fuchsia-300">GOD</span>' : ''} <span class="${pingCol(p.pg || 0)} text-[10px]">${p.pg || 0}ms</span></span>
      <span class="shrink-0 text-zinc-400">${p.L ? `<span class="text-amber-300">D${p.L}</span> ` : ''}${p.s ? 'spectating' : p.d ? 'down' : `${p.k}k`} ${s.ph === 'build' && p.r ? '<span class="text-toxic-400">✔</span>' : ''}</span></li>`).join(''));
    set('ready-btn', 'text', me.r ? 'Ready ✔ [Space]' : 'Ready [Space]');

    this.updatePower(s.pw, s);

    // contextual hints
    let hint = '';
    if (!view.build && !view.wire && (w.layer > 0 || view.rockNear)) hint = packTotal >= (me.pc || 60) ? 'Backpack full - take it to the HQ or a lift' : 'Hold right mouse on rock to mine · it goes in your backpack';
    if (view.poiNear) hint = 'Press E to recover what is inside';
    set('interact-hint', 'hidden', !hint);
    set('interact-hint', 'text', hint);
    const mode = view.wire ? (view.wireFrom != null ? 'WIRE TOOL: click a second building to connect (right-click cancels)' : 'WIRE TOOL: click a building to start a wire (V or Esc to exit)') : '';
    set('mode-hint', 'hidden', !mode);
    set('mode-hint', 'text', mode);

    if (view.hover && !this.detail) {
      const st = view.hover, d = STRUCTURES[st.kind];
      const lines = [`<p class="font-bold">${d.name} <span class="text-amber-400">Lv${st.level}</span></p>`, `<p>HP ${st.hp}%${!st.built ? ` · building ${st.progress}%` : ''}</p>`];
      if (d.draw || d.turret) lines.push(`<p class="${st.powered ? 'text-toxic-400' : 'text-blood-400'}">${st.powered ? (st.starved ? 'Low energy' : 'Powered') : 'NO POWER - wire it to the grid'}</p>`);
      if (d.supply) lines.push(`<p class="text-yellow-300">Producing ${(st.output || 0).toFixed(1)}⚡/s</p>`);
      if (d.capacity) lines.push(`<p class="text-green-300">Charge ${st.charge}%</p>`);
      lines.push('<p class="text-zinc-400">Click or U to inspect · X demolish</p>');
      set('hover-info', 'html', lines.join(''));
      const el = $('hover-info');
      el.style.left = `${view.mouse.x + 16}px`; el.style.top = `${view.mouse.y + 16}px`;
    }
    set('hover-info', 'hidden', !view.hover || !!this.detail);

    if (s.ph === 'gameover' || s.ph === 'victory') this.center('');
    else if (me.s) this.center('SPECTATING', 'Out of lives - you will respawn when the wave ends. Click to cycle colonists.');
    else if (me.d) this.center('SUIT FAILURE', `Respawning in ${me.ra}s · ${me.l} ${me.l === 1 ? 'life' : 'lives'} left`);
    else this.center('');

    this.renderShop(me);
    this.renderLift();
    this.renderCharacter(me);
    this.miniTimer -= dt;
    if (this.miniTimer <= 0) { this.miniTimer = 0.15; this.drawMinimap(view); }
  }

  // Rolling history of generation vs actual draw (base load + turret fire), drawn as a graph.
  drawPowerGraph(supply, draw) {
    const now = performance.now();
    const hist = this.pwHist || (this.pwHist = []);
    if (!this.pwHistAt || now - this.pwHistAt > 500) { this.pwHistAt = now; hist.push([supply, draw]); if (hist.length > 120) hist.shift(); }
    const c = $('pw-graph');
    if (!c) return;
    const g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const peak = Math.max(1, ...hist.map(([a, b]) => Math.max(a, b))) * 1.15;
    const X = (i) => (i / 119) * W, Y = (v) => H - (v / peak) * (H - 4) - 1;
    const off = 120 - hist.length;
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, (H * k) / 4); g.lineTo(W, (H * k) / 4); g.stroke(); }
    if (hist.length < 2) return;
    g.beginPath(); g.moveTo(X(off), H);
    hist.forEach(([, b], i) => g.lineTo(X(off + i), Y(b)));
    g.lineTo(X(119), H); g.closePath();
    g.fillStyle = 'rgba(251,146,60,0.35)'; g.fill();
    g.strokeStyle = '#fb923c'; g.lineWidth = 1.5; g.beginPath();
    hist.forEach(([, b], i) => (i ? g.lineTo(X(off + i), Y(b)) : g.moveTo(X(off + i), Y(b)))); g.stroke();
    g.strokeStyle = '#fde047'; g.lineWidth = 2; g.beginPath();
    hist.forEach(([a], i) => (i ? g.lineTo(X(off + i), Y(a)) : g.moveTo(X(off + i), Y(a)))); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '10px sans-serif'; g.textAlign = 'right';
    g.fillText(`${peak.toFixed(0)}⚡/s`, W - 3, 10);
  }

  updatePower(pw, s) {
    const [supply, demand, used, stored, capacity, flow, nodes, dark, shots, status] = pw;
    this.drawPowerGraph(supply, used + shots);
    const pct = (a, b) => `${b > 0 ? Math.min(100, (a / b) * 100) : 0}%`;
    const peak = Math.max(supply, demand, 1);
    set('pw-net', 'text', `(${s.nets} network${s.nets === 1 ? '' : 's'})`);
    set('pw-sun', 'text', this.world.layer > 0 ? 'Underground grid' : `Sunlight ${Math.round((s.sun ?? 0) * 100)}%`);
    set('pw-nodes', 'text', `${nodes} connected`);
    set('pw-gen-text', 'text', `${supply.toFixed(1)}⚡/s`);
    set('pw-gen-bar', 'width', pct(supply, peak));
    set('pw-use-text', 'text', `${used.toFixed(1)} / ${demand.toFixed(1)}`);
    set('pw-use-bar', 'width', pct(used, peak));
    set('pw-shots', 'text', `Turret fire: ${shots.toFixed(1)}⚡/s`);
    set('pw-bat-text', 'text', capacity ? `${stored} / ${capacity}` : 'no batteries');
    set('pw-bat-bar', 'width', pct(stored, capacity));
    let rate;
    if (!capacity) rate = 'Build batteries to store daytime solar for the night';
    else if (flow > 0.05) rate = `Charging +${flow.toFixed(1)}/s${stored < capacity ? ` · full in ${Math.ceil((capacity - stored) / flow)}s` : ''}`;
    else if (flow < -0.05) rate = `Draining ${flow.toFixed(1)}/s · ~${Math.floor(stored / -flow)}s left`;
    else rate = stored >= capacity - 1 ? 'Full' : 'Holding';
    set('pw-bat-rate', 'text', rate);
    set('pw-offline', 'text', dark ? `${dark} building${dark === 1 ? '' : 's'} dark or flickering - add solar or batteries` : 'All buildings powered');
    const st = [['STABLE', 'chip bg-toxic-500/20 text-toxic-400'], ['ON BATTERY', 'chip bg-amber-400/20 text-amber-300'], ['BROWNOUT', 'chip bg-orange-500/20 text-orange-300 animate-pulse'], ['BLACKOUT', 'chip bg-blood-500/30 text-blood-400 animate-pulse']][status];
    set('pw-status', 'text', st[0]);
    const el = $('pw-status');
    if (el && el.className !== st[1]) el.className = st[1];
  }

  // Fog of war: the minimap only shows ground someone in the crew has been near (per level).
  updateFog(L, W, H) {
    const w = this.world;
    this.fogs ||= {};
    const cw = Math.ceil(L.w / FOG_CELL), chh = Math.ceil(L.h / FOG_CELL);
    let fog = this.fogs[w.layer];
    if (!fog || fog.cw !== cw || fog.canvas.width !== W) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d'); g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
      fog = this.fogs[w.layer] = { mask: new Uint8Array(cw * chh), cw, ch: chh, canvas, g };
    }
    const reveal = (x, y, r) => {
      const cx = x / TILE / FOG_CELL, cy = y / TILE / FOG_CELL, rc = r / FOG_CELL;
      for (let j = Math.max(0, Math.floor(cy - rc)); j <= Math.min(chh - 1, Math.ceil(cy + rc)); j++) {
        for (let i = Math.max(0, Math.floor(cx - rc)); i <= Math.min(cw - 1, Math.ceil(cx + rc)); i++) {
          if (fog.mask[j * cw + i] || (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > rc * rc) continue;
          fog.mask[j * cw + i] = 1;
          fog.g.clearRect(Math.floor((i * W) / cw), Math.floor((j * H) / chh), Math.ceil(W / cw) + 1, Math.ceil(H / chh) + 1);
        }
      }
    };
    for (const p of w.players.values()) if (!p.d && p.L === w.layer) reveal(p.rx, p.ry, w.layer ? 9 : 16);
    if (w.layer === 0 && w.snap?.dome) reveal(w.hq.x, w.hq.y, w.snap.dome[0] / TILE + 2);
    return fog;
  }

  drawMinimap(view) {
    const c = this.mini, w = this.world;
    const L = w.L();
    if (!L) return;
    const W = c.canvas.width, H = c.canvas.height, sx = W / (L.w * TILE), sy = H / (L.h * TILE);
    const key = `${w.layer}:${L.version}:${w.version}`;
    if (key !== this.miniKey && (!this.miniBgAt || performance.now() - this.miniBgAt > 500)) {
      this.miniKey = key; this.miniBgAt = performance.now();
      const bg = this.miniBg || document.createElement('canvas');
      bg.width = W; bg.height = H;
      const g = bg.getContext('2d');
      g.fillStyle = w.layer ? '#1c1917' : '#2a2520'; g.fillRect(0, 0, W, H);
      const cw = W / L.w, ch = H / L.h;
      for (let ty = 0; ty < L.h; ty++) for (let tx = 0; tx < L.w; tx++) {
        const t = L.terrain[ty * L.w + tx];
        let col = null;
        if (w.layer === 0) col = t === S_RIDGE ? '#a8957f' : t === S_RUIN ? '#38bdf8' : t === S_ICE ? '#64748b' : t === S_VENT ? '#c2410c' : t === S_CRATER ? '#3f3a36' : null;
        else col = t === U_FLOOR ? '#0c0a09' : t === U_RUIN_FLOOR ? '#3f3a2e' : t === U_BEDROCK ? '#000' : isOreTile(t) ? RESOURCES[oreOfTile(t)].color : '#44403c';
        if (col) { g.fillStyle = col; g.fillRect(tx * cw, ty * ch, cw + 0.5, ch + 0.5); }
      }
      this.miniBg = bg;
    }
    c.clearRect(0, 0, W, H);
    if (this.miniBg) c.drawImage(this.miniBg, 0, 0);
    const fog = this.updateFog(L, W, H);
    const seen = (x, y) => fog.mask[Math.floor(y / TILE / FOG_CELL) * fog.cw + Math.floor(x / TILE / FOG_CELL)];
    c.drawImage(fog.canvas, 0, 0);
    for (const st of w.structures.values()) { c.fillStyle = STRUCTURES[st.kind].color; const n = st.def.size || 1; c.fillRect(st.tx * TILE * sx, st.ty * TILE * sy, Math.max(2, n * TILE * sx), Math.max(2, n * TILE * sy)); }
    if (w.layer === 0) { c.fillStyle = '#dc2626'; c.fillRect(w.hq.x * sx - 4, w.hq.y * sy - 4, 8, 8); }
    for (const poi of w.pois) if (!poi.looted && seen(poi.x, poi.y)) { c.fillStyle = poi.kind === 'probe' ? '#fbbf24' : '#38bdf8'; c.beginPath(); c.arc(poi.x * sx, poi.y * sy, 2.5, 0, 7); c.fill(); }
    c.fillStyle = '#ef4444';
    for (let i = 0; i < w.mm.length; i += 2) if (seen(w.mm[i] * TILE, w.mm[i + 1] * TILE)) c.fillRect(w.mm[i] * TILE * sx - 1, w.mm[i + 1] * TILE * sy - 1, 2, 2);
    for (const z of w.enemies.values()) if (z.flags & 8) { c.fillStyle = '#fde047'; c.fillRect(z.rx * sx - 3, z.ry * sy - 3, 6, 6); }
    for (const p of w.players.values()) {
      if (p.d || p.L !== w.layer) continue;
      c.fillStyle = playerColor(p.id); c.beginPath(); c.arc(p.rx * sx, p.ry * sy, p.id === w.you ? 3.5 : 2.5, 0, 7); c.fill();
    }
    const cam = view.cam;
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1;
    c.strokeRect(cam.x * sx, (cam.y / 0.72) * sy, view.size.w * sx, (view.size.h / 0.72) * sy);
  }
}

export { ORE_IDS, ROBOTS, costText };
