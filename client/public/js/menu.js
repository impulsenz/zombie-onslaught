import { api, esc, toast } from './api.js';
import { STATS, STAT_MAX_RANK, WEAPONS, WEAPON_ORDER, xpForLevel } from '/shared/defs.js';

const $ = (id) => document.getElementById(id);
const screens = ['loading', 'login', 'blocked', 'menu'];
let me = null;
let roomTimer = null;

function show(name) {
  for (const s of screens) {
    const el = $(`screen-${s}`);
    el.classList.toggle('hidden', s !== name);
    el.classList.toggle('flex', s === name && s !== 'menu');
  }
  clearInterval(roomTimer);
  if (name === 'menu') { loadRooms(); roomTimer = setInterval(loadRooms, 5000); }
}

async function boot() {
  try {
    const { user } = await api('/me');
    setUser(user);
  } catch (err) {
    if (err.status === 401 || err.status === 403) await showLogin(err.status === 403 ? err.message : '');
    else { show('login'); $('login-error').textContent = err.message; $('login-error').classList.remove('hidden'); }
  }
}

function setUser(user) {
  me = user;
  if (user.status === 'pending') {
    $('blocked-icon').innerHTML = '&#9203;';
    $('blocked-title').textContent = 'Awaiting approval';
    $('blocked-text').textContent = 'An admin needs to approve your account before you can enter the arena. Check back soon.';
    return show('blocked');
  }
  if (user.status === 'banned') {
    $('blocked-icon').innerHTML = '&#9940;';
    $('blocked-title').textContent = 'Access revoked';
    $('blocked-text').textContent = 'This account has been banned by an administrator.';
    return show('blocked');
  }
  renderMenu();
  show('menu');
}

async function showLogin(errorText) {
  show('login');
  if (errorText) { $('login-error').textContent = errorText; $('login-error').classList.remove('hidden'); }
  const cfg = await api('/config');
  if (cfg.devLogin) $('dev-login').classList.remove('hidden');
  if (!cfg.googleClientId) { $('google-missing').classList.remove('hidden'); return; }
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleCredential, ux_mode: 'popup' });
    google.accounts.id.renderButton($('google-btn'), { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with' });
  };
  document.head.appendChild(script);
}

async function onGoogleCredential({ credential }) {
  try {
    const { user } = await api('/auth/google', { method: 'POST', body: { credential } });
    setUser(user);
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').classList.remove('hidden');
  }
}

$('dev-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const { user } = await api('/auth/dev', { method: 'POST', body: { name: f.get('name'), email: f.get('email') } });
    setUser(user);
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').classList.remove('hidden');
  }
});

document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.google?.accounts?.id?.disableAutoSelect?.();
  location.reload();
}));
$('blocked-refresh').addEventListener('click', boot);

