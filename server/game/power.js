// Wired power networks.
//
// Buildings only share power when wires connect them (directly or through other buildings and
// pylons). Linked elevators carry power between layers. Every POWER_TICK each network:
//   1. settles the previous interval's energy into/out of its batteries,
//   2. sums producer output (solar follows the sun),
//   3. powers consumers in priority order (0 life support -> 3 industry). The priority group
//      where energy runs out flickers (each building powered at random with the fraction that
//      fits); everything below it goes dark,
//   4. leaves the surplus + battery discharge as a budget that turrets spend per shot.
import { STRUCTURES, isElectric, wireRangeOf, supplyAt, capacityAt, idleDraw, POWER_ROLES, ROLE_NAMES, roleOf, defaultRoles, DIRT_LOSS } from '../../shared/defs.js';

const ALL_ROLES = Object.fromEntries(POWER_ROLES.map((r) => [r, true]));

export const POWER_TICK = 0.25;
export const HQ_NODE = 0; // pseudo node id for the HQ (draws life support, holds a small reserve)
const HQ_DRAW = 1; // plus the colony dome's draw, which grows with its level
const HQ_RESERVE = 120;
const MAX_WIRES_PER_NODE = 8;

export class PowerGrid {
  constructor(room) {
    this.room = room;
    this.wires = []; // { a, b } structure ids (HQ_NODE for the HQ)
    this.networks = [];
    this.byNode = new Map(); // node id -> network
    this.hqCharge = HQ_RESERVE;
    this.version = 0;
    this.warned = new Set();
  }

  node(id) {
    if (id === HQ_NODE) return this.room.hqNode();
    return this.room.structures.get(id) || null;
  }

  canWire(a, b) {
    if (!a || !b || a === b || a.layer !== b.layer) return 'Both ends must be on the same level';
    if (!isElectric(a.def) || !isElectric(b.def)) return 'Only powered buildings can be wired';
    const range = Math.max(wireRangeOf(a.def), wireRangeOf(b.def));
    if (Math.hypot(a.x - b.x, a.y - b.y) > range) return `Too far for a wire (max ${Math.round(range / 32)} tiles; use pylons)`;
    if (this.wires.some((w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id))) return 'Already wired';
    const full = (id) => id !== HQ_NODE && this.degree(id) >= MAX_WIRES_PER_NODE; // the HQ is the main bus
    if (full(a.id) || full(b.id)) return 'Too many wires on one building';
    return null;
  }

  degree(id) { return this.wires.reduce((n, w) => n + (w.a === id || w.b === id ? 1 : 0), 0); }

  connect(aId, bId) {
    const err = this.canWire(this.node(aId), this.node(bId));
    if (err) return err;
    this.wires.push({ a: aId, b: bId });
    this.version++;
    return null;
  }

  disconnectAll(id) {
    const before = this.wires.length;
    this.wires = this.wires.filter((w) => w.a !== id && w.b !== id);
    if (this.wires.length !== before) this.version++;
  }

  // Auto-wire a new building to the closest electric node in range (prefers pylons/power gear).
  autoConnect(s) {
    if (!isElectric(s.def)) return;
    let best = null, bd = Infinity;
    const consider = (n) => {
      if (!n || n === s || n.layer !== s.layer || !isElectric(n.def)) return;
      const d = Math.hypot(n.x - s.x, n.y - s.y) * (n.def.wireRange || n.def.supply || n.def.capacity ? 0.8 : 1);
      if (d < bd && !this.canWire(s, n)) { bd = d; best = n; }
    };
    for (const n of this.room.structures.values()) consider(n);
    consider(this.room.hqNode());
    if (best) this.connect(s.id, best.id);
  }

