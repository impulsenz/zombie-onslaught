// Building art for the 2.5D renderer. Turrets visibly evolve with every upgrade level.
import { TILE, STRUCTURES, SHOP_RANGE, MAP_W, LAYER_NAMES, RESOURCES, RES_IDS, UNCAPPED, sunPos } from '/shared/defs.js';
import { T, TAU, shade, rnd } from '../renderer.js';

// accent colours per upgrade level: grey -> steel -> gold -> crimson -> violet energy
const TIER = [null,
  { trim: '#71717a', glow: null }, { trim: '#60a5fa', glow: null }, { trim: '#fbbf24', glow: null },
  { trim: '#ef4444', glow: '#f87171' }, { trim: '#c084fc', glow: '#e9d5ff' }];

export function structHeight(st) {
  const h = (st.def.h || 0) * (1 + 0.08 * (st.level - 1));
  return st.built ? h : h * (0.2 + 0.8 * st.progress / 100);
}

export function mountLift(r, st) {
  const g = r.world.L();
  const w = r.world.structures.get(r.world.structGrid[st.ty * g.w + st.tx]);
  return w && w.def.wall ? structHeight(w) : 0;
}

const isWallLike = (s) => s && s.built && (s.def.wall || s.def.stairs);

// ------------------------------------------------------------------ main entry
export function drawStructure(r, st, now, view) {
  const { ctx } = r;
  const d = st.def;
  const S = (d.size || 1) * TILE;
  const x = st.tx * TILE, y = st.ty * TILE, cx = x + S / 2;
  const h = structHeight(st);
  const hit = st.hitAt && now - st.hitAt < 0.1;
  const base = hit ? '#e5e7eb' : d.color;
  const top = shade(base, 1.08), front = shade(base, 0.62);
  const topY = y * T - h, frontY = (y + S) * T - h;
  const electric = !!(d.draw || d.turret || d.elevator);
  const dark = electric && st.built && (!st.powered || (st.flicker && Math.random() < 0.45));
  const lift = st.mount ? mountLift(r, st) : 0;
  const age = now - st.born;
  const drop = (age < 0.3 ? (1 - age / 0.3) * 20 : 0) + lift;
  if (drop) ctx.translate(0, -drop);
  const lvl = st.level;

  switch (st.kind) {
    case 'wall_alloy': case 'wall_titan': {
      r.box(x, y, TILE, TILE, h, top, front);
      ctx.strokeStyle = shade(base, 0.45); ctx.lineWidth = 1;
      ctx.strokeRect(x + 3, frontY + 3, TILE - 6, h - 6);
      ctx.fillStyle = shade(base, 0.4);
      for (const ox of [5, 27]) for (const oy of [4, h - 6]) { ctx.beginPath(); ctx.arc(x + ox, frontY + oy, 1.4, 0, TAU); ctx.fill(); }
      if (st.kind === 'wall_titan') { ctx.fillStyle = 'rgba(147,197,253,0.18)'; ctx.fillRect(x + 2, topY + 2, TILE - 4, TILE * T - 4); }
      ctx.fillStyle = '#facc15'; ctx.fillRect(x, frontY + h - 5, TILE, 2);
      if (st.built) drawFence(r, st, x, y, h, topY);
      break;
    }
    case 'stairs': drawStairs(r, st, x, y, h, base, view); break;
    case 'solar_panel': case 'solar_array': drawSolar(r, st, x, y, S, h, topY, now); break;
    case 'battery': case 'battery_bank': drawBattery(r, st, x, y, S, h, topY, frontY, now); break;
    case 'pylon': {
      ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 2;
      const by = (y + 24) * T, ty = by - h;
      ctx.beginPath(); ctx.moveTo(cx - 9, by); ctx.lineTo(cx - 2, ty); ctx.lineTo(cx + 2, ty); ctx.lineTo(cx + 9, by);
      for (let k = 1; k < 4; k++) { const yy = by - (h * k) / 4, w2 = 9 - k * 1.8; ctx.moveTo(cx - w2, yy); ctx.lineTo(cx + w2, yy); }
      ctx.stroke();
      ctx.fillStyle = '#e5e7eb'; ctx.fillRect(cx - 12, ty + 4, 24, 3);
      ctx.fillStyle = st.powered ? `rgba(250,204,21,${0.6 + Math.sin(now * 5) * 0.3})` : '#3f3f46';
      for (const ox of [-11, 11]) { ctx.beginPath(); ctx.arc(cx + ox, ty + 3, 2.5, 0, TAU); ctx.fill(); }
      break;
    }
    case 'geothermal': {
      r.box(x + 4, y + 4, S - 8, S - 8, 12, '#57534e', '#292524');
      ctx.strokeStyle = '#78716c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 14, (y + S - 6) * T - 12); ctx.lineTo(cx, topY - 6); ctx.lineTo(cx + 14, (y + S - 6) * T - 12); ctx.stroke();
      ctx.fillStyle = dark ? '#3f1d0b' : `rgba(249,115,22,${0.6 + Math.sin(now * 3) * 0.3})`;
      ctx.beginPath(); ctx.ellipse(cx, (y + S / 2) * T - 12, 10, 5, 0, 0, TAU); ctx.fill();
      if (st.built && Math.random() < 0.5) r.smoke(cx + rnd(-8, 8), st.y, h, 1, 'rgba(230,230,230,', 9, 2);
      break;
    }
    case 'fusion': {
      r.box(x + 2, y + 2, S - 4, S - 4, 14, '#3b0764', '#1e1b4b');
      const ry = (y + S / 2) * T - 30;
      const on = !dark;
      ctx.strokeStyle = on ? `rgba(192,132,252,${0.7 + Math.sin(now * 6) * 0.3})` : '#3b0764'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.ellipse(cx, ry, 22, 10, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = on ? '#f5d0fe' : '#4c1d95'; ctx.beginPath(); ctx.arc(cx, ry - 2, 6 + (on ? Math.sin(now * 8) * 1.5 : 0), 0, TAU); ctx.fill();
      if (on) { r.flash(st.x, st.y, 120, 0.05, 30, '#c084fc'); if (Math.random() < 0.3) r.burst(st.x, st.y, 1, '#e9d5ff', 60, 2, 0.4, 30, { kind: 'spark' }); }
      break;
    }
    case 'refinery': {
      r.box(x + 2, y + 6, S - 4, S - 8, h * 0.6, '#7c2d12', '#431407');
      for (const ox of [12, S - 18]) {
        r.box(x + ox, y + 8, 7, 7, h, '#57534e', '#292524');
        if (!dark && Math.random() < 0.4) r.smoke(x + ox + 3, y + 10, h + 4, 1, 'rgba(70,70,70,', 7, 2);
      }
      ctx.fillStyle = dark ? '#1c0a04' : `rgba(251,146,60,${0.7 + Math.sin(now * 5) * 0.2})`;
      ctx.fillRect(x + 10, frontY + h * 0.45, S - 20, 6);
      if (!dark && Math.random() < 0.2) r.burst(cx, st.y + 20, 2, '#fdba74', 40, 2, 0.4, 8, { kind: 'spark' });
      break;
    }
    case 'tractor': drawTractor(r, st, x, y, S, h, topY, now, dark); break;
    case 'warehouse': drawWarehouse(r, st, x, y, S, h, topY, frontY, now, base); break;
    case 'elevator': drawElevator(r, st, x, y, S, h, topY, frontY, now, dark, view); break;
    case 'drill': {
      r.box(x + 4, y + 4, TILE - 8, TILE - 8, 12, '#78350f', '#451a03');
      const spin = !dark && st.built ? now * 12 : 0;
      ctx.save(); ctx.translate(cx, (y + 16) * T - 18);
      ctx.strokeStyle = '#d6d3d1'; ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) { const a = spin + k * 2.09; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 4); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#fbbf24'; ctx.fillRect(cx - 3, topY, 6, 8);
      if (!dark && st.built && Math.random() < 0.2) r.burst(st.x, st.y, 2, '#a8a29e', 60, 2, 0.4, 10);
      if (st.buffer) { ctx.fillStyle = '#fde68a'; ctx.font = '700 10px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText(`${st.buffer} ore`, cx, topY - 4); }
      break;
    }
    case 'borer': {
      const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][st.rot || 0];
      r.box(x + 2, y + 4, TILE - 4, TILE - 8, h, '#ca8a04', '#713f12');
      const hx = cx + dx * 16, hy = (y + 16 + dy * 14) * T - h / 2;
      const spin = !dark && st.built ? now * 10 : 0;
      ctx.fillStyle = '#44403c'; ctx.beginPath(); ctx.arc(hx, hy, 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#e7e5e4'; ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) { const a = spin + k * 1.05; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 9, hy + Math.sin(a) * 9); ctx.stroke(); }
      if (st.buffer) { ctx.fillStyle = '#fde68a'; ctx.font = '700 10px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText(`${st.buffer} ore`, cx, topY - 4); }
      break;
    }
    case 'terraformer': {
      r.box(x + 2, y + 2, S - 4, S - 4, 16, '#065f46', '#022c22');
      const by = (y + S / 2) * T - 16;
      ctx.fillStyle = '#a7f3d0'; ctx.beginPath(); ctx.moveTo(cx - 14, by); ctx.lineTo(cx - 6, by - h); ctx.lineTo(cx + 6, by - h); ctx.lineTo(cx + 14, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(cx, by - h, 8, h);
      for (let k = 0; k < 3; k++) { // spinning vanes
        const a = now * 2 + k * 2.09;
        ctx.strokeStyle = '#34d399'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx, by - h + 6); ctx.lineTo(cx + Math.cos(a) * 18, by - h + 6 + Math.sin(a) * 6); ctx.stroke();
      }
      if (!dark && st.built) for (let k = 0; k < 2; k++) r.particle({ x: st.x + rnd(-6, 6), y: st.y, z: h + 16, vx: rnd(-20, 20), vy: rnd(-20, 20), vz: rnd(60, 110), life: 2, color: Math.random() < 0.5 ? 'rgba(52,211,153,' : 'rgba(96,165,250,', size: 6, kind: 's', grow: 16 });
      break;
    }
    case 'research_lab': case 'robot_factory': case 'armory': case 'med_bay': drawBuilding(r, st, x, y, S, h, topY, frontY, now, dark, view, base); break;
    case 'o2_station': {
      for (const ox of [5, 17]) {
        r.box(x + ox, y + 8, 10, 14, h, '#cffafe', '#67e8f9');
        ctx.fillStyle = '#0e7490'; ctx.fillRect(x + ox + 2, topY + 3, 6, 2);
      }
      if (!dark && Math.random() < 0.15) r.particle({ x: st.x + rnd(-8, 8), y: st.y, z: h, vx: 0, vy: 0, vz: 30, life: 1, color: 'rgba(165,243,252,', size: 3, kind: 's', grow: 4 });
      break;
    }
    case 'repair_station': {
      r.box(x + 3, y + 3, S - 6, S - 6, h * 0.6, '#166534', '#14532d');
      r.box(x + 14, y + 12, S - 28, S - 26, h, '#15803d', '#14532d');
      ctx.fillStyle = dark ? '#3f6212' : '#4ade80';
      ctx.fillRect(cx - 4, topY + 3, 8, 18); ctx.fillRect(cx - 10, topY + 9, 20, 7);
      if (!dark && st.built) {
        ctx.save(); ctx.translate(cx, topY - 12); ctx.rotate(now * 3);
        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(-1.5, -8, 3, 16); ctx.fillRect(-5, -9, 10, 3); ctx.restore();
      }
      break;
    }
    case 'shield_projector': {
      r.box(x + 4, y + 4, S - 8, S - 8, 12, '#1e3a8a', '#172554');
      for (const [ox, oy] of [[10, 10], [S - 14, 10], [10, S - 14], [S - 14, S - 14]]) r.box(x + ox, y + oy, 4, 4, 18, '#93c5fd', '#3b82f6', 12);
      ctx.fillStyle = '#334155'; ctx.fillRect(cx - 4, topY + 8, 8, h - 18);
      const on = !dark && st.shield > 0;
      ctx.fillStyle = on ? `rgba(147,197,253,${0.6 + Math.sin(now * 5) * 0.3})` : '#1e40af';
      ctx.beginPath(); ctx.ellipse(cx, topY + 6, 16, 8, 0, 0, TAU); ctx.fill();
      r.bar(cx, (y + S) * T + 3, S - 10, (st.shield || 0) / 100, '#93c5fd');
      break;
    }
    case 'floodlight': {
      ctx.fillStyle = '#374151'; ctx.fillRect(cx - 2, (y + 16) * T - h, 4, h);
      r.box(x + 8, y + 10, 16, 14, 4, '#4b5563', '#1f2937');
      ctx.save(); ctx.translate(cx, (y + 16) * T - h); ctx.rotate(Math.atan2(Math.sin(st.ra || 0) * T, Math.cos(st.ra || 0)));
      ctx.fillStyle = '#9ca3af'; ctx.fillRect(-7, -6, 14, 12);
      ctx.fillStyle = dark ? '#57534e' : '#fef9c3'; ctx.fillRect(6, -5, 3, 10);
      ctx.restore();
      break;
    }
    case 'shock_plate': case 'stasis_field': {
      ctx.fillStyle = shade(base, 0.6); ctx.beginPath(); ctx.ellipse(cx, (y + 16) * T, 10, 6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = dark ? '#3f3f46' : base; ctx.beginPath(); ctx.arc(cx, (y + 16) * T - 4 + Math.sin(now * 3) * 1.5, 4, 0, TAU); ctx.fill();
      break;
    }
    default:
      if (d.turret) drawTurret(r, st, x, y, S, h, now, dark);
      else r.box(x + 2, y + 2, S - 4, S - 4, h, top, front);
  }

  // power state overlays
  if (dark && d.h && st.built) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, topY - 4, S, (y + S) * T - topY + 4);
  }
  if (drop) ctx.translate(0, drop);
  const yLift = -lift;

  if (!st.built && d.h) {
    ctx.strokeStyle = 'rgba(250,204,21,0.85)'; ctx.lineWidth = 1;
    const sh = d.h;
    ctx.strokeRect(x + 1, y * T - sh + yLift, S - 2, sh + S * T);
    ctx.beginPath(); ctx.moveTo(x + 1, y * T - sh + yLift); ctx.lineTo(x + S - 1, (y + S) * T + yLift); ctx.moveTo(x + S - 1, y * T - sh + yLift); ctx.lineTo(x + 1, (y + S) * T + yLift); ctx.stroke();
    if (Math.random() < 0.15 * (d.size || 1)) r.burst(cx, st.y, 2, '#fde68a', 60, 2, 0.3, h, { kind: 'spark' });
    r.bar(cx, (y + S) * T + 3 + yLift, S, st.progress / 100, '#facc15');
  } else if (st.hp < 100) {
    r.bar(cx, topY - 6 + yLift, Math.min(S, 48), st.hp / 100, st.hp > 50 ? '#22c55e' : st.hp > 25 ? '#f59e0b' : '#ef4444');
    if (st.hp < 35 && Math.random() < 0.06 * (d.size || 1)) r.smoke(cx, st.y, h + lift, 1, 'rgba(60,60,60,', 7, 1.5);
  }
  if (st.level > 1 && !d.turret) for (let l = 1; l < st.level; l++) { ctx.fillStyle = '#fbbf24'; ctx.fillRect(x + 2 + (l - 1) * 6, topY + 2 + yLift, 4, 4); }
  if (electric && st.built && (!st.powered || st.starved) && Math.sin(now * 6) > 0) {
    ctx.fillStyle = st.starved && st.powered ? '#f59e0b' : '#ef4444'; ctx.font = 'bold 15px Rajdhani'; ctx.textAlign = 'center';
    ctx.fillText('⚡', cx, topY - 10 + yLift);
  }
  if (st.shielded) { ctx.strokeStyle = `rgba(96,165,250,${0.4 + Math.sin(now * 6) * 0.2})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(cx, (y + S / 2) * T - h / 2 + yLift, S * 0.7, S * 0.6, 0, 0, TAU); ctx.stroke(); }
  if (view.hover === st || view.selected === st.id || view.wireFrom === st.id) {
    ctx.strokeStyle = view.wireFrom === st.id ? '#facc15' : '#fff'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 1, topY - 1 + yLift, S + 2, (y + S) * T - topY + 2);
  }
}

// ------------------------------------------------------------------ walls: edge fences
function drawFence(r, st, x, y, h, topY) {
  const { ctx } = r;
  const g = r.world.L();
  const at = (tx, ty) => (tx < 0 || ty < 0 || tx >= g.w || ty >= g.h ? null : r.world.structures.get(r.world.structGrid[ty * g.w + tx]));
  const edges = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  ctx.strokeStyle = '#d4d4d8'; ctx.fillStyle = '#a1a1aa'; ctx.lineWidth = 1.2;
  const rail = 7;
  for (const [dx, dy] of edges) {
    if (isWallLike(at(st.tx + dx, st.ty + dy))) continue;
    let x1, y1, x2, y2;
    if (dy === -1) { x1 = x + 1; y1 = topY + 1; x2 = x + TILE - 1; y2 = topY + 1; }
    else if (dy === 1) { x1 = x + 1; y1 = topY + TILE * T - 1; x2 = x + TILE - 1; y2 = y1; }
    else if (dx === -1) { x1 = x + 1; y1 = topY + 1; x2 = x1; y2 = topY + TILE * T - 1; }
    else { x1 = x + TILE - 1; y1 = topY + 1; x2 = x1; y2 = topY + TILE * T - 1; }
    ctx.beginPath(); ctx.moveTo(x1, y1 - rail); ctx.lineTo(x2, y2 - rail); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1 - rail / 2); ctx.lineTo(x2, y2 - rail / 2); ctx.stroke();
    for (let k = 0; k <= 3; k++) { const px = x1 + (x2 - x1) * k / 3, py = y1 + (y2 - y1) * k / 3; ctx.fillRect(px - 0.8, py - rail, 1.6, rail); }
  }
}

// ------------------------------------------------------------------ stairwell (rotatable: steps rise toward rot)
function drawStairs(r, st, x, y, h, base, view) {
  const { ctx } = r;
  const steps = 5;
  const rot = st.rot || 0;
  for (let i = 0; i < steps; i++) {
    const k = (i + 1) / steps;
    const sh = h * k;
    // rot 0: rises to the east, 1: south, 2: west, 3: north
    if (rot === 0) r.box(x + (TILE / steps) * i, y + 2, TILE / steps, TILE - 4, sh, shade(base, 0.9 + k * 0.25), shade(base, 0.55));
    else if (rot === 2) r.box(x + TILE - (TILE / steps) * (i + 1), y + 2, TILE / steps, TILE - 4, sh, shade(base, 0.9 + k * 0.25), shade(base, 0.55));
    else if (rot === 3) r.box(x + 2, y + TILE - (TILE / steps) * (i + 1), TILE - 4, TILE / steps, sh, shade(base, 0.9 + k * 0.25), shade(base, 0.55));
    else r.box(x + 2, y + (TILE / steps) * (steps - 1 - i), TILE - 4, TILE / steps, h * ((steps - i) / steps), shade(base, 1.15 - i * 0.05), shade(base, 0.55));
  }
  ctx.strokeStyle = '#d4d4d8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + 2, (y + TILE) * T - 4); ctx.lineTo(x + 2, y * T - h - 6); ctx.moveTo(x + TILE - 2, (y + TILE) * T - 4); ctx.lineTo(x + TILE - 2, y * T - h - 6); ctx.stroke();
  // arrow showing the climbing direction
  const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][rot];
  const cx = x + 16, cy = (y + 16) * T - h - 4;
  ctx.fillStyle = 'rgba(253,224,71,0.85)';
  ctx.beginPath(); ctx.moveTo(cx + dx * 8, cy + dy * 5); ctx.lineTo(cx - dy * 5 - dx * 3, cy + dx * 4 - dy * 2); ctx.lineTo(cx + dy * 5 - dx * 3, cy - dx * 4 - dy * 2); ctx.closePath(); ctx.fill();
  if (st.built && view.me && !view.me.el && Math.hypot(view.me.rx - st.x, view.me.ry - st.y) < 70) r.prompt(cx, y * T - h - 18, 'Walk up to climb the wall');
}

// ------------------------------------------------------------------ power gear
function drawSolar(r, st, x, y, S, h, topY, now) {
  const { ctx } = r;
  const n = st.kind === 'solar_array' ? 2 : 1;
  const k = S / (n * TILE); // the single panel fills its whole 2x2 footprint
  const sun = r.world.snap?.sun ?? 1;
  // swivel: follow the sun east -> west, then swing back to face sunrise overnight
  const sp = sunPos(r.world.snap?.dp ?? 0.25);
  const want = sp.up ? (sp.u - 0.5) * 1.7 : -0.85;
  st.yaw = st.yaw === undefined ? want : st.yaw + (want - st.yaw) * Math.min(1, (sp.up ? 0.05 : 0.01));
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const cx = x + (px + 0.5) * TILE * k, cy = (y + (py + 0.5) * TILE * k) * T - h;
    ctx.fillStyle = '#374151'; ctx.fillRect(cx - 2 * k, cy + 4 * k, 4 * k, h - 2);
    ctx.fillStyle = '#52525b'; ctx.beginPath(); ctx.ellipse(cx, cy + 4 * k + h - 4, 5 * k, 2.5 * k, 0, 0, TAU); ctx.fill(); // swivel base
    ctx.save(); ctx.translate(cx, cy + 4 * k); ctx.scale(k * (0.55 + 0.45 * Math.cos(st.yaw)), k); ctx.transform(1, 0, Math.sin(st.yaw) * 0.25, 1, 0, 0);
    ctx.fillStyle = shade('#1e3a8a', 0.6 + sun * 0.6);
    ctx.beginPath(); ctx.moveTo(-15, 6); ctx.lineTo(15, 6); ctx.lineTo(12, -10); ctx.lineTo(-12, -10); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 0.7;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-15 + i * 7.5, 6); ctx.lineTo(-12 + i * 6, -10); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-13.5, -2); ctx.lineTo(13.5, -2); ctx.stroke();
    const gl = (now * 0.4 + st.id * 0.37 + px * 0.3) % 1.6 - 0.3;
    if (gl > 0 && gl < 1 && sun > 0.2) { ctx.fillStyle = `rgba(255,255,255,${0.35 * sun})`; ctx.fillRect(-15 + gl * 30 - 3, -10, 4, 16); }
    ctx.restore();
  }
  if (st.built && st.output > 0) { ctx.fillStyle = '#fde047'; ctx.font = '700 9px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText(`+${st.output.toFixed(1)}`, x + S / 2, topY - 6); }
}

function drawBattery(r, st, x, y, S, h, topY, frontY, now) {
  const { ctx } = r;
  const cells = st.kind === 'battery_bank' ? 4 : 1;
  const pct = (st.charge ?? 0) / 100;
  r.box(x + 3, y + 3, S - 6, S - 6, 5, '#1f2937', '#111827');
  const cw = (S - 10) / cells;
  for (let i = 0; i < cells; i++) {
    const bx = x + 5 + i * cw;
    r.box(bx + 1, y + 8, cw - 3, S - 16, h, '#3f3f46', '#27272a', 5);
    const fill = Math.max(0, Math.min(1, pct));
    const fy = (y + S - 8) * T - 5;
    ctx.fillStyle = '#052e16'; ctx.fillRect(bx + 3, fy - h + 3, cw - 7, h - 6);
    ctx.fillStyle = fill > 0.25 ? `rgba(34,197,94,${0.8 + Math.sin(now * 3 + i) * 0.2})` : '#ef4444';
    ctx.fillRect(bx + 3, fy - 3 - (h - 6) * fill, cw - 7, (h - 6) * fill);
    ctx.fillStyle = '#a1a1aa'; ctx.fillRect(bx + cw / 2 - 3, (y + 8) * T - h - 8, 4, 3);
  }
  ctx.fillStyle = '#86efac'; ctx.font = '700 9px Rajdhani'; ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(pct * 100)}%`, x + S / 2, topY - 8);
}

// ------------------------------------------------------------------ tractor beam: dish that reels in salvage
function drawTractor(r, st, x, y, S, h, topY, now, dark) {
  const { ctx } = r;
  const cx = x + S / 2, by = (y + S - 4) * T;
  r.box(x + 6, y + 8, S - 12, S - 12, 8, '#155e75', '#0e3a4a');
  ctx.fillStyle = '#334155'; ctx.fillRect(cx - 3, by - h, 6, h - 6);
  const R = st.def.range * (1 + 0.25 * (st.level - 1));
  let target = null, best = R * R;
  if (!dark && st.built) for (const pk of r.world.pickups.values()) {
    if (pk.ore) continue;
    const d = (pk.rx - st.x) ** 2 + (pk.ry - st.y) ** 2;
    if (d < best) { best = d; target = pk; }
  }
  const ang = target ? Math.atan2(target.ry - st.y, target.rx - st.x) : now * 0.6;
  ctx.save(); ctx.translate(cx, by - h); // dish
  ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.ellipse(Math.cos(ang) * 3, 0, 13, 8, ang, 0, TAU); ctx.fill();
  ctx.fillStyle = dark ? '#334155' : `rgba(34,211,238,${0.6 + Math.sin(now * 6) * 0.3})`; ctx.beginPath(); ctx.arc(Math.cos(ang) * 6, Math.sin(ang) * 3, 3.5, 0, TAU); ctx.fill();
  ctx.restore();
  if (dark || !st.built) return;
  for (const pk of r.world.pickups.values()) { // tractor beams to every piece of salvage in range
    if (pk.ore || (pk.rx - st.x) ** 2 + (pk.ry - st.y) ** 2 > R * R) continue;
    const ex = pk.rx, ey = pk.ry * T - 8;
    const g = ctx.createLinearGradient(cx, by - h, ex, ey);
    g.addColorStop(0, 'rgba(34,211,238,0.55)'); g.addColorStop(1, 'rgba(165,243,252,0.15)');
    ctx.strokeStyle = g; ctx.lineWidth = 3 + Math.sin(now * 12 + pk.id) * 1.2;
    ctx.beginPath(); ctx.moveTo(cx, by - h); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(236,254,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }
}

// ------------------------------------------------------------------ warehouse: crates + fill gauge
function drawWarehouse(r, st, x, y, S, h, topY, frontY, now, base) {
  const { ctx } = r;
  const cx = x + S / 2;
  r.box(x + 2, y + 4, S - 4, S - 6, h, shade(base, 0.9), shade(base, 0.55));
  // corrugated roof ridges
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 5 + i * 9.5, topY + 2, 2, (S - 8) * T);
  // roller door
  ctx.fillStyle = '#292524'; ctx.fillRect(cx - 14, frontY + h - 20, 28, 20);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 5; i++) ctx.fillRect(cx - 14, frontY + h - 19 + i * 4, 28, 1);
  // crates stacked outside
  r.box(x + 4, y + S - 12, 10, 8, 9, '#a16207', '#713f12');
  r.box(x + S - 15, y + S - 12, 10, 8, 9, '#a16207', '#713f12');
  r.box(x + S - 13, y + S - 14, 8, 6, 7, '#ca8a04', '#854d0e', 9);
  // fill gauge: how full the fullest store is
  const snap = r.world.snap, cap = snap?.cap || 1;
  let fill = 0;
  for (const k of RES_IDS) if (!UNCAPPED.has(k)) fill = Math.max(fill, (r.world.res[k] || 0) / cap);
  fill = Math.min(1, fill);
  const gx = x + 8, gy = frontY + 6, gw = S - 16;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(gx, gy, gw, 6);
  ctx.fillStyle = fill > 0.95 ? '#ef4444' : fill > 0.75 ? '#f59e0b' : '#22c55e';
  ctx.fillRect(gx + 1, gy + 1, (gw - 2) * fill, 4);
  ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('WAREHOUSE', cx, topY + 14);
  ctx.fillStyle = '#fde68a'; ctx.font = '700 9px Rajdhani';
  ctx.fillText(`${Math.round(fill * 100)}% full`, cx, topY - 6);
}

