#!/usr/bin/env node
/**
 * Thiên Khôi CDC — website server (zero dependencies, Node >= 18).
 *
 *   node server.js                 -> http://localhost:3000
 *   PORT=8080 ADMIN_TOKEN=... node server.js
 *
 * - Renders public/index.html with data/content.json (SEO-friendly, single source of content)
 * - Serves static assets from public/
 * - REST API: /api/content, /api/leads (public POST, admin GET/PATCH/DELETE), /api/leads.csv
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(18).toString('base64url');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const MAX_BODY = 16 * 1024;
const LEAD_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

/* ------------------------------------------------------------------ */
/* Content + server-side rendering                                     */
/* ------------------------------------------------------------------ */

let contentCache = { mtimeMs: 0, data: null, html: null, templateMtimeMs: 0 };

async function getContent() {
  const [cStat, tStat] = await Promise.all([
    fsp.stat(CONTENT_FILE),
    fsp.stat(path.join(PUBLIC_DIR, 'index.html')),
  ]);
  if (contentCache.data && cStat.mtimeMs === contentCache.mtimeMs && tStat.mtimeMs === contentCache.templateMtimeMs) {
    return contentCache;
  }
  const data = JSON.parse(await fsp.readFile(CONTENT_FILE, 'utf8'));
  const template = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  contentCache = { mtimeMs: cStat.mtimeMs, templateMtimeMs: tStat.mtimeMs, data, html: renderIndex(template, data) };
  return contentCache;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  compass: '<circle cx="12" cy="5" r="2"/><path d="M12 7 6 21M12 7l6 14M8.5 15h7"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2 2M15 8l2 2"/>',
  sofa: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4ZM5 18v2M19 18v2"/>',
  hammer: '<path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="M17.6 15 22 10.6 13.4 2 9 6.4l2 2 1.4-1.4 5.2 5.2-1.4 1.4 1.4 1.4Z"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  facebook: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8Z"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="m10 9 5 3-5 3V9Z"/>',
  tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.8 2.4 4.6 5 5"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.layers}</svg>`;

// Footer blocks for the parent group. A link whose `url` is still empty falls back to the
// group website, so nothing on the page is a dead link.
function renderGroup(g) {
  if (!g) return {};
  const ext = (url) => `href="${esc(url)}" target="_blank" rel="noopener"`;
  const link = (item) => `<li><a ${ext(item.url || g.website)}${item.current ? ' aria-current="page"' : ''}>${esc(item.label)}</a></li>`;
  return {
    GROUP_ABOUT: g.about.map(link).join(''),
    GROUP_BRANDS: g.brands.map(link).join(''),
    GROUP_OFFICES: g.offices
      .map(
        (o) => `<li class="office">${icon('pin')}<div><h4>${esc(o.title)}</h4><p>${esc(o.address)}</p>
          <a class="office__map" ${ext(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`)}>Chỉ đường <span aria-hidden="true">↗</span></a></div></li>`
      )
      .join(''),
    GROUP_SOCIAL: g.social
      .filter((x) => x.url)
      .map((x) => `<a class="social" ${ext(x.url)} aria-label="${esc(x.label)}">${icon(x.icon)}</a>`)
      .join(''),
    GROUP_POLICIES: g.policies.filter((x) => x.url).map((x) => `<a ${ext(x.url)}>${esc(x.label)}</a>`).join(''),
  };
}

function renderIndex(template, c) {
  const pad = (n) => String(n).padStart(2, '0');
  const blocks = {
    COMMITMENTS: c.commitments
      .map((x, i) => `<li class="commit reveal"><span class="commit__num">${pad(i + 1)}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></li>`)
      .join(''),
    SERVICES: c.services
      .map(
        (s, i) => `<article class="service reveal" data-tilt>
          <div class="service__top">${icon(s.icon)}<span class="service__num">${pad(i + 1)}</span></div>
          <h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>
          <a class="service__link" href="#bao-gia" data-service="${esc(s.id)}">Nhận báo giá <span aria-hidden="true">→</span></a>
        </article>`
      )
      .join(''),
    PROCESS: c.process
      .map((p, i) => `<li class="step reveal"><span class="step__num">${pad(i + 1)}</span><div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div></li>`)
      .join(''),
    PROJECTS: c.projects
      .map(
        (p, i) => `<figure class="project reveal${i === 0 ? ' project--wide' : ''}">
          <button type="button" class="project__btn" data-lightbox="${esc(p.image)}" data-caption="${esc(p.title)} — ${esc(p.text)}" aria-label="Xem ảnh lớn: ${esc(p.title)}">
            <img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" decoding="async" width="1120" height="630">
          </button>
          <figcaption><span class="project__cat">${esc(p.category)}</span><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></figcaption>
        </figure>`
      )
      .join(''),
    SERVICE_OPTIONS: c.services.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('') + '<option value="khac">Khác / cần tư vấn</option>',
    BUDGET_OPTIONS: c.budgets.map((b) => `<option value="${esc(b.id)}">${esc(b.label)}</option>`).join(''),
    YEAR: String(new Date().getFullYear()),
    ...renderGroup(c.group),
    JSONLD: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'GeneralContractor',
      name: c.company.name,
      description: c.company.description,
      telephone: c.company.phoneHref,
      email: c.company.email,
      url: c.company.siteUrl,
      address: { '@type': 'PostalAddress', addressLocality: c.company.address, addressCountry: 'VN' },
      areaServed: 'Thành phố Hồ Chí Minh',
    }).replace(/</g, '\\u003c'),
  };
  for (const [k, v] of Object.entries(c.company)) blocks[`company.${k}`] = esc(v);
  for (const [k, v] of Object.entries(c.group || {})) if (typeof v === 'string') blocks[`group.${k}`] = esc(v);
  // {{{RAW}}} for pre-rendered HTML, {{escaped}} for company fields
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (m, k) => (k in blocks ? blocks[k] : m))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (k in blocks ? blocks[k] : m));
}

/* ------------------------------------------------------------------ */
/* Leads storage (JSON file, serialized atomic writes)                  */
/* ------------------------------------------------------------------ */

let writeChain = Promise.resolve();

async function readLeads() {
  try {
    return JSON.parse(await fsp.readFile(LEADS_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function mutateLeads(fn) {
  const run = writeChain.then(async () => {
    const leads = await readLeads();
    const result = fn(leads);
    const tmp = `${LEADS_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(leads, null, 2));
    await fsp.rename(tmp, LEADS_FILE);
    return result;
  });
  writeChain = run.catch(() => {});
  return run;
}

