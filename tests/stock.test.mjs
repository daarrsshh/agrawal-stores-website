// Stock status under products: what parents see for each combination staff can set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overall, stockLine } from '../scripts/stock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (html) => html.replace(/<[^>]+>/g, '').trim();

test('no stock set: nothing is shown (old products look exactly as before)', () => {
  assert.equal(stockLine({ caption: 'x' }), '');
  assert.equal(stockLine({ caption: 'x', stock: 'banana' }), '');
});

test('item-level status', () => {
  assert.equal(text(stockLine({ stock: 'in' })), 'Available');
  assert.equal(text(stockLine({ stock: 'few' })), 'Few left');
  assert.equal(text(stockLine({ stock: 'out' })), 'Out of stock right now · call to order');
});

test('sizes: shows sizes that have stock, marks few, hides sold-out sizes', () => {
  const p = { stock: 'in', sizes: [{ size: '22', stock: 'in' }, { size: '24', stock: 'few' }, { size: '26', stock: 'out' }, { size: '28', stock: 'in' }] };
  assert.equal(text(stockLine(p)), 'Available · Sizes 22, 24 (few), 28');
});

test('sizes decide the overall status: all sizes out means out; only few left means few', () => {
  assert.equal(overall({ stock: 'in', sizes: [{ size: 'S', stock: 'out' }, { size: 'M', stock: 'out' }] }), 'out');
  assert.equal(text(stockLine({ stock: 'in', sizes: [{ size: 'S', stock: 'out' }] })), 'Out of stock right now · call to order');
  assert.equal(overall({ stock: 'in', sizes: [{ size: 'S', stock: 'few' }, { size: 'M', stock: 'out' }] }), 'few');
  assert.equal(overall({ sizes: [{ size: 'S', stock: 'in' }] }), 'in', 'sizes alone are enough');
});

test('size names are escaped', () => {
  assert.ok(stockLine({ stock: 'in', sizes: [{ size: '<b>', stock: 'in' }] }).includes('&lt;b&gt;'));
});

test('built pages show the stock line under the product, and the pop-up copies it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stock-'));
  for (const f of ['index.html', 'data', 'scripts', 'assets']) cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const d = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8'));
  const s = d.schools.find((x) => x.uniformPhotos.length > 2);
  Object.assign(s.uniformPhotos[0], { stock: 'in', sizes: [{ size: '24', stock: 'in' }, { size: '26', stock: 'few' }] });
  s.uniformPhotos[1].stock = 'out';
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  execFileSync('node', ['scripts/build-schools.mjs'], { cwd: dir, stdio: 'ignore' });
  const html = readFileSync(path.join(dir, 'schools', `${s.slug}.html`), 'utf8');
  const fig = (cap) => { const i = html.indexOf(`>${cap.replace(/&/g, '&amp;')}</figcaption>`); return html.slice(i, html.indexOf('</figure>', i)); };
  assert.match(text(fig(s.uniformPhotos[0].caption)), /Available · Sizes 24, 26 \(few\)/);
  assert.match(text(fig(s.uniformPhotos[1].caption)), /Out of stock right now · call to order/);
  assert.ok(!fig(s.uniformPhotos[2].caption).includes('data-stock'), 'unset stays blank');
  // pop-up shows it too
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(/^https?:/, (r) => r.abort());
  await page.goto('file://' + path.join(dir, 'schools', `${s.slug}.html`));
  const idx = await page.evaluate((cap) => [...document.querySelectorAll('figcaption')].findIndex((f) => f.textContent === cap), s.uniformPhotos[0].caption);
  await page.locator('figure [data-zoom]').nth(idx).click();
  assert.match(await page.locator('#zoom-stock').textContent(), /Available · Sizes 24, 26 \(few\)/);
  await page.keyboard.press('Escape');
  const idx2 = await page.evaluate((cap) => [...document.querySelectorAll('figcaption')].findIndex((f) => f.textContent === cap), s.uniformPhotos[2].caption);
  await page.locator('figure [data-zoom]').nth(idx2).click();
  assert.equal((await page.locator('#zoom-stock').textContent()).trim(), '', 'no leftover status from the previous product');
  await b.close();
});
