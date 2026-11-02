// Unit art: colonists in spacesuits, rogue AI machines, colony robots, projectiles, loot and ruins.
import { TILE, ENEMIES, WEAPONS, ROBOTS, PERKS, RESOURCES } from '/shared/defs.js';
import { RIDE_TIME } from '/shared/defs.js';
import { T, TAU, shade, rnd, playerColor } from '../renderer.js';

// ------------------------------------------------------------------ colonists
export function drawPlayer(r, p, now, view) {
  const { ctx } = r;
  if (p.rd) { // riding the lift cage: sink into the shaft / rise out of it
    const [phase, , dir] = p.rd;
    const k = Math.min(1, (now - (p.rdAt || now)) / RIDE_TIME);
    const away = phase === 1 ? k : 1 - k; // 0 = at the floor, 1 = out of sight
    const z = dir > 0 ? -46 * away : 70 * away;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - away * 0.95);
    ctx.translate(0, -z);
    const py = p.ry * T;
    ctx.fillStyle = '#52525b'; ctx.fillRect(p.rx - 16, py - 4, 32, 6); // cage floor
    ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 1.5;
    for (const ox of [-15, 15]) { ctx.beginPath(); ctx.moveTo(p.rx + ox, py); ctx.lineTo(p.rx + ox, py - 46); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(p.rx - 15, py - 46); ctx.lineTo(p.rx + 15, py - 46); ctx.stroke();
    const saved = p.rd; p.rd = 0;
    drawPlayer(r, p, now, view);
    p.rd = saved;
    ctx.restore();
    return;
  }
  const color = playerColor(p.id);
  const w = WEAPONS[p.w] || WEAPONS.pistol;
  const moving = p.speedSm > 25;
  const px = p.rx, py = p.ry * T - p.rz;
  const fx = Math.cos(p.ra), fy = Math.sin(p.ra) * T;
  const s = 1;
  if (p.el) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(px + 3, py + 3, 11, 5, 0, 0, TAU); ctx.fill(); }
  const step = Math.sin(p.walk) * 5 * (moving ? 1 : 0.1);
  const bob = Math.abs(Math.cos(p.walk)) * 2 * (moving ? 1 : 0);
  const hurt = p.hurtAt && now - p.hurtAt < 0.12;
  // boots
  ctx.strokeStyle = '#3f3f46'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  const side = { x: -fy * 4, y: fx * 4 * T };
  for (const sgn of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(px + side.x * sgn, py - 10);
    ctx.lineTo(px + side.x * sgn + fx * step * sgn, py - 1 + fy * step * sgn * 0.5); ctx.stroke();
  }
  const torsoY = py - 19 - bob;
  const behind = fy < -0.05;
  // O2 backpack (behind the torso, opposite facing)
  const pack = () => { ctx.fillStyle = '#a1a1aa'; ctx.fillRect(px - fx * 9 - 6, torsoY - 9, 12, 14); ctx.fillStyle = color; ctx.fillRect(px - fx * 9 - 5, torsoY - 7, 3, 10); ctx.fillRect(px - fx * 9 + 2, torsoY - 7, 3, 10); };
  if (!behind) pack();
  let swing = 0;
  if (w.kind === 'melee' && p.swingAt && now - p.swingAt < 0.25) swing = Math.sin(((now - p.swingAt) / 0.25) * Math.PI) * 1.6 - 0.8;
  const arms = () => {
    const a = p.ra + swing;
    const ax = Math.cos(a), ay = Math.sin(a) * T;
    const rec = p.recoil * 5;
    const sx = px + ax * (6 - rec), sy = torsoY + ay * (6 - rec) + 1;
    ctx.strokeStyle = '#e4e4e7'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(px - fy * 7, torsoY + fx * 3); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + fy * 7, torsoY - fx * 3); ctx.lineTo(sx, sy); ctx.stroke();
    const len = w.kind === 'melee' ? (p.w === 'katana' ? 30 : 24) : p.w === 'rocket' ? 26 : p.w === 'pistol' ? 13 : 22;
    ctx.strokeStyle = w.color; ctx.lineWidth = w.kind === 'melee' ? (p.w === 'chainsaw' ? 7 : 3.5) : p.w === 'rocket' ? 7 : 4.5;
    if (w.kind === 'melee' && p.w !== 'chainsaw') { ctx.shadowColor = w.color; ctx.shadowBlur = 8; }
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ax * len, sy + ay * len); ctx.stroke();
    ctx.shadowBlur = 0;
    if (p.bm > 0) { // mining laser straight ahead to whatever it hits
      const tx = p.rx + Math.cos(p.ra) * p.bm, ty = p.ry + Math.sin(p.ra) * p.bm;
      const ex = tx, ey = ty * T - 22;
      ctx.strokeStyle = `rgba(251,146,60,${0.6 + Math.random() * 0.4})`; ctx.lineWidth = 3; ctx.shadowColor = '#fb923c'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(sx + ax * len, sy + ay * len); ctx.lineTo(ex + rnd(-3, 3), ey + rnd(-3, 3)); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff7ed'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx + ax * len, sy + ay * len); ctx.lineTo(ex, ey); ctx.stroke();
      if (Math.random() < 0.7) r.burst(tx, ty, 2, Math.random() < 0.5 ? '#fdba74' : '#fef3c7', 120, 2, 0.35, 22, { kind: 'spark' });
      if (Math.random() < 0.3) r.particle({ x: tx + rnd(-10, 10), y: ty + 14, z: 20, vx: rnd(-40, 40), vy: rnd(10, 40), vz: rnd(30, 90), g: 400, life: 0.8, color: '#78716c', size: rnd(2, 4) });
      r.flash(tx, ty, 90, 0.05, 22);
    } else if (p.flashAt && now - p.flashAt < 0.05 && w.kind === 'ranged') {
      const mx = sx + ax * (len + 4), my = sy + ay * (len + 4);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(mx, my, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = w.bolt || '#7dd3fc'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(mx - ay * 5, my + ax * 5); ctx.lineTo(mx + ax * 16, my + ay * 16); ctx.lineTo(mx + ay * 5, my - ax * 5); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (w.kind === 'melee' && swing) { ctx.strokeStyle = `${w.color}88`; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(px, torsoY, w.range - 8, (w.range - 8) * T, 0, p.ra - w.arc / 2, p.ra + w.arc / 2); ctx.stroke(); }
  };
  if (behind) arms();
  // suit torso
  const tg = ctx.createLinearGradient(px - 11, torsoY, px + 11, torsoY);
  tg.addColorStop(0, '#f4f4f5'); tg.addColorStop(1, '#a1a1aa');
  ctx.fillStyle = hurt ? '#fecaca' : tg;
  ctx.beginPath(); ctx.ellipse(px, torsoY, 10, 11, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = color; ctx.fillRect(px - 9, torsoY + 1, 18, 3);
  if (behind) pack();
  // helmet with glowing visor
  const hx = px + fx * 2, hy = torsoY - 14;
  ctx.fillStyle = hurt ? '#fecaca' : '#e4e4e7'; ctx.beginPath(); ctx.arc(hx, hy, 8, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
  if (fy > -0.4) {
    const vg = ctx.createLinearGradient(hx - 6, hy - 4, hx + 6, hy + 4);
    vg.addColorStop(0, '#0e7490'); vg.addColorStop(1, '#67e8f9');
    ctx.fillStyle = vg; ctx.beginPath(); ctx.ellipse(hx + fx * 3, hy + fy * 2, 5.5, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(hx + fx * 3 - 3, hy + fy * 2 - 2.5, 2, 1.5);
  }
  ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(hx - fy * 6, hy - 4, 1.6, 0, TAU); ctx.fill(); // helmet lamp
  if (!behind) arms();
  ctx.lineCap = 'butt';
  // shield bubble
  if (p.sh > 0) {
    const hitAge = now - (p.shieldHitAt || 0);
    const a = 0.12 + (p.sh / Math.max(1, p.msh)) * 0.12 + (hitAge < 0.2 ? 0.4 : 0);
    ctx.strokeStyle = `rgba(125,211,252,${a + 0.2})`; ctx.fillStyle = `rgba(125,211,252,${a * 0.5})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(px, torsoY - 6, 18, 25, 0, 0, TAU); ctx.fill(); ctx.stroke();
  }
  if (p.sp) { ctx.strokeStyle = `rgba(255,255,255,${0.4 + Math.sin(now * 12) * 0.3})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(px, torsoY, 16, 20, 0, 0, TAU); ctx.stroke(); }
  if (moving && !p.el && Math.random() < (p.speedSm > 230 ? 0.35 : 0.08)) r.particle({ x: p.rx + rnd(-4, 4), y: p.ry + 2, z: 1, vx: rnd(-15, 15), vy: rnd(-5, 5), vz: rnd(10, 25), life: 0.7, color: 'rgba(150,130,110,', size: 4, kind: 's', grow: 10 });
  ctx.font = '700 12px Rajdhani'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(p.n, px + 1, hy - 13);
  ctx.fillStyle = color; ctx.fillText(p.n, px, hy - 14);
  r.bar(px, hy - 10, 32, p.hp / p.mhp, '#22c55e');
  if (p.msh) r.bar(px, hy - 6, 32, p.sh / p.msh, '#7dd3fc');
  if (p.o2 !== undefined && p.o2 < p.mo2 * 0.3) { ctx.fillStyle = Math.sin(now * 8) > 0 ? '#ef4444' : '#fca5a5'; ctx.font = '700 10px Rajdhani'; ctx.fillText('LOW O₂', px, py + 14); }
  if (p.it) { ctx.fillStyle = p.it === 'heal' ? '#4ade80' : '#fbbf24'; ctx.font = '600 11px Rajdhani'; ctx.fillText({ repair: 'repairing...', heal: 'healing...' }[p.it] || '', px, py + 26); }
  if (p.b.speed_boost && Math.random() < 0.4) r.particle({ x: p.rx, y: p.ry, z: 10, vx: 0, vy: 0, vz: 10, life: 0.4, color: '#22d3ee', size: 3, kind: 'c' });
}

// ------------------------------------------------------------------ rogue AI machines
export function drawEnemy(r, z, now) {
  const { ctx } = r;
  const def = ENEMIES[z.type];
  const hidden = z.flags & 1, fly = z.flags & 16, boss = z.flags & 8, dormant = z.flags & 32;
  const flashW = now - z.hitAt < 0.08;
  const sc = def.radius / 9;
  const lift = fly ? 46 + Math.sin(now * 6 + z.id) * 5 : 0;
  const px = z.rx, py = z.ry * T - lift;
  const fx = Math.cos(z.ra), fy = Math.sin(z.ra) * T;
  const age = now - z.born;
  if (age < 0.4 && !dormant) { // warp-in beam
    ctx.fillStyle = `rgba(248,113,113,${0.5 * (1 - age / 0.4)})`; ctx.fillRect(px - 4 * sc, py - 200, 8 * sc, 200);
  }
  ctx.globalAlpha = hidden ? 0.12 + Math.sin(now * 9 + z.id) * 0.05 : 1;
  const body = flashW ? '#ffffff' : def.color;
  const eye = dormant ? '#3f3f46' : def.eye;
  const walk = z.walk;

  if (fly) { // wasp drone: body + spinning rotor discs
    for (const [ox, oy] of [[-10, -5], [10, -5], [-10, 5], [10, 5]]) {
      ctx.fillStyle = 'rgba(220,220,220,0.3)'; ctx.beginPath(); ctx.ellipse(px + ox * sc, py + oy * sc * T - 2, 7 * sc, (2 + Math.abs(Math.sin(now * 40 + ox)) * 1.5) * sc, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#27272a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ox * sc, py + oy * sc * T); ctx.stroke();
    }
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(px, py, 7 * sc, 5 * sc, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#18181b'; ctx.beginPath(); ctx.moveTo(px - fx * 9, py - fy * 9); ctx.lineTo(px - fx * 14 - fy * 3, py - fy * 14 + fx * 2); ctx.lineTo(px - fx * 14 + fy * 3, py - fy * 14 - fx * 2); ctx.fill(); // stinger
    ctx.fillStyle = eye; ctx.shadowColor = eye; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(px + fx * 5, py + fy * 3, 2.2 * sc, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  } else if (z.type === 'crawler' || z.type === 'skitter' || z.type === 'sentinel') { // spider / tripod bots
    const legs = z.type === 'skitter' ? 4 : z.type === 'sentinel' ? 3 : 6;
    ctx.strokeStyle = shade(def.color, 0.55); ctx.lineWidth = Math.max(1.5, 1.6 * sc);
    for (let i = 0; i < legs; i++) {
      const a = z.ra + Math.PI / 2 + (i / (legs - 1 || 1) - 0.5) * 2.4 * (i % 2 ? 1 : -1) + (i % 2 ? 0 : Math.PI);
      const st = Math.sin(walk * 1.5 + i * 1.7) * 3 * sc;
      const kx = px + Math.cos(a) * 9 * sc, ky = py - 6 * sc + Math.sin(a) * 5 * sc * T - 4 * sc;
      const ex = px + Math.cos(a) * 14 * sc + fx * st, ey = py + Math.sin(a) * 9 * sc * T + fy * st;
      ctx.beginPath(); ctx.moveTo(px, py - 6 * sc); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
    }
    const g = ctx.createRadialGradient(px - 3 * sc, py - 10 * sc, 1, px, py - 7 * sc, 10 * sc);
    g.addColorStop(0, flashW ? '#fff' : shade(def.color, 1.5)); g.addColorStop(1, body);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, py - 7 * sc, 9 * sc, 7 * sc, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    if (z.type === 'sentinel') { ctx.fillStyle = '#292524'; ctx.fillRect(px - 3 * sc, py - 20 * sc, 6 * sc, 8 * sc); }
    ctx.fillStyle = eye; ctx.shadowColor = eye; ctx.shadowBlur = dormant ? 0 : 10;
    ctx.beginPath(); ctx.arc(px + fx * 5 * sc, py - 8 * sc + fy * 3 * sc, 2.4 * sc, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  } else { // bipedal mechs: juggernaut, gunner, phantom, construct, bosses
    const heavy = z.type === 'juggernaut' || z.type === 'construct' || boss;
    const legW = (heavy ? 6 : 3.5) * sc;
    const stepA = Math.sin(walk) * 5 * sc;
    ctx.strokeStyle = shade(def.color, 0.5); ctx.lineWidth = legW; ctx.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(px - fy * 5 * sc * sgn, py - 12 * sc);
      ctx.lineTo(px - fy * 6 * sc * sgn + fx * stepA * sgn, py + fy * stepA * sgn * 0.5); ctx.stroke();
    }
    const ty = py - (heavy ? 22 : 18) * sc - Math.abs(Math.cos(walk)) * 1.5 * sc;
    const bw = (heavy ? 13 : 8) * sc, bh = (heavy ? 12 : 10) * sc;
    const g = ctx.createLinearGradient(px - bw, ty, px + bw, ty);
    g.addColorStop(0, flashW ? '#fff' : shade(def.color, 1.4)); g.addColorStop(1, flashW ? '#fff' : shade(def.color, 0.7));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(px - bw, ty - bh, bw * 2, bh * 2, 4 * sc); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    if (heavy) { ctx.fillStyle = shade(def.color, 0.8); ctx.fillRect(px - bw - 4 * sc, ty - bh, 5 * sc, bh); ctx.fillRect(px + bw - 1 * sc, ty - bh, 5 * sc, bh); }
    // arm cannons
    ctx.strokeStyle = '#18181b'; ctx.lineWidth = (heavy ? 5 : 3) * sc;
    for (const sgn of heavy ? [-1, 1] : [1]) {
      const ax = px - fy * bw * sgn, ay = ty + fx * 3 * sc * sgn;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + fx * 14 * sc, ay + fy * 14 * sc); ctx.stroke();
    }
    // visor
    ctx.fillStyle = eye; ctx.shadowColor = eye; ctx.shadowBlur = dormant ? 0 : 12;
    if (fy > -0.3) ctx.fillRect(px + fx * 3 * sc - 5 * sc, ty - bh * 0.6 + fy * 2, 10 * sc, 2.5 * sc);
    else ctx.fillRect(px - 2 * sc, ty - bh - 2 * sc, 4 * sc, 2 * sc);
    ctx.shadowBlur = 0;
    if (z.type === 'construct' || z.type === 'boss_colossus') { // ancient runes
      ctx.fillStyle = `rgba(253,224,71,${0.5 + Math.sin(now * 3 + z.id) * 0.3})`;
      ctx.fillRect(px - 2 * sc, ty - 2 * sc, 4 * sc, 8 * sc); ctx.fillRect(px - 6 * sc, ty + 2 * sc, 12 * sc, 2 * sc);
    }
    if (z.type === 'boss_hive') { // spawn ports
      for (let i = 0; i < 4; i++) { ctx.fillStyle = `rgba(240,171,252,${0.5 + Math.sin(now * 5 + i) * 0.4})`; ctx.beginPath(); ctx.arc(px + Math.cos(i * 1.57 + now) * bw * 0.6, ty + Math.sin(i * 1.57 + now) * bh * 0.4, 3 * sc, 0, TAU); ctx.fill(); }
    }
    if (z.type === 'phantom' && Math.random() < 0.3) { ctx.fillStyle = 'rgba(34,211,238,0.3)'; ctx.fillRect(px - bw, ty - bh + Math.random() * bh * 2, bw * 2, 1.5); }
    ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = 1;
  if (z.flags & 2 && Math.random() < 0.6) r.particle({ x: z.rx + rnd(-6, 6) * sc, y: z.ry, z: lift + rnd(8, 20) * sc, vx: 0, vy: 0, vz: rnd(30, 70), life: 0.4, color: Math.random() < 0.5 ? '#f97316' : '#fde047', size: 4 * sc, kind: 'c', grow: -6 });
  if (z.flags & 4) { ctx.strokeStyle = 'rgba(167,139,250,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(z.rx, z.ry * T - 4, 14 * sc, 6 * sc, now * 2, 0, 4); ctx.stroke(); }
  if (Math.random() < 0.004 && !hidden) r.burst(z.rx, z.ry, 2, '#fbbf24', 60, 1.5, 0.3, 12 * sc, { kind: 'spark' });
  if (dormant) { ctx.fillStyle = 'rgba(148,163,184,0.7)'; ctx.font = '700 10px Rajdhani'; ctx.textAlign = 'center'; ctx.fillText('dormant', px, py - 26 * sc); }
  else if (z.hp < 100 && !hidden && !boss) r.bar(px, py - (fly ? 16 : 28) * sc, 20 * Math.max(1, sc * 0.8), z.hp / 100, '#ef4444');
}

// ------------------------------------------------------------------ colony robots
export function drawRobot(r, b, now) {
  const { ctx } = r;
  const d = ROBOTS[b.type];
  const underground = d.layer === 'underground';
  const hover = underground ? 6 : 22 + Math.sin(now * 3 + b.id) * 3;
  const px = b.rx, py = b.ry * T - hover;
  const fx = Math.cos(b.ra), fy = Math.sin(b.ra) * T;
  if (b.type === 'combat_drone') {
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 2;
    for (const [ox, oy] of [[-9, -5], [9, -5], [-9, 5], [9, 5]]) {
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + ox, py + oy * T); ctx.stroke();
      ctx.fillStyle = 'rgba(200,200,200,0.35)'; ctx.beginPath(); ctx.ellipse(px + ox, py + oy * T - 2, 7, 2 + Math.abs(Math.sin(now * 40 + ox)) * 1.5, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(px, py, 7, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px, py + 2); ctx.lineTo(px + fx * 12, py + 2 + fy * 12); ctx.stroke();
  } else if (underground) { // tracked mining bots
    ctx.fillStyle = '#27272a'; ctx.fillRect(px - 10, py - 4, 20, 6);
    ctx.fillStyle = '#52525b'; for (let i = 0; i < 4; i++) ctx.fillRect(px - 9 + ((now * 20 + i * 5) % 18), py - 3, 2, 4);
    ctx.fillStyle = d.color; ctx.fillRect(px - 8, py - 14, 16, 10);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(px - 6, py - 12, 5, 3);
    if (b.type === 'digger_bot') {
      ctx.strokeStyle = '#d6d3d1'; ctx.lineWidth = 3;
      const sp = b.task === 'dig' ? now * 20 : 0;
      ctx.beginPath(); ctx.moveTo(px, py - 9); ctx.lineTo(px + fx * 14, py - 9 + fy * 14); ctx.stroke();
      ctx.fillStyle = '#a8a29e'; ctx.beginPath(); ctx.arc(px + fx * 15, py - 9 + fy * 15, 4 + Math.sin(sp) * 0.8, 0, TAU); ctx.fill();
      if (b.task === 'dig' && Math.random() < 0.6) r.burst(b.rx + Math.cos(b.ra) * 20, b.ry + Math.sin(b.ra) * 20, 2, '#fdba74', 90, 2, 0.3, 8, { kind: 'spark' });
    } else { ctx.fillStyle = '#78716c'; ctx.fillRect(px - 7, py - 20, 14, 6); }
  } else {
    ctx.fillStyle = `rgba(56,189,248,${0.4 + Math.random() * 0.3})`; ctx.beginPath(); ctx.ellipse(px, py + 9, 5, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(d.color, 0.7); ctx.beginPath(); ctx.ellipse(px, py + 2, 10, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = d.color; ctx.beginPath(); ctx.ellipse(px, py, 9, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.ellipse(px + fx * 4, py - 1 + fy * 2, 4, 2.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#22d3ee'; ctx.fillRect(px + fx * 4 - 1, py - 2 + fy * 2, 2, 1.5);
    if (b.task === 'repair' || b.task === 'collect') {
      ctx.strokeStyle = b.task === 'repair' ? 'rgba(74,222,128,0.7)' : 'rgba(251,191,36,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py + 6); ctx.lineTo(px + rnd(-4, 4), b.ry * T + 2); ctx.stroke();
    }
  }
  if (b.hp < 100) r.bar(px, py - 22, 18, b.hp / 100, '#22c55e');
}

// ------------------------------------------------------------------ projectiles
const BOLT_COLORS = { bolt: '#7dd3fc', beam: '#67e8f9' };
export function drawProjectile(r, pr, now) {
  const { ctx } = r;
  const sp = Math.hypot(pr.vx, pr.vy) || 1;
  const ux = pr.vx / sp, uy = (pr.vy / sp) * T;
  const z = 16;
  const x = pr.x, y = pr.y * T - z;
  switch (pr.kind) {
    case 'bolt': case 'beam': {
      const len = pr.kind === 'beam' ? 34 : 16, col = BOLT_COLORS[pr.kind];
      ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(x - ux * len, y - uy * len); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#f0f9ff'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(x - ux * len * 0.7, y - uy * len * 0.7); ctx.lineTo(x, y); ctx.stroke();
      break;
    }
    case 'rocket': case 'missile':
      ctx.fillStyle = '#e5e7eb'; ctx.save(); ctx.translate(x, y - (pr.kind === 'missile' ? 20 : 0)); ctx.rotate(Math.atan2(uy, ux));
      ctx.fillRect(-8, -2.5, 14, 5); ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.moveTo(6, -2.5); ctx.lineTo(10, 0); ctx.lineTo(6, 2.5); ctx.fill(); ctx.restore();
      r.particle({ x: pr.x - (pr.vx / sp) * 10, y: pr.y - (pr.vy / sp) * 10, z: z + (pr.kind === 'missile' ? 20 : 0), vx: rnd(-10, 10), vy: rnd(-10, 10), vz: 5, life: 0.25, color: '#fdba74', size: 5, kind: 'c', grow: -10 });
      r.smoke(pr.x - (pr.vx / sp) * 14, pr.y - (pr.vy / sp) * 14, z + (pr.kind === 'missile' ? 20 : 0), 1, 'rgba(180,180,180,', 6, 0.9);
      break;
    case 'plasma':
      ctx.fillStyle = '#e879f9'; ctx.shadowColor = '#d946ef'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x, y, 5 + Math.sin(now * 20), 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#fdf4ff'; ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
      break;
    case 'shell': { // mortar plasma lob: high arc
      const age = now - pr.born, flight = 1;
      const t = Math.min(1, age / flight);
      const arc = Math.sin(t * Math.PI) * 110;
      ctx.fillStyle = '#d8b4fe'; ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x, pr.y * T - 8 - arc, 6, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      r.particle({ x: pr.x, y: pr.y, z: 8 + arc, vx: 0, vy: 0, vz: 0, life: 0.3, color: '#c084fc', size: 4, kind: 'c', grow: -10 });
      break;
    }
    case 'grenade': case 'molotov': {
      const age = now - pr.born;
      const arc = Math.max(0, Math.sin(Math.min(1, age / 0.7) * Math.PI)) * 50;
      const gy = pr.y * T - 6 - arc;
      ctx.save(); ctx.translate(x, gy); ctx.rotate(age * 12);
      ctx.fillStyle = pr.kind === 'grenade' ? '#1e3a8a' : '#c2410c'; ctx.beginPath(); ctx.ellipse(0, 0, 5, 6, 0, 0, TAU); ctx.fill();
      ctx.restore();
      if (pr.kind === 'grenade' && Math.sin(now * 25) > 0) { ctx.fillStyle = '#60a5fa'; ctx.beginPath(); ctx.arc(x, gy - 7, 2, 0, TAU); ctx.fill(); }
      if (pr.kind === 'molotov') r.particle({ x: pr.x, y: pr.y, z: 6 + arc + 8, vx: rnd(-10, 10), vy: 0, vz: 20, life: 0.3, color: '#f97316', size: 4, kind: 'c', grow: -8 });
      break;
    }
  }
}

// ------------------------------------------------------------------ loot & points of interest
export function drawPickup(r, pk, now) {
  const { ctx } = r;
  const bob = 6 + Math.sin(now * 4 + pk.id) * 3;
  const x = pk.rx, y = pk.ry * T - bob;
  if (pk.ore) {
    const c = RESOURCES[pk.ore].color;
    ctx.fillStyle = shade(c, 0.7); ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 4); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c; ctx.fillRect(x - 1, y - 4, 2, 3);
  } else { // salvaged machine parts
    ctx.save(); ctx.translate(x, y); ctx.rotate(now * 2 + pk.id);
    ctx.fillStyle = '#a1a1aa'; ctx.fillRect(-5, -3, 10, 6);
    ctx.fillStyle = '#facc15'; ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
  if (Math.random() < 0.04) r.particle({ x: pk.rx, y: pk.ry, z: bob + 4, vx: rnd(-10, 10), vy: 0, vz: 30, life: 0.5, color: '#fef3c7', size: 2, kind: 'spark' });
}

export function drawPoi(r, poi, now, view) {
  const { ctx } = r;
  const x = poi.x, y = poi.y * T;
  const glow = poi.looted ? 0.1 : 0.55 + Math.sin(now * 2 + poi.id) * 0.3;
  if (poi.kind === 'monolith') {
    ctx.fillStyle = '#0c0a09'; ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 8, y - 70); ctx.lineTo(x + 8, y - 70); ctx.lineTo(x + 12, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x - 8, y - 70, 5, 70);
    ctx.fillStyle = `rgba(56,189,248,${glow})`;
    for (let i = 0; i < 6; i++) ctx.fillRect(x - 3 + (i % 2) * 2, y - 60 + i * 9, 6, 3);
    if (!poi.looted && Math.random() < 0.2) r.particle({ x: poi.x + rnd(-10, 10), y: poi.y, z: rnd(10, 60), vx: 0, vy: 0, vz: 20, life: 1, color: '#7dd3fc', size: 2, kind: 'c' });
  } else if (poi.kind === 'probe') {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x, y, 30, 12, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x, y - 10); ctx.rotate(0.4);
    ctx.fillStyle = '#d4d4d8'; ctx.beginPath(); ctx.ellipse(0, 0, 18, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#71717a'; ctx.fillRect(-4, -18, 3, 12);
    ctx.fillStyle = poi.looted ? '#3f3f46' : '#1e3a8a'; ctx.fillRect(-16, -4, 32, 4);
    ctx.restore();
    if (!poi.looted && Math.sin(now * 5 + poi.id) > 0.7) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(x - 2, y - 30, 2.5, 0, TAU); ctx.fill(); }
    if (!poi.looted && Math.random() < 0.05) r.burst(poi.x, poi.y, 2, '#fbbf24', 60, 2, 0.3, 10, { kind: 'spark' });
  } else { // ancient relic cache
    r.box(x - 14, poi.y - 10, 28, 20, 18, poi.looted ? '#3f3a2e' : '#a16207', poi.looted ? '#2a261d' : '#713f12');
    ctx.fillStyle = `rgba(253,224,71,${glow})`; ctx.fillRect(x - 10, (poi.y + 10) * T - 13, 20, 3);
    if (!poi.looted) { ctx.strokeStyle = `rgba(253,224,71,${glow})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 26, 11, now, 0, 4.5); ctx.stroke(); }
  }
  const me = view.me;
  if (!poi.looted && me && !me.d && Math.hypot(me.rx - poi.x, me.ry - poi.y) < 90) {
    r.prompt(x, y - (poi.kind === 'monolith' ? 82 : 40), poi.kind === 'probe' ? 'E  Salvage crashed probe' : 'E  Recover ancient technology');
  }
}

export function drawShrine(r, sh, now) {
  const { ctx } = r;
  const color = PERKS[sh.perk]?.color || '#fff';
  const sy = sh.y * T;
  ctx.fillStyle = '#44403c'; ctx.fillRect(sh.x - 8, sy - 24, 16, 24);
  const fy = sy - 40 + Math.sin(now * 3) * 4;
  ctx.save(); ctx.translate(sh.x, fy); ctx.rotate(now * 2);
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 0); ctx.lineTo(0, 9); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Rajdhani'; ctx.textAlign = 'center';
  ctx.fillText(`${PERKS[sh.perk]?.name || ''} (${sh.ttl}s)`, sh.x, sy - 56);
}