// ---------------------------------------------------------------- menu
function renderMenu() {
  $('me-name').textContent = me.name;
  if (me.avatar) { $('me-avatar').src = me.avatar; $('me-avatar').classList.remove('hidden'); }
  $('admin-link').classList.toggle('hidden', me.role !== 'admin');
  $('me-level').textContent = me.level;
  const need = xpForLevel(me.level);
  $('me-xp-text').textContent = `${me.xp.toLocaleString()} / ${need.toLocaleString()}`;
  $('me-xp-bar').style.width = `${Math.min(100, (me.xp / need) * 100)}%`;
  $('me-points').textContent = me.points.toLocaleString();
  $('me-sp').textContent = me.skillPoints;
  $('me-kills').textContent = (me.totals?.kills || 0).toLocaleString();
  $('me-best').textContent = me.totals?.bestWave || 0;

  $('skills').innerHTML = Object.entries(STATS).map(([key, s]) => {
    const rank = me.stats[key] || 0;
    const pips = Array.from({ length: STAT_MAX_RANK }, (_, i) =>
      `<span class="h-2 flex-1 rounded-sm ${i < rank ? 'bg-sky-400' : 'bg-zinc-800'}"></span>`).join('');
    return `<li>
      <div class="flex items-center justify-between gap-2">
        <div><p class="font-semibold">${s.name} <span class="text-zinc-500">${rank}/${STAT_MAX_RANK}</span></p>
        <p class="text-xs text-zinc-500">${s.desc}</p></div>
        <button class="btn-secondary btn-sm" data-skill="${key}" ${me.skillPoints < 1 || rank >= STAT_MAX_RANK ? 'disabled' : ''}>+</button>
      </div>
      <div class="mt-1.5 flex gap-0.5">${pips}</div>
    </li>`;
  }).join('');

  $('armory').innerHTML = WEAPON_ORDER.map((id) => {
    const w = WEAPONS[id];
    const owned = me.unlockedWeapons.includes(id);
    const locked = me.level < w.level;
    const stat = w.kind === 'melee' ? `${w.damage} dmg melee` : `${w.damage}${w.pellets > 1 ? `x${w.pellets}` : ''} dmg, ${w.mag} mag`;
    const action = owned
      ? '<span class="chip bg-toxic-500/15 text-toxic-400">Owned</span>'
      : locked
        ? `<span class="chip bg-zinc-800 text-zinc-400">Lv ${w.level}</span>`
        : `<button class="btn-primary btn-sm" data-unlock="${id}" ${me.points < w.unlockCost ? 'disabled' : ''}>${w.unlockCost.toLocaleString()} pts</button>`;
    return `<li class="flex items-center justify-between gap-3 rounded-lg bg-zinc-950/60 p-3 ${owned ? '' : 'opacity-90'}">
      <div class="flex items-center gap-3">
        <span class="h-3 w-3 rounded-full" style="background:${w.color}"></span>
        <div><p class="font-semibold">${esc(w.name)}</p><p class="text-xs text-zinc-500">${stat}</p></div>
      </div>${action}</li>`;
  }).join('');
}

$('skills').addEventListener('click', async (e) => {
  const key = e.target.closest('[data-skill]')?.dataset.skill;
  if (!key) return;
  try { setUser((await api('/me/skills', { method: 'POST', body: { stat: key } })).user); } catch (err) { toast(err.message, 'bad'); }
});

$('armory').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-unlock]')?.dataset.unlock;
  if (!id) return;
  try {
    setUser((await api('/me/unlock', { method: 'POST', body: { weapon: id } })).user);
    toast(`${WEAPONS[id].name} unlocked!`, 'good');
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------------------------------------------------------------- rooms
async function loadRooms() {
  try {
    const { rooms } = await api('/rooms');
    $('rooms').innerHTML = rooms.length ? rooms.map((r) => `
      <li class="flex items-center justify-between gap-2 rounded-lg bg-zinc-950/60 p-3">
        <div class="min-w-0">
          <p class="truncate font-semibold">${esc(r.name)}</p>
          <p class="truncate text-xs text-zinc-500">${r.players}/${r.maxPlayers} players &middot; ${r.phase === 'gameover' ? 'game over' : `wave ${r.wave}`}${r.names.length ? ` &middot; ${esc(r.names.join(', '))}` : ''}</p>
        </div>
        <a class="btn-secondary btn-sm ${r.players >= r.maxPlayers ? 'pointer-events-none opacity-40' : ''}" href="/game.html?room=${encodeURIComponent(r.id)}">Join</a>
      </li>`).join('') : '<li class="text-sm text-zinc-500">No rooms yet - start one!</li>';
  } catch { /* transient */ }
}

$('refresh-rooms').addEventListener('click', loadRooms);
$('quick-play').addEventListener('click', () => { location.href = '/game.html?room=quick'; });
$('create-room').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { room } = await api('/rooms', { method: 'POST', body: { name: new FormData(e.target).get('name') } });
    location.href = `/game.html?room=${encodeURIComponent(room.id)}`;
  } catch (err) { toast(err.message, 'bad'); }
});

boot();