function validateLead(body, content) {
  const errors = {};
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const lead = {
    name: str(body.name, 80),
    phone: str(body.phone, 20).replace(/[\s.\-()]/g, ''),
    email: str(body.email, 120),
    service: str(body.service, 40),
    budget: str(body.budget, 40),
    location: str(body.location, 120),
    area: body.area === '' || body.area == null ? null : Number(body.area),
    message: str(body.message, 2000),
  };
  if (lead.name.length < 2) errors.name = 'Vui lòng nhập họ tên.';
  if (!/^(\+?84|0)(3|5|7|8|9)\d{8}$/.test(lead.phone)) errors.phone = 'Số điện thoại chưa đúng (VD: 0901 234 567).';
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) errors.email = 'Email chưa đúng định dạng.';
  const serviceIds = content.services.map((s) => s.id).concat('khac');
  if (!serviceIds.includes(lead.service)) errors.service = 'Vui lòng chọn dịch vụ.';
  if (lead.budget && !content.budgets.some((b) => b.id === lead.budget)) errors.budget = 'Ngân sách không hợp lệ.';
  if (lead.area !== null && (!Number.isFinite(lead.area) || lead.area <= 0 || lead.area > 100000)) errors.area = 'Diện tích không hợp lệ.';
  return { lead, errors };
}

/* naive in-memory rate limit: 5 submissions / 10 minutes / IP */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > windowMs) hits.delete(k);
  return list.length > 5;
}