  // ------------------------------------------------------------------ solve
  // Battery roles: every battery serves the systems ticked on it (shield, weapons, refining,
  // research, general). A system short on generation drains, in order: batteries with every role
  // ticked (evenly), then batteries dedicated to it, then reserve batteries (emergency only).
  solve(dt) {
    const room = this.room;
    // 1. settle turret fire from the last interval: spare generation first, then weapons batteries
    for (const net of this.networks) {
      const shots = Math.max(0, net.shotUsed - net.spare);
      if (shots > 0) this.drain(net.batteries, 'weapons', shots, true);
    }

    // 2. build networks (union-find over wires + elevator links)
    const nodes = [room.hqNode(), ...[...room.structures.values()].filter((s) => isElectric(s.def))];
    const parent = new Map(nodes.map((n) => [n.id, n.id]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
    this.wires = this.wires.filter((w) => parent.has(w.a) && parent.has(w.b));
    for (const w of this.wires) union(w.a, w.b);
    for (const s of nodes) if (s.link && s.built && parent.has(s.link)) union(s.id, s.link);

    const groups = new Map();
    for (const n of nodes) {
      const r = find(n.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(n);
    }
    this.networks = [];
    this.byNode.clear();
    for (const members of groups.values()) {
      const net = { id: this.networks.length + 1, members, supply: 0, demand: 0, used: 0, surplus: 0, budget: 0, shotUsed: 0, spare: 0,
        stored: 0, capacity: 0, rate: 0, batteries: [], brownout: false, dark: 0, offline: 0, layers: new Set(),
        prod: { solar: 0, geo: 0, fusion: 0, other: 0 }, roles: Object.fromEntries(POWER_ROLES.map((r) => [r, { demand: 0, used: 0, fromBat: 0, stored: 0, cap: 0 }])) };
      for (const n of members) {
        this.byNode.set(n.id, net);
        net.layers.add(n.layer);
        const d = n.def;
        if (n.id === HQ_NODE) {
          net.batteries.push({ ref: 'hq', cap: HQ_RESERVE, rate: 10, roles: ALL_ROLES, reserve: true, all: false });
          continue;
        }
        if (!n.built) continue;
        if (d.supply) {
          let out = supplyAt(n.kind, n.level);
          if (d.solar) out *= room.sun * (room.weather === 'dust' ? 0.7 : room.weather === 'storm' ? 0.5 : 1) * (1 - DIRT_LOSS * (n.dirt || 0));
          if (d.burns && !Object.entries(d.burns).every(([k, v]) => (room.res[k] || 0) >= v * dt)) out = 0;
          else if (d.burns && out > 0) for (const [k, v] of Object.entries(d.burns)) room.res[k] -= v * dt;
          n.output = out;
          net.supply += out;
          net.prod[d.solar ? 'solar' : d.geo ? 'geo' : n.kind === 'fusion' ? 'fusion' : 'other'] += out;
        }
        if (d.capacity) {
          const cap = capacityAt(n.kind, n.level);
          n.capacity = cap;
          n.charge = Math.min(n.charge || 0, cap);
          const roles = n.roles || (n.roles = defaultRoles());
          net.batteries.push({ ref: n, cap, rate: d.rate * (1 + 0.5 * (n.level - 1)), roles, reserve: !!roles.reserve, all: POWER_ROLES.every((r) => roles[r]) && !roles.reserve });
        }
      }
      for (const b of net.batteries) {
        b.left = b.rate * dt; // how much this battery may still move this tick
        const c = this.chargeOf(b);
        net.stored += c; net.capacity += b.cap; net.rate += b.rate;
        for (const r of POWER_ROLES) if (b.roles[r]) { net.roles[r].stored += c; net.roles[r].cap += b.cap; }
      }

      // 3. power consumers by priority: generation first, then each system's batteries
      const consumers = members.filter((n) => n.id === HQ_NODE || (n.built && n.def.draw)).sort((a, b) => (a.def.prio ?? 3) - (b.def.prio ?? 3) || a.id - b.id);
      let gen = net.supply;
      for (const c of consumers) {
        const need = this.drawOf(c), role = roleOf(c);
        const R = net.roles[role];
        net.demand += need; R.demand += need;
        let got = Math.min(gen, need);
        gen -= got;
        if (got < need) { const fromBat = this.drain(net.batteries, role, (need - got) * dt) / dt; got += fromBat; R.fromBat += fromBat; }
        const ratio = need > 0 ? got / need : 1;
        if (ratio >= 0.999) this.setPowered(c, true, false);
        else {
          const on = Math.random() < ratio;
          this.setPowered(c, on, ratio > 0.02);
          if (!on) net.dark++;
          net.brownout ||= ratio > 0.02;
        }
        net.used += got; R.used += got;
      }
      // 4. leftover generation charges batteries (regular ones first, reserve last)
      net.surplus = gen;
      let spare = gen * dt;
      for (const tier of [net.batteries.filter((b) => !b.reserve), net.batteries.filter((b) => b.reserve)]) {
        for (const b of [...tier].sort((p, q) => this.chargeOf(p) / p.cap - this.chargeOf(q) / q.cap)) {
          const add = Math.min(spare, b.cap - this.chargeOf(b), b.left);
          if (add <= 0) continue;
          this.setCharge(b, this.chargeOf(b) + add); b.left -= add; spare -= add;
        }
      }
      net.spare = spare; // generation nothing could store: turrets may still use it this tick
      // 5. what turrets may spend before the next solve
      net.budget = spare + this.available(net.batteries, 'weapons');
      net.offline = net.dark;
      this.networks.push(net);
    }
    // non-electric structures are always "powered"
    for (const s of room.structures.values()) if (!isElectric(s.def)) { s.powered = true; s.flicker = false; }
    this.checkWarnings();
  }

  // Batteries that may serve a role, in drain order.
  tiers(batteries, role) {
    const ok = batteries.filter((b) => b.roles[role]);
    return [ok.filter((b) => b.all), ok.filter((b) => !b.all && !b.reserve), ok.filter((b) => b.reserve)];
  }

  available(batteries, role) {
    let n = 0;
    for (const t of this.tiers(batteries, role)) for (const b of t) n += Math.min(this.chargeOf(b), b.left ?? b.rate);
    return n;
  }

  // Take an amount of energy for a role, spreading it evenly within each tier. Returns what was taken.
  drain(batteries, role, amount, ignoreRate = false) {
    let rem = amount;
    for (const tier of this.tiers(batteries, role)) {
      let live = tier.filter((b) => this.chargeOf(b) > 1e-6 && (ignoreRate || b.left > 1e-6));
      while (rem > 1e-6 && live.length) {
        const share = rem / live.length;
        for (const b of live) {
          const take = Math.min(share, this.chargeOf(b), ignoreRate ? Infinity : b.left);
          this.setCharge(b, this.chargeOf(b) - take);
          if (!ignoreRate) b.left -= take;
          rem -= take;
        }
        live = live.filter((b) => this.chargeOf(b) > 1e-6 && (ignoreRate || b.left > 1e-6));
      }
      if (rem <= 1e-6) break;
    }
    return amount - rem;
  }

  // Low-charge warnings per system (thresholds set in the power management panel).
  checkWarnings() {
    const room = this.room, warn = room.powerWarn;
    const net = this.byNode.get(HQ_NODE);
    if (!net || !warn) return;
    room.lowRoles = [];
    for (const r of POWER_ROLES) {
      const R = net.roles[r];
      if (!R.cap) continue;
      const pct = (R.stored / R.cap) * 100;
      if (pct < warn[r]) {
        room.lowRoles.push(r);
        if (!this.warned.has(r)) { this.warned.add(r); room.toast(`${ROLE_NAMES[r]} batteries below ${warn[r]}%`, 'bad'); }
      } else if (pct > warn[r] + 5) this.warned.delete(r);
    }
  }

  chargeOf(b) { return b.ref === 'hq' ? this.hqCharge : (b.ref.charge || 0); }
  setCharge(b, v) { if (b.ref === 'hq') this.hqCharge = v; else b.ref.charge = v; }

  drawOf(n) {
    if (n.id === HQ_NODE) return HQ_DRAW + this.room.domeDraw();
    if (n.kind === 'research_lab' && this.room.researching) return n.def.researchDraw * (1 + 0.25 * (n.level - 1));
    if (n.kind === 'shield_projector') return this.room.emitterDraw(n);
    return idleDraw(n.def) * (1 + 0.15 * ((n.level || 1) - 1));
  }

  setPowered(n, on, flicker) {
    if (n.id === HQ_NODE) { this.room.hq.powered = on; return; }
    n.powered = on;
    n.flicker = flicker;
  }

  // Turret shots spend energy from their network; false = not enough energy to fire.
  drawEnergy(s, amount) {
    const net = this.byNode.get(s.id);
    if (!net || !s.powered || net.budget < amount) { s.starved = true; return false; }
    net.budget -= amount;
    net.shotUsed += amount;
    s.starved = false;
    return true;
  }

  networkOf(id) { return this.byNode.get(id) || null; }

  // Numbers for the HUD power panel.
  summary(net, dt = POWER_TICK) {
    if (!net) return null;
    const shotRate = net.shotUsed / dt;
    const flow = net.surplus - shotRate - net.spare / dt; // + charging, - draining
    const status = net.used === 0 && net.demand > 0 ? 3 : net.brownout || net.dark ? 2 : flow < -0.05 ? 1 : 0;
    const r1 = (v) => Math.round(v * 10) / 10;
    return {
      supply: r1(net.supply), demand: r1(net.demand), used: r1(net.used), stored: Math.round(net.stored), cap: Math.round(net.capacity),
      flow: r1(flow), nodes: net.members.length, dark: net.dark, shots: r1(shotRate), status,
      prod: Object.fromEntries(Object.entries(net.prod).map(([k, v]) => [k, r1(v)])),
      roles: Object.fromEntries(POWER_ROLES.map((r) => { const R = net.roles[r]; return [r, [r1(R.demand + (r === 'weapons' ? shotRate : 0)), r1(R.used + (r === 'weapons' ? shotRate : 0)), r1(R.fromBat), Math.round(R.stored), Math.round(R.cap)]]; })),
      reserve: Math.round(net.batteries.filter((b) => b.reserve).reduce((n, b) => n + this.chargeOf(b), 0)),
      bats: net.batteries.filter((b) => b.ref !== 'hq').length,
    };
  }
}

export { STRUCTURES };
