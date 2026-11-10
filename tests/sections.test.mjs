import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sections } = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8'));
const home = readFileSync(path.join(root, 'index.html'), 'utf8');
const sitemap = readFileSync(path.join(root, 'sitemap.xml'), 'utf8');

for (const s of sections.filter((x) => !x.hidden)) {
  test(`section "${s.slug}": has its page, a home link and a sitemap entry, with or without photos`, () => {
    const file = path.join(root, 'sections', `${s.slug}.html`);
    const url = `https://agrawalstores.in/sections/${s.slug}.html`;
    assert.ok(existsSync(file), 'page exists');
    const html = readFileSync(file, 'utf8');
    assert.ok(home.includes(`href="sections/${s.slug}.html"`), 'home page links to the section');
    assert.ok(sitemap.includes(url), 'sitemap lists the section');
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    assert.ok(html.includes('href="tel:+919926504567"'), 'has a call button');
    assert.ok(!/(?:₹|\brs\.?\s?\d|\bMRP\b)/i.test(html), 'no prices');
    assert.ok(s.items && s.items.length >= 2, 'lists what we stock');
    for (const i of s.items) assert.ok(html.includes(i.replace(/&/g, '&amp;')), `item "${i}" shown`);
    if (s.photos.length) {
      assert.ok(home.includes(`See photos: ${s.title.replace(/&/g, '&amp;')}`));
      for (const p of s.photos) assert.ok(existsSync(path.join(root, 'assets/gallery', s.slug, p.file)), `${p.file} exists`);
    } else {
      assert.ok(html.includes('Photos coming soon'));
      assert.ok(home.includes(`See what we stock: ${s.title.replace(/&/g, '&amp;')}`));
    }
  });
}
