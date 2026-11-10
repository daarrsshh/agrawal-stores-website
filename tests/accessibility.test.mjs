// Automated accessibility check (axe-core, the engine behind Lighthouse's accessibility score).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
for (const s of data.schools) s.uniformPhotos = s.uniformPhotos.filter((p) => !p.hidden);
data.schools = data.schools.filter((s) => !s.hidden);
const pages = ['index.html', ...data.schools.map((s) => `schools/${s.slug}.html`)];

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

for (const pg of pages) {
  for (const width of [412, 1280]) {
    test(`${pg} at ${width}px has no accessibility problems`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route(/^https?:/, (r) => r.abort());
      await page.goto('file://' + path.join(root, pg), { waitUntil: 'load' });
      await page.addScriptTag({ content: axeSource });
      const problems = await page.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] } });
        return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
      });
      await page.close();
      assert.deepEqual(problems, []);
    });
  }
}

test('links with the same visible text but different targets have distinct labels', async () => {
  for (const pg of pages) {
    const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto('file://' + path.join(root, pg));
    const clashes = await page.evaluate(() => {
      const byName = {};
      for (const a of document.querySelectorAll('a[href]')) {
        const name = (a.getAttribute('aria-label') || a.innerText).trim().toLowerCase();
        (byName[name] ||= new Set()).add(a.getAttribute('href'));
      }
      return Object.entries(byName).filter(([, hrefs]) => hrefs.size > 1).map(([n, h]) => `${n} -> ${h.size} targets`);
    });
    await page.close();
    assert.deepEqual(clashes, [], pg);
  }
});
