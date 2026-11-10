// "Tap anywhere": cards, logos and pictures open what people expect; Call/WhatsApp buttons still do their own job.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
data.schools = data.schools.filter((s) => !s.hidden);
for (const s of data.schools) s.uniformPhotos = s.uniformPhotos.filter((p) => !p.hidden);
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function open(file, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: width < 500, isMobile: width < 500 });
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto('file://' + path.join(root, file), { waitUntil: 'load' });
  return page;
}
// What a tap at the centre of an element would open.
const tapTarget = (page, el) => el.evaluate((e) => {
  document.documentElement.style.scrollBehavior = 'auto';
  e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = e.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const a = hit && hit.closest('a');
  return a ? a.getAttribute('href') : null;
});

for (const width of [390, 1280]) {
  test(`home at ${width}px: tapping a card's title, text, picture or empty space opens it; Call/WhatsApp keep working`, async () => {
    const page = await open('index.html', width);
    const cards = page.locator('#products h3');
    const n = await cards.count();
    const shownSections = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8')).sections.filter((s) => !s.hidden).length;
    assert.equal(n, 1 + shownSections, 'uniforms card + one card per shown section');
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i).locator('xpath=ancestor::div[contains(@class,"group")][1]');
      const title = (await cards.nth(i).textContent()).trim();
      const expected = i === 0 ? '#schools' : await card.locator('a[href^="sections/"]').last().getAttribute('href');
      for (const part of ['h3', 'p', 'img']) assert.equal(await tapTarget(page, card.locator(part).first()), expected, `${title}: tap on ${part}`);
      assert.equal(await tapTarget(page, card.locator('a[href^="tel:"]')), 'tel:+919926504567', `${title}: Call still calls`);
      assert.match(await tapTarget(page, card.locator('a[href*="wa.me"]')), /wa\.me/, `${title}: WhatsApp still opens WhatsApp`);
    }
    await page.close();
  });

  test(`home at ${width}px: every school logo and name opens that school's page`, async () => {
    const page = await open('index.html', width);
    for (const s of data.schools) {
      const card = page.locator(`#schools a[href="schools/${s.slug}.html"]`);
      assert.equal(await tapTarget(page, card.locator('img')), `schools/${s.slug}.html`, `${s.slug} logo`);
      assert.equal(await tapTarget(page, card.locator('span').first()), `schools/${s.slug}.html`, `${s.slug} name`);
    }
    await page.close();
  });
}

test('school pages: "Other schools we stock" shows each school with its logo, and the logo opens it', async () => {
  for (const s of data.schools) {
    const page = await open(`schools/${s.slug}.html`, 390);
    const chips = page.locator('section[aria-labelledby="other-h"] a');
    assert.equal(await chips.count(), data.schools.length - 1, s.slug);
    for (let i = 0; i < await chips.count(); i++) {
      const href = await chips.nth(i).getAttribute('href');
      assert.equal(await tapTarget(page, chips.nth(i).locator('img')), href);
      assert.ok(await chips.nth(i).locator('img').evaluate((im) => im.complete || im.loading === 'lazy'));
    }
    await page.close();
  }
});