// ------------------------------------------------------------------ elevator headframe
function drawElevator(r, st, x, y, S, h, topY, frontY, now, dark, view) {
  const { ctx } = r;
  const cx = x + S / 2;
  ctx.fillStyle = '#18181b'; ctx.beginPath(); ctx.ellipse(cx, (y + S / 2) * T, S / 2 - 4, (S / 2 - 4) * T, 0, 0, TAU); ctx.fill(); // shaft
  ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2;
  const by = (y + S - 4) * T;
  for (const ox of [-22, 22]) { ctx.beginPath(); ctx.moveTo(cx + ox, by); ctx.lineTo(cx + ox * 0.4, by - h); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(cx - 18, by - h * 0.5); ctx.lineTo(cx + 18, by - h * 0.5); ctx.stroke();
  const wheel = dark ? 0 : now * 3;
  ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, by - h, 8, 0, TAU); ctx.stroke();
  for (let k = 0; k < 4; k++) { const a = wheel + k * 1.57; ctx.beginPath(); ctx.moveTo(cx, by - h); ctx.lineTo(cx + Math.cos(a) * 8, by - h + Math.sin(a) * 8); ctx.stroke(); }
  const cage = (Math.sin(now * 0.8 + st.id) * 0.5 + 0.5) * (h - 18);
  ctx.fillStyle = '#52525b'; ctx.fillRect(cx - 8, by - 14 - cage, 16, 12);
  ctx.strokeStyle = '#3f3f46'; ctx.beginPath(); ctx.moveTo(cx, by - h); ctx.lineTo(cx, by - 14 - cage); ctx.stroke();
  ctx.fillStyle = dark ? '#3f3f46' : (Math.sin(now * 4) > 0 ? '#22c55e' : '#14532d');
  ctx.beginPath(); ctx.arc(cx + 14, by - h * 0.5, 2.5, 0, TAU); ctx.fill();
  const me = view.me;
  if (me && !me.d && Math.hypot(me.rx - st.x, me.ry - st.y) < 110) {
    r.prompt(cx, by - h - 16, dark ? 'NO POWER' : 'F  Lift shaft - choose a level');
  }
}

