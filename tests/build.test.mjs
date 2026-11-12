// The page builder: runs cleanly twice, escapes odd text, and keeps the sitemap honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync, readdirSync, symlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'site-'));
  for (const f of ['index.html', 'data', 'scripts', 'assets']) cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}
const build = (dir) => execFileSync('node', ['scripts/build-schools.mjs'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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
  const slug0 = sec.sections[0].slug;
  assert.equal(second.split(`<a href="sections/${slug0}.html" aria-label="See photos`).length - 1, 1, 'exactly one See photos link');
  assert.equal(second.split(`<a href="sections/${slug0}.html" data-sec`).length - 1, 1, 'card picture wrapped in a link exactly once');
  assert.equal(second.split(`href="sections/${sec.sections[0].slug}.html"`).length - 1, 2, 'picture + text link');
  // removing the photos keeps the page, and the link goes back to "See what we stock"
  sec.sections[0].photos = [];
  writeFileSync(path.join(dir, 'data/sections.json'), JSON.stringify(sec));
  build(dir);
  const third = readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(third.includes(`aria-label="See what we stock: `) && !third.includes(`See photos: ${sec.sections[0].title.replace(/&/g, '&amp;')}`));
  assert.ok(readFileSync(path.join(dir, 'sections', `${sec.sections[0].slug}.html`), 'utf8').includes('Photos coming soon'));
});

test('section photos are grouped under their Drive subfolder headings, in order', () => {
  const dir = sandbox();
  const sec = JSON.parse(readFileSync(path.join(dir, 'data/sections.json'), 'utf8'));
  const s = sec.sections.find((x) => x.slug === 'gifts-toys');
  s.photos = [
    { file: 'a.webp', caption: 'Wooden frame', group: 'Photo Frames & Wall Decor' },
    { file: 'b.webp', caption: 'Teddy bear', group: 'Toys & Soft Toys' },
    { file: 'c.webp', caption: 'Gold frame', group: 'Photo Frames & Wall Decor' },
    { file: 'd.webp', caption: 'Gift hamper' },
  ];
  writeFileSync(path.join(dir, 'data/sections.json'), JSON.stringify(sec));
  build(dir);
  const html = readFileSync(path.join(dir, 'sections/gifts-toys.html'), 'utf8');
  const heads = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['Photo Frames &amp; Wall Decor', 'Toys &amp; Soft Toys']);
  const order = ['Wooden frame', 'Gold frame', 'Teddy bear', 'Gift hamper'].map((c) => html.indexOf(`>${c}<`));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'photos stay with their group');
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
  for (const marker of ['section-cards', 'schools-strip', 'banner', 'analytics']) {
    const dir = sandbox();
    const p = path.join(dir, 'index.html');
    writeFileSync(p, readFileSync(p, 'utf8').replace(`<!--${marker}-->`, ''));
    assert.throws(() => build(dir), new RegExp(marker), marker);
  }
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

test('setting a GoatCounter code switches the counter on for every page in one build', () => {
  const dir = sandbox();
  const d = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8'));
  d.goatcounter = 'agrawaltest';
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  build(dir);
  for (const pg of ['index.html', `schools/${d.schools[0].slug}.html`, 'sections/gifts-toys.html']) {
    const html = readFileSync(path.join(dir, pg), 'utf8');
    assert.ok(html.includes('https://agrawaltest.goatcounter.com/count'), pg);
    assert.equal(html.split('gc.zgo.at/count.js').length - 1, 1, `${pg}: loaded once`);
  }
  build(dir);
  assert.equal(readFileSync(path.join(dir, 'index.html'), 'utf8').split('gc.zgo.at/count.js').length - 1, 1, 'still once after a rebuild');
});

test('a hidden product disappears from its page but keeps its photo file; showing it again brings it back', () => {
  const dir = sandbox();
  const d = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8'));
  const s = d.schools.find((x) => x.uniformPhotos.length > 1);
  const p = s.uniformPhotos[0];
  p.hidden = true;
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  build(dir);
  let html = readFileSync(path.join(dir, 'schools', `${s.slug}.html`), 'utf8');
  assert.ok(!html.includes(`/${p.file}"`), 'hidden photo not on the page');
  assert.ok(existsSync(path.join(dir, 'assets/uniforms', s.slug, p.file)), 'file kept');
  delete p.hidden;
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  build(dir);
  html = readFileSync(path.join(dir, 'schools', `${s.slug}.html`), 'utf8');
  assert.ok(html.includes(`/${p.file}"`), 'shown again');
});

test('the home page banner comes from data/site.json: text is escaped, and it can be switched off', () => {
  const dir = sandbox();
  const f = path.join(dir, 'data/site.json');
  writeFileSync(f, JSON.stringify({ banner: { show: true, text: 'Diwali gifts & <lights> are here', button: 'Call now' } }));
  build(dir);
  let home = readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(home.includes('Diwali gifts &amp; &lt;lights&gt; are here') && home.includes('Call now'));
  assert.equal(home.split('aria-label="This season"').length - 1, 1);
  writeFileSync(f, JSON.stringify({ banner: { show: false, text: 'x' } }));
  build(dir);
  home = readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(!home.includes('aria-label="This season"'), 'banner off');
});

