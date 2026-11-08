// The page builder: runs cleanly twice, escapes odd text, and keeps the sitemap honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'site-'));
  for (const f of ['index.html', 'data', 'scripts', 'assets']) cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  return dir;
}
const build = (dir) => execFileSync('node', ['scripts/build-schools.mjs'], { cwd: dir, encoding: 'utf8' });

test('building twice gives the same pages (no doubled links on the home page)', () => {
  const dir = sandbox();
  const sec = JSON.parse(readFileSync(path.join(dir, 'data/sections.json'), 'utf8'));
  sec.sections[0].photos = [{ file: 'x.webp', caption: 'Test bag' }];
  writeFileSync(path.join(dir, 'data/sections.json'), JSON.stringify(sec));
  build(dir);
  const first = readFileSync(path.join(dir, 'index.html'), 'utf8');
  build(dir);
  const second = readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal(first, second);
  assert.equal(second.split(`sections/${sec.sections[0].slug}.html`).length - 1, 1, 'exactly one See photos link');
  // and removing the photos removes the page and the link again
  sec.sections[0].photos = [];
  writeFileSync(path.join(dir, 'data/sections.json'), JSON.stringify(sec));
  build(dir);
  assert.ok(!readFileSync(path.join(dir, 'index.html'), 'utf8').includes(`sections/${sec.sections[0].slug}.html`));
  assert.ok(!existsSync(path.join(dir, 'sections', `${sec.sections[0].slug}.html`)));
});

test('captions and names with &, quotes and < > are escaped, not broken HTML', () => {
  const dir = sandbox();
  const d = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8'));
  d.schools[0].uniformPhotos = [{ file: 'blue-house.webp', caption: 'Tie & belt "set" <new>' }];
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  build(dir);
  const html = readFileSync(path.join(dir, 'schools', `${d.schools[0].slug}.html`), 'utf8');
  assert.ok(html.includes('Tie &amp; belt &quot;set&quot; &lt;new&gt;'));
  assert.ok(!html.includes('<new>'));
});

test('a school with no photos still gets a sensible uniform section', () => {
  const dir = sandbox();
  const d = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8'));
  d.schools[0].uniformPhotos = [];
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  build(dir);
  const html = readFileSync(path.join(dir, 'schools', `${d.schools[0].slug}.html`), 'utf8');
  assert.ok(html.includes('Daily uniform') && html.includes('Winter wear'));
});

test('a missing home-page marker stops the build instead of silently skipping', () => {
  const dir = sandbox();
  const p = path.join(dir, 'index.html');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/<!--sec:gifts-toys-->.*?<!--\/sec:gifts-toys-->/s, ''));
  assert.throws(() => build(dir), /gifts-toys/);
});

test('sitemap lists exactly the pages that exist', () => {
  const xml = readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>https:\/\/agrawalstores\.in\/([^<]*)<\/loc>/g)].map((m) => m[1] || 'index.html');
  for (const u of urls) assert.ok(existsSync(path.join(root, u)), `sitemap lists missing page ${u}`);
  const pages = ['index.html', ...readdirSync(path.join(root, 'schools')).map((f) => `schools/${f}`),
    ...(existsSync(path.join(root, 'sections')) ? readdirSync(path.join(root, 'sections')).map((f) => `sections/${f}`) : [])];
  assert.deepEqual([...urls].sort(), pages.sort());
});

test('every school in the data has a card on the home page, and no extra cards', () => {
  const d = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
  const home = readFileSync(path.join(root, 'index.html'), 'utf8');
  const cards = [...home.matchAll(/href="schools\/([a-z0-9-]+)\.html"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(cards)].sort(), d.schools.map((s) => s.slug).sort());
});

test('the photo studio script makes a 1000x1250 WebP (skipped if Python libraries are missing)', (t) => {
  try { execFileSync('python3', ['-c', 'import cv2, numpy, PIL'], { stdio: 'ignore' }); } catch { return t.skip('python libs missing'); }
  const out = path.join(os.tmpdir(), `studio-${process.pid}.webp`);
  const code = `import sys;sys.path.insert(0,'scripts');import studio;from PIL import Image,ImageDraw
im=Image.new('RGBA',(600,500),(0,0,0,0));d=ImageDraw.Draw(im);d.rectangle((100,80,500,420),fill=(30,60,160,255));d.ellipse((20,20,90,90),fill=(230,40,120,255))
studio.compose(studio.grabcut_clean(im),'${out}')
r=Image.open('${out}');print(r.size,r.format)`;
  const res = execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8' });
  assert.match(res, /\(1000, 1250\) WEBP/);
});

test('every src and srcset file on every page exists (including the footer photo)', () => {
  const pages = ['index.html', ...readdirSync(path.join(root, 'schools')).map((f) => `schools/${f}`),
    ...(existsSync(path.join(root, 'sections')) ? readdirSync(path.join(root, 'sections')).map((f) => `sections/${f}`) : [])];
  const missing = [];
  for (const pg of pages) {
    const html = readFileSync(path.join(root, pg), 'utf8');
    const refs = [...html.matchAll(/\ssrc="([^"]+)"/g)].map((m) => m[1]);
    for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) refs.push(...m[1].split(',').map((x) => x.trim().split(/\s+/)[0]));
    for (const r of refs) {
      if (/^(https?:|data:)/.test(r)) continue;
      if (!existsSync(path.join(root, path.dirname(pg), r))) missing.push(`${pg}: ${r}`);
    }
  }
  assert.deepEqual(missing, []);
});
