'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_TOKEN = 'test-token';
const LEADS = path.join(__dirname, '..', 'data', 'leads.json');
const backup = fs.existsSync(LEADS) ? fs.readFileSync(LEADS) : null;
const { server } = require('../server');
let base;

before(async () => {
  if (fs.existsSync(LEADS)) fs.unlinkSync(LEADS);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  if (backup) fs.writeFileSync(LEADS, backup);
  else if (fs.existsSync(LEADS)) fs.unlinkSync(LEADS);
});

const auth = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
const post = (body) => fetch(`${base}/api/leads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('renders index with content and no leftover placeholders', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Thiên Khôi CDC/);
  assert.match(html, /Thi công trọn gói/);
  assert.doesNotMatch(html, /\{\{/);
});

test('static files and traversal guard', async () => {
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/assets/frames/lg/f180.webp')).status, 200);
  assert.notEqual((await fetch(base + '/..%2Fserver.js')).status, 200);
  assert.equal((await fetch(base + '/nope')).status, 404);
});

test('lead validation', async () => {
  const res = await post({ name: 'A', phone: '123', service: 'x' });
  assert.equal(res.status, 422);
  const { errors } = await res.json();
  assert.ok(errors.name && errors.phone && errors.service);
});

test('lead lifecycle: create, list, update, csv, delete', async () => {
  const res = await post({ name: 'Nguyễn Văn A', phone: '0901 234 567', service: 'tron-goi', budget: '3-5ty', area: '120', message: '=cmd' });
  assert.equal(res.status, 201);
  const { id } = await res.json();

  assert.equal((await fetch(`${base}/api/leads`)).status, 401);
  const list = await (await fetch(`${base}/api/leads`, { headers: auth })).json();
  assert.equal(list.leads[0].phone, '0901234567');
  assert.equal(list.leads[0].area, 120);

  const upd = await fetch(`${base}/api/leads/${id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'contacted', note: 'gọi lại thứ 2' }) });
  assert.equal((await upd.json()).lead.status, 'contacted');

  const csv = await (await fetch(`${base}/api/leads.csv`, { headers: auth })).text();
  assert.match(csv, /"'=cmd"/);

  assert.equal((await fetch(`${base}/api/leads/${id}`, { method: 'DELETE', headers: auth })).status, 200);
});

test('honeypot silently accepted but not stored', async () => {
  const res = await post({ name: 'Bot', phone: '0901234567', service: 'tron-goi', website: 'spam' });
  assert.equal(res.status, 200);
  const list = await (await fetch(`${base}/api/leads`, { headers: auth })).json();
  assert.equal(list.leads.length, 0);
});