async function notifyTelegram(lead, content) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const service = content.services.find((s) => s.id === lead.service)?.title || 'Khác';
  const budget = content.budgets.find((b) => b.id === lead.budget)?.label || '—';
  const text = [
    '🏗 Yêu cầu báo giá mới — Thiên Khôi CDC',
    `Họ tên: ${lead.name}`,
    `SĐT: ${lead.phone}`,
    lead.email && `Email: ${lead.email}`,
    `Dịch vụ: ${service}`,
    `Ngân sách: ${budget}`,
    lead.area && `Diện tích: ${lead.area} m²`,
    lead.location && `Khu vực: ${lead.location}`,
    lead.message && `Ghi chú: ${lead.message}`,
  ].filter(Boolean).join('\n');
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn('[telegram] notify failed:', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Dữ liệu gửi lên quá lớn.'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Dữ liệu không hợp lệ.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const clientIp = (req) =>
  (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return `"${s.replace(/"/g, '""')}"`;
};

async function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Yêu cầu không hợp lệ');
  }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Không có quyền truy cập');
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return notFound(res);
  }
  if (!stat.isFile()) return notFound(res);
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cache = rel.startsWith('/assets/') ? 'public, max-age=604800' : 'public, max-age=300';
  if (req.headers['if-none-match'] === etag) return send(res, 304, '', { ETag: etag, 'Cache-Control': cache });
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cache,
    'Accept-Ranges': 'bytes',
    ETag: etag,
  };
  // Byte ranges: Safari/iOS will not play (or seek) <video> without them
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` });
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function notFound(res) {
  send(res, 404, '<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:2rem">Không tìm thấy trang. <a href="/">Về trang chủ</a></p>', {
    'Content-Type': MIME['.html'],
  });
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/health') return json(res, 200, { ok: true });

  if (pathname === '/api/content' && method === 'GET') {
    const { data } = await getContent();
    return json(res, 200, data);
  }

  if (pathname === '/api/leads' && method === 'POST') {
    if (rateLimited(clientIp(req))) return json(res, 429, { ok: false, message: 'Bạn gửi quá nhiều yêu cầu, vui lòng thử lại sau ít phút.' });
    const body = await readBody(req);
    if (body.website) return json(res, 200, { ok: true }); // honeypot: silently drop bots
    const { data } = await getContent();
    const { lead, errors } = validateLead(body, data);
    if (Object.keys(errors).length) return json(res, 422, { ok: false, errors });
    const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: 'new', note: '', ...lead };
    await mutateLeads((leads) => leads.unshift(record));
    notifyTelegram(record, data);
    console.log(`[lead] ${record.createdAt} ${record.name} ${record.phone} (${record.service})`);
    return json(res, 201, { ok: true, id: record.id });
  }

  if (pathname.startsWith('/api/leads')) {
    if (!isAdmin(req)) return json(res, 401, { ok: false, message: 'Sai mã quản trị.' });

    if (pathname === '/api/leads' && method === 'GET') {
      const status = url.searchParams.get('status');
      const leads = await readLeads();
      return json(res, 200, { ok: true, leads: status ? leads.filter((l) => l.status === status) : leads });
    }

    if (pathname === '/api/leads.csv' && method === 'GET') {
      const leads = await readLeads();
      const cols = ['createdAt', 'status', 'name', 'phone', 'email', 'service', 'budget', 'area', 'location', 'message', 'note'];
      const csv = '﻿' + [cols.join(','), ...leads.map((l) => cols.map((c) => csvCell(l[c])).join(','))].join('\r\n');
      return send(res, 200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="thienkhoi-leads.csv"',
        'Cache-Control': 'no-store',
      });
    }

    const m = pathname.match(/^\/api\/leads\/([0-9a-f-]{36})$/);
    if (m && method === 'PATCH') {
      const body = await readBody(req);
      if (body.status !== undefined && !LEAD_STATUSES.includes(body.status)) return json(res, 422, { ok: false, message: 'Trạng thái không hợp lệ.' });
      const updated = await mutateLeads((leads) => {
        const lead = leads.find((l) => l.id === m[1]);
        if (!lead) return null;
        if (body.status !== undefined) lead.status = body.status;
        if (typeof body.note === 'string') lead.note = body.note.slice(0, 1000);
        lead.updatedAt = new Date().toISOString();
        return lead;
      });
      return updated ? json(res, 200, { ok: true, lead: updated }) : json(res, 404, { ok: false, message: 'Không tìm thấy.' });
    }
    if (m && method === 'DELETE') {
      const removed = await mutateLeads((leads) => {
        const i = leads.findIndex((l) => l.id === m[1]);
        return i >= 0 ? leads.splice(i, 1).length : 0;
      });
      return removed ? json(res, 200, { ok: true }) : json(res, 404, { ok: false, message: 'Không tìm thấy.' });
    }
    return json(res, 405, { ok: false, message: 'Phương thức không được hỗ trợ.' });
  }

  if (pathname.startsWith('/api/')) return json(res, 404, { ok: false, message: 'Không tìm thấy.' });

  if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Phương thức không được hỗ trợ');

  if (pathname === '/' || pathname === '/index.html') {
    const { html } = await getContent();
    return send(res, 200, method === 'HEAD' ? '' : html, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
  if (pathname === '/admin') return serveStatic(req, res, '/admin.html');
  return serveStatic(req, res, pathname);
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) json(res, status, { ok: false, message: status === 500 ? 'Lỗi máy chủ, vui lòng thử lại.' : err.message });
    else res.end();
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Thiên Khôi CDC  →  http://localhost:${PORT}`);
    console.log(`Quản trị        →  http://localhost:${PORT}/admin`);
    if (!process.env.ADMIN_TOKEN) console.log(`ADMIN_TOKEN (tạm thời, đặt trong .env để cố định): ${ADMIN_TOKEN}`);
  });
}

module.exports = { server, renderIndex, validateLead };