// ------------------------------------------------------------------ generic buildings with signage
function drawBuilding(r, st, x, y, S, h, topY, frontY, now, dark, view, base) {
  const { ctx } = r;
  const cx = x + S / 2;
  r.box(x + 2, y + 2, S - 4, S - 4, h, shade(base, 0.85), shade(base, 0.55));
  ctx.fillStyle = shade(base, 0.7); ctx.fillRect(x + 2, topY - 3, S - 4, 4);
  r.box(x + 10, y + 8, 18, 14, 6, '#52525b', '#3f3f46', h);
  ctx.fillStyle = dark ? 'rgba(20,20,20,0.8)' : 'rgba(253,224,71,0.6)';
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 8 + i * 14, frontY + 6, 8, 6);
  ctx.fillStyle = '#111827'; ctx.fillRect(cx - 8, frontY + h - 16, 16, 16);
  ctx.fillStyle = '#facc15'; ctx.fillRect(cx - 8, frontY + h - 18, 16, 2);
  const sy = frontY + h / 2 + 2;
  ctx.fillStyle = '#fde68a';
  if (st.kind === 'med_bay') {
    ctx.fillStyle = '#fff'; ctx.fillRect(cx - 4, sy - 8, 8, 18); ctx.fillRect(cx - 9, sy - 3, 18, 8);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(cx - 2, sy - 6, 4, 14); ctx.fillRect(cx - 7, sy - 1, 14, 4);
  } else if (st.kind === 'armory') {
    ctx.fillRect(cx - 14, sy - 4, 24, 5); ctx.fillRect(cx + 2, sy + 1, 5, 7); ctx.fillRect(cx - 14, sy - 6, 4, 9);
  } else if (st.kind === 'research_lab') {
    ctx.save(); ctx.translate(x + S - 14, topY - 8); ctx.scale(Math.cos(now * 1.2), 1);
    ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = dark ? '#3b0764' : `rgba(232,121,249,${0.6 + Math.sin(now * 3) * 0.3})`;
    ctx.beginPath(); ctx.arc(cx, sy, 6, 0, TAU); ctx.fill();
  } else {
    ctx.save(); ctx.translate(cx, sy); ctx.rotate(dark ? 0 : now);
    for (let i = 0; i < 8; i++) { ctx.rotate(TAU / 8); ctx.fillRect(-2, -10, 4, 4); }
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(st.def.name.toUpperCase(), cx, topY + 14);
  const me = view.me;
  if (st.built && me && !me.d && Math.hypot(me.rx - st.x, me.ry - st.y) < SHOP_RANGE) {
    const label = st.kind === 'research_lab' ? 'J  Research' : `Q / click  ${st.def.name}`;
    r.prompt(cx, topY - 16, dark ? 'NO POWER' : label);
  }
}

