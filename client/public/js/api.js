// Tiny fetch wrapper for the JSON API (cookies carry the session).
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function toast(text, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  const color = kind === 'bad' ? 'border-blood-500' : kind === 'good' ? 'border-toxic-500' : 'border-amber-400';
  el.className = `panel border-l-4 ${color} px-4 py-2 text-sm shadow-lg transition-opacity duration-500`;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); }, 3500);
}
