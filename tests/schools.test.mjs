// School pages: built from data/schools.json by scripts/build-schools.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
for (const s of data.schools) s.uniformPhotos = s.uniformPhotos.filter((p) => !p.hidden);
const OFFLINE_CSS = process.env.TAILWIND_CSS ? readFileSync(process.env.TAILWIND_CSS, 'utf8') : null;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function open(slug, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.route(/^https?:/, (r) => {
    const u = r.request().url();
    if (u.includes('cdn.tailwindcss.com')) return OFFLINE_CSS ? r.fulfill({ contentType: 'text/javascript', body: '' }) : r.continue();
    return r.abort();
  });
  await page.goto('file://' + path.join(root, 'schools', slug + '.html'), { waitUntil: 'load' });
  if (OFFLINE_CSS) await page.addStyleTag({ content: OFFLINE_CSS });
  await page.waitForTimeout(300);
  return page;
}

test('school pages are up to date with data/schools.json', () => {
  const before = data.schools.map((s) => readFileSync(path.join(root, 'schools', s.slug + '.html'), 'utf8'));
  execFileSync('node', [path.join(root, 'scripts/build-schools.mjs')]);
  const after = data.schools.map((s) => readFileSync(path.join(root, 'schools', s.slug + '.html'), 'utf8'));
  assert.deepEqual(after, before, 'run: node scripts/build-schools.mjs and commit the result');
});

test('every school on the home page links to its own page', () => {
  const home = readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const s of data.schools) {
    assert.ok(home.includes(`href="schools/${s.slug}.html"`), `home page should link to ${s.slug}`);
    assert.ok(existsSync(path.join(root, 'schools', s.slug + '.html')));
    assert.ok(existsSync(path.join(root, 'assets', s.logo)), `missing logo ${s.logo}`);
  }
});

for (const s of data.schools) {
  test(`${s.slug}: SEO, one h1, every class has a call button`, async () => {
    const page = await open(s.slug);
    const r = await page.evaluate(() => ({
      title: document.title, desc: document.querySelector('meta[name=description]').content,
      h1: document.querySelectorAll('h1').length, h1text: document.querySelector('h1').innerText,
      classes: [...document.querySelectorAll('details[id^="class-"]')].map((d) => ({
        id: d.id, call: !!d.querySelector('a[href^="tel:"][data-call]'), wa: !!d.querySelector('a[href*="wa.me"]'),
      })),
      chips: [...document.querySelectorAll('a[data-open]')].map((a) => a.getAttribute('href')),
      badImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
      tel: [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')),
      unsafe: [...document.querySelectorAll('a[target=_blank]')].filter((a) => !/noopener/.test(a.rel)).length,
    }));
    assert.match(r.title, new RegExp(s.fullName.replace('.', '\\.')));
    assert.ok(r.desc.length <= 160, `description ${r.desc.length} chars`);
    assert.equal(r.h1, 1); assert.match(r.h1text, /Uniform/);
    assert.equal(r.classes.length, data.classes.length);
    for (const c of r.classes) { assert.ok(c.call, `${c.id} has no call button`); assert.ok(c.wa, `${c.id} has no WhatsApp`); }
    assert.deepEqual(r.chips, r.classes.map((c) => '#' + c.id));
    assert.deepEqual(r.badImgs, []);
    assert.equal(r.unsafe, 0);
    assert.ok(r.tel.every((t) => /^tel:\+91\d{10}$/.test(t)));
  });
}

test('tapping a class button opens that class list', async () => {
  const page = await open(data.schools[0].slug);
  await page.click('a[data-open="class-5"]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('class-5').open), true);
});

test('phone: call bar is always on screen and never covers the footer', async () => {
  for (const w of [320, 390]) {
    const page = await open(data.schools[0].slug, w);
    const r = await page.evaluate(async () => {
      const bar = document.querySelector('[data-call$=":bar"]').getBoundingClientRect();
      const top = { visible: bar.bottom <= innerHeight && bar.top > 0 };
      document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 200));
      const bar2 = document.querySelector('[data-call$=":bar"]').parentElement.getBoundingClientRect();
      const last = document.querySelector('footer p:last-child').getBoundingClientRect();
      return { ...top, overlaps: last.bottom > bar2.top, scrollW: document.documentElement.scrollWidth, w: innerWidth };
    });
    assert.ok(r.visible, `${w}px: call bar not visible`);
    assert.equal(r.overlaps, false, `${w}px: call bar covers the footer text`);
    assert.equal(r.scrollW, r.w, `${w}px: page scrolls sideways`);
  }
});

test('desktop: floating buttons instead of the phone bar, no sideways scroll', async () => {
  const page = await open(data.schools[0].slug, 1280);
  const r = await page.evaluate(() => ({
    bar: document.querySelector('[data-call$=":bar"]').getBoundingClientRect().width,
    float: document.querySelector('[data-call$=":float"]').getBoundingClientRect().width,
    scrollW: document.documentElement.scrollWidth, w: innerWidth,
  }));
  assert.equal(r.bar, 0); assert.ok(r.float > 0); assert.equal(r.scrollW, r.w);
});

test('phone tap targets are at least 44px', async () => {
  const page = await open(data.schools[0].slug, 390);
  const small = await page.evaluate(() => [...document.querySelectorAll('main a, header a, nav a, summary')]
    .filter((a) => a.getBoundingClientRect().height > 0 && a.getBoundingClientRect().height < 44)
    .map((a) => a.innerText.trim().slice(0, 30) + ':' + Math.round(a.getBoundingClientRect().height)));
  assert.deepEqual(small, []);
});

test('every image on the school pages exists', () => {
  for (const s of data.schools) {
    const html = readFileSync(path.join(root, 'schools', s.slug + '.html'), 'utf8');
    for (const m of html.matchAll(/src="\.\.\/(assets\/[^"]+)"/g)) assert.ok(existsSync(path.join(root, m[1])), `${s.slug}: missing ${m[1]}`);
  }
});

test('no school page claims official supplier, delivery or prices', () => {
  for (const s of data.schools) {
    const t = readFileSync(path.join(root, 'schools', s.slug + '.html'), 'utf8').toLowerCase();
    for (const bad of ['official supplier', 'authorised', 'authorized', 'home delivery', 'free delivery', '₹']) assert.ok(!t.includes(bad), `${s.slug}: ${bad}`);
    assert.ok(!/\brs\.?\s*\d/.test(t), `${s.slug}: shows a price`);
  }
});
