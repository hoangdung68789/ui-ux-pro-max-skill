#!/usr/bin/env node
/**
 * Build a static, server-less preview of the homepage (CSS/JS inlined, content pre-rendered).
 *   node scripts/build-preview.js <out-dir>
 * The quote form shows a preview notice instead of posting to /api/leads.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { renderIndex } = require('../server');

const root = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'preview-dist'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const content = JSON.parse(read('data/content.json'));
let html = renderIndex(read('public/index.html'), content);
const css = read('public/styles.css');
const js = read('public/app.js');

html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/\s*<meta charset="utf-8">/i, '')
  .replace(/\s*<meta name="viewport"[^>]*>/i, '')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="app.js" defer></script>', '')
  .replace(/<title>[^<]*<\/title>/, '<title>Thiên Khôi CDC</title>')
  .replace('data-form novalidate', 'data-form data-preview novalidate')
  .trim();
html += `\n<script>\ndocument.documentElement.lang = 'vi';\n${js}\n</script>\n`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'thien-khoi-cdc.html'), html);
fs.cpSync(path.join(root, 'public/assets'), path.join(out, 'assets'), { recursive: true });
console.log(`Preview -> ${path.join(out, 'thien-khoi-cdc.html')}`);
