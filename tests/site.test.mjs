// Run: npm install && npx playwright install chromium && npm test
// Needs internet (Tailwind loads from its CDN). Set TAILWIND_CSS=/path/to/built.css to run offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = 'file://' + path.join(root, 'index.html');
const OFFLINE_CSS = process.env.TAILWIND_CSS ? readFileSync(process.env.TAILWIND_CSS, 'utf8') : null;
const PHONES = ['+919926504567', '+919826390495', '+917974569831'];
const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1920];

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function open(width = 390, height = 800, { fontScale } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  // Only the site itself and Tailwind are allowed; everything else (maps, fonts, icons) is blocked so tests are repeatable.
  await page.route(/^https?:/, (r) => {
    if (OFFLINE_CSS && r.request().url().includes('cdn.tailwindcss.com')) return r.fulfill({ contentType: 'text/javascript', body: '' });
    if (r.request().url().includes('cdn.tailwindcss.com')) return r.continue();
    return r.abort();
  });
  await page.goto(url, { waitUntil: 'load' });
  if (OFFLINE_CSS) await page.addStyleTag({ content: OFFLINE_CSS });
  if (fontScale) await page.addStyleTag({ content: `html{font-size:${fontScale}% !important}` });
  await page.waitForTimeout(400);
  return page;
}

test('every in-page link points to a section that exists', async () => {
  const page = await open();
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href')).filter((h) => !document.querySelector(h)));
  assert.deepEqual(bad, []);
});

test('every local image file exists', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<img[^>]+src="(assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(files.length >= 13, 'expected 7 logos + 6 category images');
  for (const f of files) assert.ok(existsSync(path.join(root, f)), `missing ${f}`);
});

test('new-tab links are safe and phone numbers are the shop\'s own', async () => {
  const page = await open();
  const r = await page.evaluate(() => ({
    unsafe: [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/noopener/.test(a.rel)).map((a) => a.href),
    tel: [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href').slice(4)),
    wa: [...document.querySelectorAll('a[href^="https://wa.me/"]')].map((a) => a.getAttribute('href').split('/')[3].split('?')[0]),
  }));
  assert.deepEqual(r.unsafe, []);
  for (const t of r.tel) assert.ok(PHONES.includes(t), `unknown phone ${t}`);
  for (const w of r.wa) assert.ok(PHONES.includes('+' + w), `unknown WhatsApp number ${w}`);
  for (const p of PHONES) assert.ok(r.tel.includes(p), `footer should list ${p}`);
});

test('WhatsApp category buttons carry a ready-made message', async () => {
  const page = await open();
  const msgs = await page.evaluate(() =>
    [...document.querySelectorAll('#products a[href*="wa.me"]')].map((a) => decodeURIComponent(new URL(a.href).searchParams.get('text') || '')));
  assert.equal(msgs.length, 6);
  for (const m of msgs) assert.match(m, /^Hello Agrawal Stores, I want to ask about \S/);
});

test('every category card offers Call first and WhatsApp second', async () => {
  const page = await open();
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('#products h3')].map((h) => {
      const links = [...h.closest('div.flex-col').querySelectorAll('a')].map((a) => a.getAttribute('href'));
      return { name: h.innerText, first: links[0] || '', second: links[1] || '' };
    }));
  assert.equal(cards.length, 6);
  for (const c of cards) {
    assert.match(c.first, /^tel:\+919926504567$/, `${c.name}: first button should call`);
    assert.match(c.second, /^https:\/\/wa\.me\//, `${c.name}: second button should be WhatsApp`);
  }
});

test('Google Maps links go to the one correct listing', async () => {
  const page = await open();
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href*="google.com/maps"], a[href*="goo.gl"]')].map((a) => a.href));
  assert.ok(links.length >= 2);
  for (const l of links) assert.match(l, /cid=7134028350108918958/, 'must use the Uniform store listing, not the old general store');
});

test('SEO basics: title, description length, one h1, lang, structured data', async () => {
  const page = await open();
  const r = await page.evaluate(() => ({
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.content || '',
    h1: document.querySelectorAll('h1').length,
    lang: document.documentElement.lang,
    ld: document.querySelector('script[type="application/ld+json"]')?.textContent,
    viewport: !!document.querySelector('meta[name="viewport"]'),
  }));
  assert.match(r.title, /Agrawal Stores/); assert.match(r.title, /Rajendra Nagar/);
  assert.ok(r.title.length <= 70, `title is ${r.title.length} chars`);
  assert.ok(r.desc.length >= 80 && r.desc.length <= 160, `description is ${r.desc.length} chars; Google cuts at about 160`);
  assert.equal(r.h1, 1); assert.equal(r.lang, 'en'); assert.ok(r.viewport);
  const ld = JSON.parse(r.ld);
  assert.equal(ld['@type'], 'Store'); assert.equal(ld.address.postalCode, '452012');
  assert.deepEqual(ld.telephone, PHONES);
  assert.ok(ld.geo && ld.hasMap);
});

