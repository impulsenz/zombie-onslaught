import { api, esc, toast } from './api.js';

const $ = (id) => document.getElementById(id);
let me = null;
let users = [];
let grantTarget = null;

const fmtDate = (s) => (s ? new Date(s).toLocaleString() : '-');
const ago = (s) => {
  if (!s) return '-';
  const m = Math.round((Date.now() - new Date(s)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const STATUS_CHIP = {
  pending: 'chip bg-amber-400/15 text-amber-300',
  approved: 'chip bg-toxic-500/15 text-toxic-400',
  banned: 'chip bg-blood-500/15 text-blood-400',
};

// ---------------------------------------------------------------- tabs
function showTab(name) {
  for (const p of document.querySelectorAll('[data-panel]')) p.classList.toggle('hidden', p.dataset.panel !== name);
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('bg-zinc-800', b.dataset.tab === name);
  location.hash = name;
  ({ overview: loadOverview, users: loadUsers, sessions: loadSessions, logs: loadLogs })[name]?.();
}
$('tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) showTab(t.dataset.tab); });

// ---------------------------------------------------------------- overview
async function loadOverview() {
  const s = await api('/admin/stats');
  const cards = [
    ['Users', s.users, 'text-zinc-100'], ['Pending', s.pending, 'text-amber-300'], ['Approved', s.approved, 'text-toxic-400'],
    ['Banned', s.banned, 'text-blood-400'], ['Admins', s.admins, 'text-sky-400'], ['Live rooms', s.rooms, 'text-zinc-100'],
    ['Players online', s.playersOnline, 'text-zinc-100'],
  ];
  $('stat-cards').innerHTML = cards.map(([label, v, color]) =>
    `<div class="panel p-4"><p class="text-xs uppercase tracking-wider text-zinc-500">${label}</p><p class="font-display text-3xl ${color}">${v}</p></div>`).join('');
  for (const r of document.querySelectorAll('input[name=access]')) r.checked = r.value === s.accessMode;

  const { users: pending } = await api('/admin/users?status=pending');
  $('approve-all').disabled = !pending.length;
  $('pending-list').innerHTML = pending.length ? pending.map((u) => `
    <li class="flex items-center justify-between gap-3 py-2">
      <div>${userCell(u)}</div>
      <div class="flex gap-2">
        <button class="btn-primary btn-sm" data-act="approve" data-id="${u.id}">Approve</button>
        <button class="btn-secondary btn-sm" data-act="ban" data-id="${u.id}">Deny</button>
      </div>
    </li>`).join('') : '<li class="py-2 text-sm text-zinc-500">Nobody is waiting.</li>';
  $('approve-all').onclick = async () => {
    for (const u of pending) await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'approved' } });
    toast(`Approved ${pending.length} user(s)`, 'good');
    loadOverview();
  };
}

document.addEventListener('change', async (e) => {
  if (e.target.name !== 'access') return;
  try {
    await api('/admin/settings', { method: 'PUT', body: { accessMode: e.target.value } });
    toast(`Access mode set to ${e.target.value}`, 'good');
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------------------------------------------------------------- users
function userCell(u) {
  const avatar = u.avatar
    ? `<img src="${esc(u.avatar)}" class="h-8 w-8 rounded-full" alt="" referrerpolicy="no-referrer" />`
    : `<span class="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold">${esc(u.name[0] || '?')}</span>`;
  return `<div class="flex items-center gap-3">${avatar}<div><p class="font-semibold">${esc(u.name)} ${u.online ? '<span class="chip bg-toxic-500/15 text-toxic-400">online</span>' : ''}</p><p class="text-xs text-zinc-500">${esc(u.email)}</p></div></div>`;
}

let searchTimer = null;
async function loadUsers() {
  const q = new URLSearchParams({ search: $('user-search').value, status: $('user-status').value });
  ({ users } = await api(`/admin/users?${q}`));
  $('user-rows').innerHTML = users.map((u) => {
    const self = u.id === me.id;
    const actions = [];
    if (u.status !== 'approved') actions.push(`<button class="btn-primary btn-sm" data-act="approve" data-id="${u.id}">Approve</button>`);
    if (u.status === 'approved' && !self) actions.push(`<button class="btn-secondary btn-sm" data-act="revoke" data-id="${u.id}">Revoke</button>`);
    if (u.status !== 'banned' && !self) actions.push(`<button class="btn-secondary btn-sm text-blood-400" data-act="ban" data-id="${u.id}">Ban</button>`);
    if (u.role === 'user') actions.push(`<button class="btn-secondary btn-sm" data-act="promote" data-id="${u.id}">Make admin</button>`);
    else if (!self) actions.push(`<button class="btn-secondary btn-sm" data-act="demote" data-id="${u.id}">Remove admin</button>`);
    actions.push(`<button class="btn-secondary btn-sm" data-act="grant" data-id="${u.id}">Grant</button>`);
    return `<tr class="hover:bg-zinc-900/60">
      <td class="p-3">${userCell(u)}</td>
      <td class="p-3"><span class="${STATUS_CHIP[u.status]}">${u.status}</span></td>
      <td class="p-3">${u.role === 'admin' ? '<span class="chip bg-sky-400/15 text-sky-300">admin</span>' : 'user'}</td>
      <td class="p-3">${u.level} <span class="text-xs text-zinc-500">(${u.skillPoints} SP)</span></td>
      <td class="p-3">${u.points.toLocaleString()}</td>
      <td class="p-3">${(u.totals?.kills || 0).toLocaleString()} / ${u.totals?.bestWave || 0}</td>
      <td class="p-3 text-zinc-400" title="${fmtDate(u.lastLoginAt)}">${ago(u.lastLoginAt)}</td>
      <td class="p-3"><div class="flex flex-wrap justify-end gap-1">${actions.join('')}</div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="p-6 text-center text-zinc-500">No users match.</td></tr>';
}
$('user-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadUsers, 250); });
$('user-status').addEventListener('change', loadUsers);

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === 'grant') return openGrant(id);
  const patch = { approve: { status: 'approved' }, revoke: { status: 'pending' }, ban: { status: 'banned' }, promote: { role: 'admin' }, demote: { role: 'user' } }[act];
  if (!patch) return;
  if ((act === 'ban' || act === 'promote' || act === 'demote') && !confirm(`Are you sure you want to ${act} this user?`)) return;
  btn.disabled = true;
  try {
    await api(`/admin/users/${id}`, { method: 'PATCH', body: patch });
    toast('User updated', 'good');
  } catch (err) { toast(err.message, 'bad'); }
  const tab = location.hash.slice(1) || 'overview';
  if (tab === 'users') loadUsers(); else loadOverview();
});

async function openGrant(id) {
  if (!users.length) ({ users } = await api('/admin/users'));
  grantTarget = users.find((u) => u.id === id);
  if (!grantTarget) return;
  $('grant-user').textContent = `${grantTarget.name} (${grantTarget.email}) - Lv ${grantTarget.level}, ${grantTarget.points} pts`;
  $('grant-form').reset();
  $('grant-dialog').showModal();
}

$('grant-dialog').addEventListener('close', async () => {
  if ($('grant-dialog').returnValue !== 'ok' || !grantTarget) return;
  const f = new FormData($('grant-form'));
  try {
    await api(`/admin/users/${grantTarget.id}/grant`, {
      method: 'POST', body: { points: Number(f.get('points')), xp: Number(f.get('xp')), skillPoints: Number(f.get('skillPoints')) },
    });
    toast(`Granted rewards to ${grantTarget.name}`, 'good');
    loadUsers();
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------------------------------------------------------------- sessions
async function loadSessions() {
  const { sessions, live } = await api('/admin/sessions');
  $('live-rooms').innerHTML = live.length ? live.map((r) => `
    <li class="flex items-center justify-between gap-3 py-2">
      <div><p class="font-semibold">${esc(r.name)} <span class="text-xs text-zinc-500">#${esc(r.id)}</span></p>
      <p class="text-xs text-zinc-400">${r.players}/${r.maxPlayers} players &middot; ${esc(r.phase)} &middot; wave ${r.wave}${r.names.length ? ` &middot; ${esc(r.names.join(', '))}` : ''}</p></div>
      <button class="btn-secondary btn-sm text-blood-400" data-close-room="${esc(r.id)}">Close room</button>
    </li>`).join('') : '<li class="py-2 text-sm text-zinc-500">No live rooms.</li>';
  $('session-rows').innerHTML = sessions.map((s) => {
    const dur = s.endedAt ? Math.round((new Date(s.endedAt) - new Date(s.startedAt)) / 60000) : null;
    return `<tr><td class="p-3">${esc(s.roomName || s.roomId)}</td><td class="p-3 text-zinc-400">${fmtDate(s.startedAt)}</td>
      <td class="p-3">${dur === null ? '<span class="chip bg-toxic-500/15 text-toxic-400">running</span>' : `${dur} min`}</td>
      <td class="p-3">${s.waveReached}</td><td class="p-3">${esc(s.outcome || '-')}</td>
      <td class="p-3 text-xs text-zinc-400">${(s.players || []).map((p) => `${esc(p.name)} (${p.kills}k)`).join(', ')}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="p-6 text-center text-zinc-500">No games recorded yet.</td></tr>';
}

document.addEventListener('click', async (e) => {
  const id = e.target.closest('[data-close-room]')?.dataset.closeRoom;
  if (!id || !confirm('Close this room and kick all players?')) return;
  try { await api(`/admin/rooms/${id}`, { method: 'DELETE' }); toast('Room closed', 'good'); } catch (err) { toast(err.message, 'bad'); }
  loadSessions();
});

// ---------------------------------------------------------------- logs
async function loadLogs() {
  const { logs } = await api('/admin/logs');
  $('log-rows').innerHTML = logs.map((l) => `<tr>
    <td class="p-3 text-zinc-400" title="${fmtDate(l.createdAt)}">${ago(l.createdAt)}</td>
    <td class="p-3">${esc(l.adminEmail)}</td>
    <td class="p-3"><span class="chip bg-zinc-800 text-zinc-200">${esc(l.action)}</span></td>
    <td class="p-3 font-mono text-xs text-zinc-400">${esc(JSON.stringify(l.details))}</td></tr>`).join('')
    || '<tr><td colspan="4" class="p-6 text-center text-zinc-500">No admin actions yet.</td></tr>';
}

// ---------------------------------------------------------------- boot
(async () => {
  try {
    ({ user: me } = await api('/me'));
    if (me.role !== 'admin') { location.href = '/'; return; }
    showTab(location.hash.slice(1) || 'overview');
  } catch { location.href = '/'; }
})();