test('photos sent from the admin page become website photos; a broken one is kept aside with its error', (t) => {
  try { execFileSync('python3', ['-c', 'import cv2, numpy, PIL'], { stdio: 'ignore' }); } catch { return t.skip('python libs missing'); }
  const dir = sandbox();
  mkdirSync(path.join(dir, 'incoming'));
  execFileSync('python3', ['-c', `from PIL import Image; Image.new('RGB',(1200,1600),(120,60,40)).save('${path.join(dir, 'incoming', 'ok1.jpg')}')`]);
  writeFileSync(path.join(dir, 'data/incoming.json'), JSON.stringify({ photos: [
    { id: 'ok1', page: 'school:st-norbert', caption: 'Grey sweater', mode: 'whole', by: 'Test' },
    { id: 'gone', page: 'section:gifts-toys', caption: 'Teddy bear', mode: 'loose', by: 'Test' },
  ] }));
  let code = 0;
  try { execFileSync('python3', ['scripts/process-incoming.py'], { cwd: dir, stdio: 'ignore' }); } catch (e) { code = e.status; }
  assert.equal(code, 1, 'reports the broken one');
  const s = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8')).schools.find((x) => x.slug === 'st-norbert');
  const added = s.uniformPhotos.at(-1);
  assert.equal(added.caption, 'Grey sweater');
  assert.equal(added.group, 'Winter wear', 'sweater goes under Winter wear');
  assert.notEqual(added.file, 'grey-sweater.webp', 'did not overwrite the existing grey-sweater photo');
  assert.ok(existsSync(path.join(dir, 'assets/uniforms/st-norbert', added.file)));
  assert.ok(!existsSync(path.join(dir, 'incoming', 'ok1.jpg')), 'raw photo removed');
  const left = JSON.parse(readFileSync(path.join(dir, 'data/incoming.json'), 'utf8')).photos;
  assert.deepEqual(left.map((x) => x.id), ['gone']);
  assert.match(left[0].error, /missing/);
});

test('a new school and a new section appear everywhere; hiding them removes them everywhere', () => {
  const dir = sandbox();
  const d = JSON.parse(readFileSync(path.join(dir, 'data/schools.json'), 'utf8'));
  const sec = JSON.parse(readFileSync(path.join(dir, 'data/sections.json'), 'utf8'));
  mkdirSync(path.join(dir, 'assets/logos'), { recursive: true });
  cpSync(path.join(root, 'assets/medicaps.webp'), path.join(dir, 'assets/logos/delhi-public-school.jpg'));
  d.schools.push({ slug: 'delhi-public-school', name: 'DPS', fullName: 'Delhi Public School', logo: 'logos/delhi-public-school.jpg', logoW: 300, logoH: 300, uniformPhotos: [], books: {} });
  sec.sections.push({ slug: 'mens', title: "Men's Section", intro: 'Shirts and belts for men.', cardText: 'Shirts and belts for men.', items: ['Formal shirts', 'Belts'], photos: [] });
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  writeFileSync(path.join(dir, 'data/sections.json'), JSON.stringify(sec));
  build(dir);
  const read = (f) => readFileSync(path.join(dir, f), 'utf8');
  let home = read('index.html'), map = read('sitemap.xml');
  assert.ok(home.includes('href="schools/delhi-public-school.html"') && home.includes('assets/logos/delhi-public-school.jpg'), 'school logo on home');
  assert.ok(home.includes('Men&#39;s Section') || home.includes("Men's Section"), 'section card on home');
  assert.ok(home.includes('assets/categories/generic.svg'), 'new section card has a picture');
  assert.ok(existsSync(path.join(dir, 'schools/delhi-public-school.html')) && existsSync(path.join(dir, 'sections/mens.html')));
  assert.ok(map.includes('/schools/delhi-public-school.html') && map.includes('/sections/mens.html'));
  assert.ok(read(`schools/${d.schools[0].slug}.html`).includes('href="delhi-public-school.html"'), 'listed under other schools');
  assert.ok(read('sections/gifts-toys.html').includes('href="mens.html"'), 'listed under more from the store');
  // hide both
  d.schools.at(-1).hidden = true; sec.sections.at(-1).hidden = true;
  writeFileSync(path.join(dir, 'data/schools.json'), JSON.stringify(d));
  writeFileSync(path.join(dir, 'data/sections.json'), JSON.stringify(sec));
  build(dir);
  home = read('index.html'); map = read('sitemap.xml');
  assert.ok(!home.includes('delhi-public-school') && !home.includes('sections/mens.html'), 'gone from home');
  assert.ok(!existsSync(path.join(dir, 'schools/delhi-public-school.html')) && !existsSync(path.join(dir, 'sections/mens.html')), 'pages removed');
  assert.ok(!map.includes('delhi-public-school') && !map.includes('/sections/mens.html'), 'gone from sitemap');
  assert.ok(!read(`schools/${d.schools[0].slug}.html`).includes('delhi-public-school.html'), 'gone from other schools');
});