test('accessibility: alt text, link names, iframe title, heading order', async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    const levels = [...document.querySelectorAll('h1,h2,h3')].map((h) => +h.tagName[1]);
    return {
      noAlt: [...document.images].filter((i) => !i.alt.trim()).length,
      noName: [...document.querySelectorAll('a,button')].filter((a) => !(a.innerText.trim() || a.getAttribute('aria-label'))).length,
      iframeNoTitle: [...document.querySelectorAll('iframe')].filter((f) => !f.title).length,
      skipped: levels.some((l, i) => i && l - levels[i - 1] > 1),
      decorativeIconsExposed: [...document.querySelectorAll('i.fa-solid, i.fa-brands')].filter((i) => i.getAttribute('aria-hidden') !== 'true').length,
      fakeClickable: [...document.querySelectorAll('.cursor-pointer')].filter((e) => !e.closest('a,button')).length,
    };
  });
  assert.equal(r.noAlt, 0); assert.equal(r.noName, 0); assert.equal(r.iframeNoTitle, 0); assert.equal(r.skipped, false);
  assert.equal(r.decorativeIconsExposed, 0, 'decorative icons should be aria-hidden');
  assert.equal(r.fakeClickable, 0, 'school logos look clickable but are not');
});

test('no leftover placeholder text', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8').toLowerCase();
  for (const bad of ['lorem', 'todo', 'xxx', 'example.com', 'your-phone']) assert.ok(!html.includes(bad), bad);
});

test('the shop does not claim things it does not do', () => {
  const text = readFileSync(path.join(root, 'index.html'), 'utf8').toLowerCase();
  for (const bad of ['free delivery', 'home delivery', 'we deliver', 'open daily', '24/7', 'best in indore', 'most trusted'])
    assert.ok(!text.includes(bad), `remove claim: ${bad}`);
});

for (const w of WIDTHS) {
  test(`layout at ${w}px: no sideways scroll, no broken images, first school fully reachable`, async () => {
    const page = await open(w);
    const r = await page.evaluate(() => {
      const strip = document.querySelector('#schools .overflow-x-auto');
      const first = strip.firstElementChild.getBoundingClientRect();
      return {
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
        stripLeft: Math.round(first.left), stripScrollLeft: strip.scrollLeft,
      };
    });
    assert.equal(r.scrollW, r.innerW, 'page scrolls sideways');
    assert.equal(r.broken, 0);
    assert.ok(r.stripLeft >= 0, `first school logo is cut off on the left (left edge at ${r.stripLeft}px)`);
  });
}

test('menu: pills on phones, links on larger screens, never both', async () => {
  for (const [w, phone] of [[320, true], [639, true], [640, false], [1280, false]]) {
    const page = await open(w);
    const r = await page.evaluate(() => {
      const shown = (el) => el && el.getBoundingClientRect().width > 0;
      return { pills: shown(document.querySelector('nav .sm\\:hidden')), links: shown(document.querySelector('nav .hidden')) };
    });
    assert.equal(r.pills, phone, `${w}px pills`); assert.equal(r.links, !phone, `${w}px links`);
    await page.close();
  }
});

test('touch targets on phones are at least 44px tall', async () => {
  const page = await open(390);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('nav .sm\\:hidden a, header a, #products a, .fixed a')]
      .map((a) => ({ t: a.innerText.trim() || a.getAttribute('aria-label'), h: Math.round(a.getBoundingClientRect().height) }))
      .filter((x) => x.h < 44));
  assert.deepEqual(small, []);
});

test('tapping a menu item shows the section heading below the sticky bar', async () => {
  for (const w of [390, 1280]) {
    const page = await open(w);
    for (const id of ['schools', 'products', 'story', 'location']) {
      await page.evaluate((i) => { location.hash = '#' + i; }, id);
      await page.waitForTimeout(450);
      const r = await page.evaluate((i) => {
        const nav = document.querySelector('nav').getBoundingClientRect().bottom;
        const target = document.getElementById(i);
        const head = target.querySelector('h2, span, p') || target;
        return { nav, top: head.getBoundingClientRect().top };
      }, id);
      const atBottom = await page.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 2);
      if (id !== 'location' || !atBottom) assert.ok(r.top >= r.nav - 1, `${w}px #${id}: heading hidden under the bar (top ${r.top}, bar ${r.nav})`);
    }
    await page.close();
  }
});

test('floating call/WhatsApp buttons never cover the last line of the footer', async () => {
  const page = await open(390, 700);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.body.scrollHeight); });
  await page.waitForTimeout(200);
  const overlap = await page.evaluate(() => {
    const c = document.querySelector('footer p:last-child').getBoundingClientRect();
    return [...document.querySelectorAll('.fixed a')].some((b) => {
      const r = b.getBoundingClientRect();
      return !(r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom);
    });
  });
  assert.equal(overlap, false);
});

test('a missing logo falls back once and does not loop forever', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  let fallbackTries = 0;
  await page.route(/^https?:/, (r) => { if (r.request().url().includes('placehold.co')) fallbackTries++; return r.abort(); });
  const html = readFileSync(path.join(root, 'index.html'), 'utf8').replace('assets/sns.png', 'assets/does-not-exist.png');
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  assert.ok(fallbackTries <= 2, `fallback image requested ${fallbackTries} times: it keeps retrying`);
});

test('large text (browser set to 200%) at 320px still has no sideways scroll', async () => {
  const page = await open(320, 800, { fontScale: 200 });
  const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: innerWidth }));
  assert.equal(r.s, r.w);
});

test('content stays readable if the icon font fails to load', async () => {
  const page = await open(390);
  const emptyButtons = await page.evaluate(() => [...document.querySelectorAll('a')].filter((a) => !a.innerText.trim() && !a.getAttribute('aria-label')).length);
  assert.equal(emptyButtons, 0);
});
