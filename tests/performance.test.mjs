// Speed budget: keeps the site light on mobile data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
for (const s of data.schools) s.uniformPhotos = s.uniformPhotos.filter((p) => !p.hidden);
const pages = ['index.html', ...data.schools.map((s) => `schools/${s.slug}.html`)];
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const kb = (p) => statSync(p).size / 1024;

test('pages load no external scripts or stylesheets except Google Fonts', () => {
  for (const p of pages) {
    const html = read(p);
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, [], `${p} loads scripts: ${scripts}`);
    const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>|<link[^>]+href="[^"]+"[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0].match(/href="([^"]+)"/)[1]);
    for (const h of css) assert.ok(h.endsWith('assets/site.css') || h.startsWith('https://fonts.googleapis.com/'), `${p}: unexpected stylesheet ${h}`);
  }
});

test('assets/site.css is up to date (run npm run build)', () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'css-')), 'site.css');
  execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'), ['-c', 'tailwind.config.js', '-i', 'src/input.css', '-o', out, '--minify'], { cwd: root, stdio: 'ignore' });
  assert.equal(readFileSync(out, 'utf8'), read('assets/site.css'), 'styles changed: run npm run build and commit assets/site.css');
});

test('every icon used on a page is defined on that page', () => {
  for (const p of pages) {
    const html = read(p);
    const used = new Set([...html.matchAll(/<use href="#(i-[a-z-]+)"/g)].map((m) => m[1]));
    for (const id of used) assert.ok(html.includes(`<symbol id="${id}"`), `${p}: icon ${id} missing`);
    assert.ok(!html.includes('fa-solid') && !html.includes('fa-brands'), `${p}: old Font Awesome class left`);
  }
});

test('image size budget', () => {
  for (const s of data.schools) assert.ok(kb(path.join(root, 'assets', s.logo)) <= 30, `${s.logo} is over 30 KB`);
  for (const f of ['shop-banner.webp', 'shop-front.webp']) assert.ok(kb(path.join(root, 'assets', f)) <= 150, `${f} is over 150 KB`);
  for (const p of pages) {
    for (const m of read(p).matchAll(/src="((?:\.\.\/)?assets\/uniforms\/[^"]+)"/g)) {
      const f = path.join(root, path.dirname(p), m[1]);
      assert.ok(existsSync(f), `${p}: missing ${m[1]}`);
      assert.ok(kb(f) <= 250, `${m[1]} is ${Math.round(kb(f))} KB: run npm run images`);
    }
  }
});

test('home page total weight (HTML + CSS + images) stays under 500 KB', () => {
  const html = read('index.html');
  const local = new Set(['index.html', 'assets/site.css', ...[...html.matchAll(/src="(assets\/[^"]+)"/g)].map((m) => m[1])]);
  const total = [...local].reduce((sum, f) => sum + kb(path.join(root, f)), 0);
  assert.ok(total <= 500, `home page is ${Math.round(total)} KB`);
});

test('banner photo reserves its space so the page does not jump while loading', () => {
  const img = read('index.html').match(/<img[^>]+shop-banner[^>]*>/)[0];
  assert.match(img, /width="\d+"/); assert.match(img, /height="\d+"/); assert.match(img, /fetchpriority="high"/);
  assert.ok(!/loading="lazy"/.test(img), 'banner must not be lazy-loaded');
});
