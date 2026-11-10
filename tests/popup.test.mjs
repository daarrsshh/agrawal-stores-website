// Product pop-up: tap a photo -> large photo with its name, Call and Book; closes with X, Esc, outside tap or Back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
for (const s of data.schools) s.uniformPhotos = s.uniformPhotos.filter((p) => !p.hidden);
const { sections } = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8'));
for (const s of sections) s.photos = s.photos.filter((p) => !p.hidden);
const school = data.schools.find((s) => s.uniformPhotos.length > 1);
const pages = [`schools/${school.slug}.html`, ...sections.filter((s) => s.photos.length).map((s) => `sections/${s.slug}.html`)];

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function open(file, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto('file://' + path.join(root, file), { waitUntil: 'load' });
  return page;
}
const state = (page) => page.evaluate(() => {
  const d = document.getElementById('zoom');
  return { open: d.open, cap: document.getElementById('zoom-cap').textContent, img: document.getElementById('zoom-img').getAttribute('src'),
    call: document.getElementById('zoom-call').getAttribute('href'), book: document.getElementById('zoom-book').getAttribute('href') };
});

for (const file of pages) {
  test(`${file}: tapping a photo opens it large with its own name, Call and Book`, async () => {
    const page = await open(file);
    const figs = page.locator('figure');
    const n = await figs.count();
    for (const i of [0, n - 1]) {
      const fig = figs.nth(i);
      const want = { cap: (await fig.locator('figcaption').textContent()).trim(),
        call: await fig.locator('a[href^="tel:"]').getAttribute('href'), book: await fig.locator('a[href*="wa.me"]').getAttribute('href') };
      await fig.locator('[data-zoom]').click();
      const s = await state(page);
      assert.ok(s.open, 'pop-up open');
      assert.equal(s.cap.trim(), want.cap);
      assert.equal(s.call, want.call);
      assert.equal(s.book.replace(/&amp;/g, '&'), want.book.replace(/&amp;/g, '&'));
      assert.match(s.img, /assets\/(uniforms|gallery)\//);
      const box = await page.locator('#zoom').boundingBox();
      assert.ok(box.width <= 390 && box.height <= 800, 'fits the phone screen');
      await page.locator('[data-zoom-close]').click();
      assert.equal((await state(page)).open, false, 'X closes it');
    }
    await page.close();
  });
}

test('the pop-up closes with Esc, a tap outside the photo, and the phone Back button, and Back does not leave the page', async () => {
  const page = await open(pages[0]);
  const url = page.url();
  const first = page.locator('[data-zoom]').first();
  await first.click(); await page.keyboard.press('Escape');
  assert.equal((await state(page)).open, false, 'Esc');
  await first.click(); await page.mouse.click(5, 5);
  assert.equal((await state(page)).open, false, 'outside tap');
  await first.click(); await page.goBack(); await page.waitForTimeout(200);
  assert.equal((await state(page)).open, false, 'Back closes the pop-up');
  assert.equal(page.url(), url, 'Back did not leave the page');
  await page.close();
});

test('keyboard users can open the pop-up with Enter, and focus goes into it', async () => {
  const page = await open(pages[0], 1280);
  await page.locator('[data-zoom]').first().focus();
  await page.keyboard.press('Enter');
  const s = await state(page);
  assert.ok(s.open);
  assert.ok(await page.evaluate(() => document.getElementById('zoom').contains(document.activeElement)), 'focus inside the pop-up');
  await page.close();
});

test('pop-up appears only on pages with product photos', () => {
  assert.ok(!readFileSync(path.join(root, 'index.html'), 'utf8').includes('id="zoom"'));
  for (const s of data.schools) {
    const html = readFileSync(path.join(root, 'schools', `${s.slug}.html`), 'utf8');
    assert.equal(html.includes('data-zoom '), s.uniformPhotos.length > 0, s.slug);
  }
  assert.ok(existsSync(path.join(root, pages[0])));
});
