#!/usr/bin/env node
/**
 * Turn a few "where to look" keyframes into a smooth per-frame crop path for a 9:16 cut of a
 * 16:9 video, written as an ffmpeg sendcmd file for a filter named crop@rf.
 *
 *   node scripts/reframe-path.js <keys.json|-> <fps> <duration> <srcWidth> <cropWidth> > cmd.txt
 *
 * keys.json: { "keys": [[timeSeconds, centerX], ...] }, centerX from 0 (left edge) to 1 (right).
 * Pass "-" (or a missing file) for a plain centred crop.
 * The path is a Catmull-Rom spline through the keys, so the virtual camera pans without
 * stopping at every keyframe.
 */
'use strict';

const fs = require('node:fs');

const [file, fpsArg, durArg, srcArg, cropArg] = process.argv.slice(2);
const fps = Number(fpsArg);
const duration = Number(durArg);
const srcW = Number(srcArg);
const cropW = Number(cropArg);
if (!fps || !duration || !srcW || !cropW) {
  console.error('Usage: reframe-path.js <keys.json|-> <fps> <duration> <srcWidth> <cropWidth>');
  process.exit(1);
}

let keys = [[0, 0.5]];
if (file && file !== '-' && fs.existsSync(file)) keys = JSON.parse(fs.readFileSync(file, 'utf8')).keys;
keys = keys.slice().sort((a, b) => a[0] - b[0]);

const catmull = (p0, p1, p2, p3, u) =>
  0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);

function centerAt(t) {
  if (keys.length === 1 || t <= keys[0][0]) return keys[0][1];
  const last = keys.length - 1;
  if (t >= keys[last][0]) return keys[last][1];
  let i = 0;
  while (keys[i + 1][0] < t) i++;
  const [t1, x1] = keys[i];
  const [t2, x2] = keys[i + 1];
  const x0 = (keys[i - 1] || keys[i])[1];
  const x3 = (keys[i + 2] || keys[i + 1])[1];
  return catmull(x0, x1, x2, x3, (t - t1) / (t2 - t1));
}

const maxX = srcW - cropW;
const lines = [];
const frames = Math.ceil(duration * fps);
for (let n = 0; n < frames; n++) {
  const t = n / fps;
  const x = Math.round(Math.min(maxX, Math.max(0, centerAt(t) * srcW - cropW / 2)) / 2) * 2;
  lines.push(`${t.toFixed(4)} crop@rf x ${x};`);
}
process.stdout.write(lines.join('\n') + '\n');
