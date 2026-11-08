import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sections } = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8'));
const home = readFileSync(path.join(root, 'index.html'), 'utf8');
const sitemap = readFileSync(path.join(root, 'sitemap.xml'), 'utf8');

for (const s of sections) {
  test(`section "${s.slug}": page, home link and sitemap match whether it has photos`, () => {
    const file = path.join(root, 'sections', `${s.slug}.html`);
    const link = `href="sections/${s.slug}.html"`;
    const url = `https://agrawalstores.in/sections/${s.slug}.html`;
    if (!s.photos.length) {
      assert.ok(!existsSync(file), 'a section with no photos must not have a page');
      assert.ok(!home.includes(link), 'no home link without photos');
      assert.ok(!sitemap.includes(url), 'no sitemap entry without photos');
      return;
    }
    const html = readFileSync(file, 'utf8');
    assert.ok(home.includes(link), 'home page links to the section');
    assert.ok(sitemap.includes(url), 'sitemap lists the section');
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    assert.ok(html.includes('href="tel:+919926504567"'), 'has a call button');
    assert.ok(!/(?:₹|\brs\.?\s?\d|\bMRP\b)/i.test(html), 'no prices');
    for (const p of s.photos) {
      assert.ok(existsSync(path.join(root, 'assets/gallery', s.slug, p.file)), `${p.file} exists`);
      assert.ok(p.caption && p.caption.length > 2, 'caption present');
    }
  });
}