// ------------------------------------------------------------------ turrets (art evolves per level)
function drawTurret(r, st, x, y, S, h, now, dark) {
  const { ctx } = r;
  const lvl = st.level, tier = TIER[lvl];
  const cx = x + S / 2;
  const big = (st.def.size || 1) > 1;
  const ped = (big ? 14 : 8) + lvl * 1.5;
  // pedestal with trim stripe, armour plates from level 2
  r.box(x + 3, y + 3, S - 6, S - 6, ped, '#374151', '#1f2937');
  ctx.fillStyle = tier.trim; ctx.fillRect(x + 3, (y + S - 3) * T - ped + 2, S - 6, 2);
  if (lvl >= 2) for (const [ox, oy] of [[3, 3], [S - 9, 3], [3, S - 9], [S - 9, S - 9]]) r.box(x + ox, y + oy, 6, 6, ped + 3, tier.trim, shade(tier.trim, 0.5));
  if (tier.glow && !dark) {
    ctx.strokeStyle = tier.glow; ctx.globalAlpha = 0.5 + Math.sin(now * 4) * 0.3; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, (y + S / 2) * T - ped, S / 2 - 2, (S / 2 - 2) * T, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (lvl >= 5 && !dark && Math.random() < 0.3) r.particle({ x: st.x + rnd(-S / 2, S / 2), y: st.y + rnd(-S / 2, S / 2), z: ped, vx: 0, vy: 0, vz: rnd(20, 50), life: 0.8, color: tier.glow, size: 2, kind: 'c' });

  const a = st.ra || 0;
  const hx = cx, hy = (y + S / 2) * T - ped;
  const bx = Math.cos(a), by = Math.sin(a) * T;
  const firing = st.flashAt && now - st.flashAt < 0.07;
  const rec = firing ? 3 : 0;
  const k = st.kind;
  const beam = st.def.turret.beam || '#fde68a';

  if (k.startsWith('tesla')) {
    const towerH = (big ? 46 : 28) + lvl * 3;
    ctx.fillStyle = '#475569'; ctx.fillRect(hx - 3, hy - towerH, 6, towerH);
    const rings = 3 + lvl;
    for (let i = 0; i < rings; i++) { ctx.fillStyle = i % 2 ? '#b45309' : '#d97706'; ctx.beginPath(); ctx.ellipse(hx, hy - 6 - i * (towerH - 12) / rings, (big ? 12 : 8) - i * 0.6, 3, 0, 0, TAU); ctx.fill(); }
    const sr = (big ? 9 : 6) + lvl;
    const glow = dark ? 0.15 : 0.6 + Math.sin(now * 10) * 0.3;
    ctx.fillStyle = `rgba(186,230,253,${glow})`; ctx.beginPath(); ctx.arc(hx, hy - towerH - 2, sr, 0, TAU); ctx.fill();
    if (lvl >= 5) { ctx.strokeStyle = tier.glow; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(hx, hy - towerH - 2, sr + 7, 4, now * 2, 0, TAU); ctx.stroke(); }
    if (!dark && Math.random() < 0.5) {
      ctx.strokeStyle = 'rgba(224,242,254,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); let px = hx, py = hy - towerH - 2; ctx.moveTo(px, py);
      for (let i = 0; i < 4; i++) { px += rnd(-7, 7); py += rnd(-7, 7); ctx.lineTo(px, py); }
      ctx.stroke();
    }
    return;
  }
  // rotating head
  const headR = (big ? 15 : 9) + lvl;
  ctx.fillStyle = shade(st.def.color, 0.6); ctx.beginPath(); ctx.ellipse(hx, hy - 3, headR, headR * 0.65, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = shade(st.def.color, 0.95); ctx.beginPath(); ctx.ellipse(hx, hy - 6, headR - 2, (headR - 2) * 0.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = tier.trim; ctx.beginPath(); ctx.ellipse(hx, hy - 6, headR * 0.45, headR * 0.28, 0, 0, TAU); ctx.fill();
  ctx.lineCap = 'round';
  const barrels = (n, len, width, color, up = 0, spacing = 4) => {
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * spacing;
      const ox = -by * off * 0.9, oy = bx * off * 0.5;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(hx + ox, hy - 6 + oy); ctx.lineTo(hx + ox + bx * (len - rec), hy - 6 + oy + by * (len - rec) - up); ctx.stroke();
      if (firing) { ctx.fillStyle = beam; ctx.beginPath(); ctx.arc(hx + ox + bx * (len + 2), hy - 6 + oy + by * (len + 2) - up, width + 2, 0, TAU); ctx.fill(); }
    }
  };
  if (k === 'laser_s') {
    barrels(lvl >= 5 ? 3 : lvl >= 3 ? 2 : 1, 14 + lvl * 2, 3, '#18181b');
    if (lvl >= 4) barrels(1, 8, 5, tier.trim);
  } else if (k === 'laser_m') {
    barrels(lvl >= 3 ? 2 : 1, 18 + lvl * 2, 5, '#0f172a', 0, 6);
    if (lvl >= 4) { ctx.fillStyle = tier.glow; ctx.beginPath(); ctx.arc(hx + bx * 10, hy - 6 + by * 10, 3, 0, TAU); ctx.fill(); }
  } else if (k === 'laser_l' || k === 'rail_l') {
    const len = (k === 'rail_l' ? 40 : 32) + lvl * 3;
    barrels(2, len, k === 'rail_l' ? 4 : 6, '#0f172a', 0, k === 'rail_l' ? 7 : 5);
    const charge = k === 'rail_l' ? Math.min(1, (now - (st.flashAt || 0)) / 2) : 1;
    for (let i = 1; i <= 3 + Math.floor(lvl / 2); i++) { // glowing coils
      const t2 = i / (4 + lvl / 2);
      ctx.fillStyle = dark ? '#1e293b' : `rgba(${k === 'rail_l' ? '103,232,249' : '252,165,165'},${0.35 + 0.6 * charge})`;
      ctx.beginPath(); ctx.arc(hx + bx * len * t2, hy - 6 + by * len * t2, 3.5, 0, TAU); ctx.fill();
    }
  } else if (k === 'flak_s') {
    barrels(lvl >= 3 ? 4 : 2, 12 + lvl, 3, '#1e293b', 10, 3.5);
  } else if (k === 'missile_l') {
    const tubes = 4 + (lvl >= 3 ? 2 : 0) + (lvl >= 5 ? 2 : 0);
    ctx.save(); ctx.translate(hx, hy - 10); ctx.rotate(Math.atan2(by, bx));
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(-10, -12, 26, 24);
    ctx.fillStyle = '#0f172a';
    for (let i = 0; i < tubes; i++) ctx.beginPath(), ctx.arc(10 + (i % 2) * 4, -8 + Math.floor(i / 2) * (16 / Math.ceil(tubes / 2)), 2.5, 0, TAU), ctx.fill();
    ctx.restore();
  } else if (k === 'mortar_m') {
    barrels(1, 12 + lvl, 9 + lvl, '#3b0764', 14);
    if (!dark) { ctx.fillStyle = `rgba(216,180,254,${0.4 + Math.sin(now * 5) * 0.3})`; ctx.beginPath(); ctx.arc(hx + bx * 10, hy - 20 + by * 10, 4, 0, TAU); ctx.fill(); }
  }
  ctx.lineCap = 'butt';
  if (st.kills >= 0 && st.mods) { // module pips
    ctx.fillStyle = '#e879f9';
    for (let i = 0; i < st.mods; i++) ctx.fillRect(x + 4 + i * 5, (y + S - 3) * T - ped - 4, 3, 3);
  }
}

// ------------------------------------------------------------------ HQ
export function drawHq(r, now, view) {
  const { ctx, world } = r;
  const { hq } = world;
  const [hx, hy] = world.hqTiles[0];
  const x0 = hx * TILE, y0 = hy * TILE, size = 3 * TILE;
  const hit = r.hqHitAt && now - r.hqHitAt < 0.1;
  const on = hq.powered;
  const h1 = 32;
  r.box(x0, y0, size, size, h1, hit ? '#9ca3af' : '#3f4652', '#262b33');
  const fy = (y0 + size) * T - h1;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = on ? `rgba(125,211,252,${0.55 + Math.sin(now * 2 + i) * 0.2})` : 'rgba(20,24,30,0.9)';
    ctx.fillRect(x0 + 8 + i * 15, fy + 8, 7, 5);
  }
  ctx.fillStyle = '#111827'; ctx.fillRect(x0 + size / 2 - 12, fy + h1 - 16, 24, 16);
  ctx.fillStyle = '#facc15'; for (let i = 0; i < 4; i++) ctx.fillRect(x0 + size / 2 - 12 + i * 6, fy + h1 - 16, 3, 3);
  ctx.fillStyle = '#dc2626'; ctx.fillRect(x0, y0 * T - h1, size, 3);
  const inset = 14, h2 = 24;
  r.box(x0 + inset, y0 + inset, size - inset * 2, size - inset * 2, h2, '#525a66', '#2f353f', h1);
  const topZ = h1 + h2;
  r.box(hq.x - 14, hq.y - 14, 28, 28, 20, '#374151', '#1f2937', topZ); // control tower
  ctx.fillStyle = on ? `rgba(56,189,248,${0.5 + Math.sin(now * 3) * 0.2})` : '#111827'; ctx.fillRect(hq.x - 12, (hq.y + 14) * T - topZ - 16, 24, 5);
  // radar dish
  const ra = on ? now * 1.5 : 0;
  ctx.save(); ctx.translate(x0 + size - inset - 14, (y0 + inset + 12) * T - topZ);
  ctx.fillStyle = '#9ca3af'; ctx.fillRect(-1.5, -14, 3, 14);
  ctx.scale(Math.cos(ra), 1);
  ctx.fillStyle = '#d1d5db'; ctx.beginPath(); ctx.ellipse(0, -16, 11, 6, 0, 0, TAU); ctx.fill();
  ctx.restore();
  // comms mast + beacon
  const ax = x0 + inset + 10, ay = (y0 + inset + 6) * T - topZ;
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - 40); ctx.stroke();
  if (on && Math.sin(now * 5) > 0.3) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(ax, ay - 41, 3, 0, TAU); ctx.fill(); }
  // point-defence emitter
  const by = hq.y * T - topZ - 20;
  ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.ellipse(hq.x, by, 10, 6, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hq.x, by - 3); ctx.lineTo(hq.x + Math.cos(hq.ra) * 16, by - 3 + Math.sin(hq.ra) * 16 * T); ctx.stroke(); ctx.lineCap = 'butt';
  if (!on) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x0, y0 * T - topZ - 20, size, size * T + topZ + 20); }
  const frac = hq.hp / hq.max;
  if (frac < 0.5 && Math.random() < 0.3) r.smoke(hq.x + rnd(-40, 40), hq.y + rnd(-40, 40), topZ, 1, 'rgba(50,50,50,', 12, 2.2);
  r.bar(hq.x, hq.y * T - topZ - 46, 90, frac, frac > 0.5 ? '#22c55e' : frac > 0.25 ? '#f59e0b' : '#ef4444');
  ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center'; ctx.fillStyle = on ? '#bae6fd' : '#ef4444';
  ctx.fillText(on ? 'COLONY HQ' : 'HQ - NO POWER', hq.x, hq.y * T - topZ - 50);
  const me = view.me;
  if (me && !me.d && Math.hypot(me.rx - hq.x, me.ry - hq.y) < 170) r.prompt(hq.x, hq.y * T - topZ - 64, 'Q  HQ shop  ·  ore auto-delivers here');
}

