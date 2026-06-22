// 공통 API / 유틸 (모든 페이지에서 사용)

export async function api(path, { method = 'GET', body, headers } = {}) {
  const opt = { method, headers: { ...(headers || {}) }, credentials: 'same-origin' };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(path, opt);
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  if (!res.ok) {
    const err = new Error((data && data.error) || `요청 실패 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function getMe() {
  try {
    const { user } = await api('/api/auth/me');
    return user;
  } catch {
    return null;
  }
}

export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  location.href = '/';
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return bytes + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { bytes /= 1024; i++; } while (bytes >= 1024 && i < u.length - 1);
  return bytes.toFixed(1) + ' ' + u[i];
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastBox;
export function toast(message, type = 'ok', ms = 3000) {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toast';
    document.body.appendChild(toastBox);
  }
  const t = el(`<div class="t ${type}">${escapeHtml(message)}</div>`);
  toastBox.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}
