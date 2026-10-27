/* Thiên Khôi CDC — lead management (talks to /api/leads with a Bearer token) */
(() => {
  'use strict';

  const STATUS = { new: 'Mới', contacted: 'Đã liên hệ', quoted: 'Đã báo giá', won: 'Đã ký', lost: 'Không thành' };
  const $ = (s) => document.querySelector(s);
  const loginForm = $('[data-login]');
  const panel = $('[data-panel]');
  const rows = $('[data-rows]');
  const empty = $('[data-empty]');
  const filter = $('[data-filter]');
  const search = $('[data-search]');
  const logoutBtn = $('[data-logout]');

  let token = '';
  try { token = sessionStorage.getItem('tk-admin') || ''; } catch {}
  let leads = [];
  let content = { services: [], budgets: [] };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (res.status === 401) { logout('Mã quản trị không đúng hoặc đã hết hạn.'); throw new Error('unauthorized'); }
    return res;
  }

  async function load() {
    const [l, c] = await Promise.all([api('/api/leads'), fetch('/api/content')]);
    leads = (await l.json()).leads || [];
    content = await c.json();
    loginForm.hidden = true;
    panel.hidden = false;
    logoutBtn.hidden = false;
    render();
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const st = filter.value;
    const list = leads.filter((l) => (!st || l.status === st) && (!q || [l.name, l.phone, l.email, l.location, l.message].join(' ').toLowerCase().includes(q)));
    const svc = (id) => content.services.find((s) => s.id === id)?.title || 'Khác';
    const bud = (id) => content.budgets.find((b) => b.id === id)?.label || '';

    rows.innerHTML = list.map((l) => `
      <tr data-id="${esc(l.id)}" class="${l.status === 'new' ? 'badge-new' : ''}">
        <td>${esc(fmtDate(l.createdAt))}</td>
        <td><strong>${esc(l.name)}</strong><small><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></small>${l.email ? `<small><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></small>` : ''}</td>
        <td>${esc(svc(l.service))}<small>${esc([bud(l.budget), l.area ? `${l.area} m²` : '', l.location].filter(Boolean).join(' · '))}</small></td>
        <td class="msg">${esc(l.message)}</td>
        <td><select data-status aria-label="Trạng thái">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><textarea data-note rows="2" aria-label="Ghi chú nội bộ">${esc(l.note)}</textarea></td>
        <td><button class="del" type="button" data-del>Xóa</button></td>
      </tr>`).join('');
    empty.hidden = list.length > 0;

    const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, leads.filter((l) => l.status === k).length]));
    $('[data-stats]').innerHTML = `<div class="stat"><b>${leads.length}</b><span>Tổng yêu cầu</span></div>` +
      Object.entries(STATUS).map(([k, v]) => `<div class="stat"><b>${counts[k]}</b><span>${v}</span></div>`).join('');
  }

  async function patch(id, body, el) {
    const res = await api(`/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!res.ok) return alert('Không lưu được, vui lòng thử lại.');
    const { lead } = await res.json();
    leads = leads.map((l) => (l.id === id ? lead : l));
    el.classList.add('saved');
    setTimeout(() => el.classList.remove('saved'), 900);
  }

  rows.addEventListener('change', (e) => {
    const id = e.target.closest('tr')?.dataset.id;
    if (!id) return;
    if (e.target.matches('[data-status]')) patch(id, { status: e.target.value }, e.target).then(render);
    if (e.target.matches('[data-note]')) patch(id, { note: e.target.value }, e.target);
  });
  rows.addEventListener('click', async (e) => {
    if (!e.target.matches('[data-del]')) return;
    const tr = e.target.closest('tr');
    const lead = leads.find((l) => l.id === tr.dataset.id);
    if (!confirm(`Xóa yêu cầu của "${lead?.name}"? Không thể hoàn tác.`)) return;
    const res = await api(`/api/leads/${tr.dataset.id}`, { method: 'DELETE' });
    if (res.ok) { leads = leads.filter((l) => l.id !== tr.dataset.id); render(); }
  });

  filter.addEventListener('change', render);
  search.addEventListener('input', render);
  $('[data-refresh]').addEventListener('click', () => load().catch(() => {}));
  $('[data-export]').addEventListener('click', async () => {
    const res = await api('/api/leads.csv');
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `thienkhoi-leads-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function logout(msg = '') {
    token = '';
    try { sessionStorage.removeItem('tk-admin'); } catch {}
    panel.hidden = true;
    logoutBtn.hidden = true;
    loginForm.hidden = false;
    $('[data-login-msg]').textContent = msg;
  }
  logoutBtn.addEventListener('click', () => logout());

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    token = loginForm.elements.token.value.trim();
    try { sessionStorage.setItem('tk-admin', token); } catch {}
    load().catch(() => {});
  });

  if (token) load().catch(() => {});
})();