// ------------------------------------------------------------------ power wires
function nodeTop(r, id) {
  if (id === 0) { const hq = r.world.hq; return { x: hq.x, y: hq.y * T - 80 }; }
  const st = r.world.structures.get(id);
  if (!st) return null;
  return { x: st.x, y: st.y * T - Math.max(10, structHeight(st) * 0.85) - (st.mount ? mountLift(r, st) : 0) };
}

export function drawWires(r, now, view) {
  const { ctx } = r;
  ctx.lineCap = 'round';
  for (const w of r.world.wires) {
    const a = nodeTop(r, w.a), b = nodeTop(r, w.b);
    if (!a || !b) continue;
    if (!r.visible(a.x, (a.y + 80) / T, 300) && !r.visible(b.x, (b.y + 80) / T, 300)) continue;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + 14 + dist * 0.08;
    const flick = w.state === 2 && Math.random() < 0.4;
    const color = w.state === 1 ? '#fde047' : w.state === 2 ? (flick ? '#7c2d12' : '#fb923c') : '#3f3f46';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 1.4;
    if (w.state) { ctx.shadowColor = color; ctx.shadowBlur = 6; }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
    ctx.shadowBlur = 0;
    if (w.state === 1) { // energy pulses travelling along the cable
      for (let k = 0; k < 2; k++) {
        const t = ((now * 0.8 + k * 0.5 + (w.a % 7) * 0.13) % 1);
        const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
        const py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        ctx.fillStyle = '#fff7cc'; ctx.beginPath(); ctx.arc(px, py, 1.8, 0, TAU); ctx.fill();
      }
    }
  }
  if (view.wireFrom != null && view.mouseWorld) {
    const a = nodeTop(r, view.wireFrom);
    if (a) {
      ctx.strokeStyle = 'rgba(250,204,21,0.8)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(view.mouseWorld.x, view.mouseWorld.y * T); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'butt';
}

// Shield tint by charge: blue when healthy, amber under 40%, red under 10%, flickering out below 1%.
function domeTint(frac) {
  if (frac < 0.1) return [248, 113, 113];
  if (frac < 0.4) return [251, 191, 36];
  return [56, 189, 248];
}

// The colony dome: a huge shield bubble over the HQ. Its rim on the ground marks where you can build.
function drawColonyDome(r, now, view) {
  const { ctx, world } = r;
  const dm = world.snap?.dome;
  if (!dm || world.layer !== 0) return;
  const [R, maxR, sh, shMax, up, , grace] = dm;
  const cx = world.hq.x, cy = world.hq.y * T;
  const frac = sh / shMax;
  const [cr, cg, cb] = domeTint(frac);
  const rgba = (a) => `rgba(${cr},${cg},${cb},${a})`;
  const hitAge = now - (r.domeHitAt || 0);
  const pulse = hitAge < 0.3 ? (0.3 - hitAge) * 0.8 : 0;
  const failing = frac < 0.01 && Math.random() < 0.55; // last 1%: the shell stutters out
  if (up && !failing) {
    const g = ctx.createRadialGradient(cx, cy - R * 0.35, R * 0.3, cx, cy - R * 0.1, R);
    g.addColorStop(0, rgba(0.015 + pulse * 0.1));
    g.addColorStop(0.85, rgba(0.05 + frac * 0.05 + pulse * 0.2));
    g.addColorStop(1, rgba(0.2 + frac * 0.12 + pulse * 0.3));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * T, 0, 0, Math.PI); ctx.ellipse(cx, cy, R, R * 0.8, 0, Math.PI, TAU); ctx.fill();
    ctx.strokeStyle = rgba(0.08 + pulse * 0.3); ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) { // shimmer bands drifting over the shell
      const f = ((i / 5 + now * 0.03) % 1), k = Math.sqrt(1 - f * f * 0.81);
      ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.8 * f * 0.9, R * k, R * T * 0.35 * k, 0, Math.PI, TAU); ctx.stroke();
    }
    ctx.strokeStyle = rgba(0.45 + pulse); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.8, 0, Math.PI, TAU); ctx.stroke();
  }
  // impacts: hex cells light up where shots and claws hit the shell, with a ripple and sparks
  r.domeHits = (r.domeHits || []).filter((h) => now - h.t < 0.6);
  if (up) for (const h of r.domeHits) {
    const age = (now - h.t) / 0.6;
    const hx = cx + Math.cos(h.a) * R, hy = cy + Math.sin(h.a) * R * T - 18 - Math.max(0, -Math.sin(h.a)) * R * 0.25;
    ctx.save(); ctx.translate(hx, hy);
    ctx.strokeStyle = rgba((1 - age) * 0.9); ctx.lineWidth = 1.5;
    for (let k = 0; k < 7; k++) {
      const ox = k ? Math.cos((k / 6) * TAU) * 13 : 0, oy = k ? Math.sin((k / 6) * TAU) * 9 : 0;
      ctx.beginPath();
      for (let s = 0; s <= 6; s++) { const a = (s / 6) * TAU + Math.PI / 6; ctx[s ? 'lineTo' : 'moveTo'](ox + Math.cos(a) * 7, oy + Math.sin(a) * 5); }
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255,255,255,${(1 - age) * 0.8})`; ctx.beginPath(); ctx.arc(0, 0, 6 * (1 - age) + 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba((1 - age) * 0.7); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 0, 10 + age * 40, (10 + age * 40) * 0.6, 0, 0, TAU); ctx.stroke();
    ctx.restore();
    if (!h.sparked) { h.sparked = true; r.burst(cx + Math.cos(h.a) * R, world.hq.y + Math.sin(h.a) * R, 6, `rgb(${cr},${cg},${cb})`, 160, 2, 0.4, 18, { kind: 'spark' }); }
  }
  // rim on the ground (bright when building so you can see where it is allowed)
  ctx.strokeStyle = up ? rgba(view.build ? 0.85 : 0.35) : 'rgba(248,113,113,0.5)';
  ctx.lineWidth = view.build ? 3 : 2;
  ctx.beginPath(); ctx.ellipse(cx, cy, R, R * T, 0, 0, TAU); ctx.stroke();
  if (R < maxR) { // where the atmosphere is still expanding to
    ctx.strokeStyle = rgba(0.18); ctx.setLineDash([6, 8]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, maxR, maxR * T, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  if (!up) { ctx.font = '700 14px Rajdhani'; ctx.textAlign = 'center'; ctx.fillStyle = '#fca5a5'; ctx.fillText(grace > 0 ? `DOME DOWN - decompression in ${grace}s` : 'DOME DOWN - BUILDINGS DECOMPRESSING', cx, cy - R * 0.8 - 10); }
}

export function drawDomes(r, now, view) {
  const { ctx } = r;
  drawColonyDome(r, now, view);
  for (const st of r.world.structures.values()) {
    if (st.kind !== 'shield_projector' || !st.built || !st.powered || !st.shield) continue;
    const R = st.def.radius * (1 + 0.15 * (st.level - 1));
    const cx = st.x, cy = st.y * T;
    const hitAge = now - (st.shieldHitAt || 0);
    const alpha = 0.08 + (st.shield / 100) * 0.1 + (hitAge < 0.25 ? (0.25 - hitAge) : 0);
    const g = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R);
    g.addColorStop(0, `rgba(147,197,253,${alpha * 0.4})`); g.addColorStop(1, `rgba(96,165,250,${alpha * 2})`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * T, 0, 0, Math.PI); ctx.ellipse(cx, cy, R, R * 0.75, 0, Math.PI, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(191,219,254,${0.25 + alpha})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.75, 0, Math.PI, TAU); ctx.stroke();
  }
  for (const rp of r.ripples) {
    rp.life -= 1 / 60;
    ctx.strokeStyle = `rgba(191,219,254,${Math.max(0, rp.life * 2)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(rp.x, rp.y * T - 20, 20 * (1.5 - rp.life * 2), 12 * (1.5 - rp.life * 2), 0, 0, TAU); ctx.stroke();
  }
  r.ripples = r.ripples.filter((rp) => rp.life > 0);
}

export function drawBuildGhost(r, view) {
  const { ctx } = r;
  const { tile, kind, valid, rot } = view.build;
  if (!tile || !kind) return;
  const d = STRUCTURES[kind];
  const S = (d.size || 1) * TILE;
  const x = tile[0] * TILE, y = tile[1] * TILE;
  const lift = view.build.mount || 0;
  ctx.globalAlpha = 0.55 + Math.sin(r.time * 6) * 0.1;
  if (d.h) r.box(x, y, S, S, d.h, valid ? shade(d.color, 1.1) : '#ef4444', valid ? shade(d.color, 0.6) : '#7f1d1d', lift);
  else { ctx.fillStyle = valid ? d.color : '#ef4444'; ctx.fillRect(x + 6, y * T + 4, S - 12, S * T - 8); }
  ctx.globalAlpha = 1;
  if (d.rot) {
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][rot || 0];
    const cx = x + S / 2, cy = (y + S / 2) * T - (d.h || 0) - 6;
    ctx.strokeStyle = '#fde047'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - dx * 10, cy - dy * 6); ctx.lineTo(cx + dx * 14, cy + dy * 9); ctx.stroke();
    ctx.fillStyle = '#fde047'; ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText('R to rotate', cx, cy - 14);
  }
  if (lift) { ctx.fillStyle = '#fde68a'; ctx.font = '700 11px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText('MOUNT ON WALL (+25% range)', x + S / 2, y * T - lift - d.h - 8); }
}

export { MAP_W };
