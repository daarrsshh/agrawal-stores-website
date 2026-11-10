// Uniform and section photos: files, sizes, captions, and that nothing is left over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
const rawSections = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8')).sections;
// Page checks use what is shown (hidden products are skipped); file checks use everything.
const data = JSON.parse(JSON.stringify(raw));
for (const s of data.schools) s.uniformPhotos = s.uniformPhotos.filter((p) => !p.hidden);
data.schools = data.schools.filter((s) => !s.hidden);
const sections = JSON.parse(JSON.stringify(rawSections));
for (const s of sections) s.photos = s.photos.filter((p) => !p.hidden);
sections.splice(0, sections.length, ...sections.filter((s) => !s.hidden));
const groups = [
  ...raw.schools.map((s) => ({ name: s.slug, dir: `assets/uniforms/${s.slug}`, photos: s.uniformPhotos })),
  ...rawSections.map((s) => ({ name: s.slug, dir: `assets/gallery/${s.slug}`, photos: s.photos })),
];
const PRICE = /(?:₹|\brs\.?\s?\d|\bmrp\b|\bprice\b|\b\d+\s?\/-)/i;

for (const g of groups) {
  if (!g.photos.length) continue;
  test(`${g.name}: every photo is a 1000x1250 WebP under 250 KB`, async () => {
    for (const p of g.photos) {
      const f = path.join(root, g.dir, p.file);
      assert.ok(existsSync(f), `${p.file} is missing`);
      assert.match(p.file, /^[a-z0-9-]+\.webp$/, `${p.file}: lower-case, dashes, .webp`);
      const m = await sharp(f).metadata();
      assert.equal(m.format, 'webp', p.file);
      assert.deepEqual([m.width, m.height], [1000, 1250], `${p.file} size`);
      assert.ok(statSync(f).size < 250 * 1024, `${p.file} is ${Math.round(statSync(f).size / 1024)} KB`);
    }
  });
  test(`${g.name}: captions are present, unique, plain and price-free`, () => {
    const seen = new Set();
    for (const p of g.photos) {
      const c = (p.caption || '').trim();
      assert.ok(c.length >= 3 && c.length <= 60, `caption length for ${p.file}: "${c}"`);
      assert.ok(!PRICE.test(c), `price in caption: "${c}"`);
      assert.ok(!/\d{8,}/.test(c), `caption looks like a camera file name: "${c}"`);
      assert.ok(!seen.has(c.toLowerCase()), `duplicate caption "${c}"`);
      seen.add(c.toLowerCase());
    }
    const files = g.photos.map((p) => p.file);
    assert.equal(new Set(files).size, files.length, 'same photo listed twice');
  });
}

test('no photo file sits unused in assets (would be published but never shown)', () => {
  for (const g of groups) {
    const dir = path.join(root, g.dir);
    if (!existsSync(dir)) continue;
    const used = new Set(g.photos.map((p) => p.file));
    const extra = readdirSync(dir).filter((f) => f !== 'thumb' && !used.has(f));
    assert.deepEqual(extra, [], `${g.dir} has unused files`);
    const thumbs = existsSync(path.join(dir, 'thumb')) ? readdirSync(path.join(dir, 'thumb')) : [];
    assert.deepEqual(thumbs.filter((f) => !used.has(f)), [], `${g.dir}/thumb has thumbnails of removed photos`);
    for (const f of used) assert.ok(thumbs.includes(f), `${g.dir}: thumbnail for ${f}`);
  }
  for (const base of ['assets/uniforms', 'assets/gallery']) {
    if (!existsSync(path.join(root, base))) continue;
    const known = new Set(groups.map((g) => g.dir));
    for (const d of readdirSync(path.join(root, base))) {
      const rel = `${base}/${d}`;
      if (known.has(rel)) continue;
      assert.deepEqual(readdirSync(path.join(root, rel)), [], `${rel} is not a known school or section but has files`);
    }
  }
});

test('school logos exist and their width/height match the real image', async () => {
  for (const s of data.schools) {
    const f = path.join(root, 'assets', s.logo);
    assert.ok(existsSync(f), `${s.logo} missing`);
    const m = await sharp(f).metadata();
    const ratio = (s.logoW || 160) / (s.logoH || 160);
    assert.ok(Math.abs(ratio - m.width / m.height) < 0.05, `${s.slug}: logoW/logoH ratio does not match ${m.width}x${m.height}`);
  }
});

test('school slugs and names are unique', () => {
  const slugs = data.schools.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9-]+$/);
  const names = data.schools.map((s) => s.fullName.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test('photo alt text names the school or section', () => {
  for (const s of data.schools) {
    if (!s.uniformPhotos.length) continue;
    const html = readFileSync(path.join(root, 'schools', `${s.slug}.html`), 'utf8');
    const alts = [...html.matchAll(/<img src="\.\.\/assets\/uniforms\/[^"]+"[^>]*? alt="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(alts.length, s.uniformPhotos.length, `${s.slug}: photo count on page`);
    for (const a of alts) assert.ok(a.includes(s.fullName.replace(/&/g, '&amp;')), `${s.slug}: alt "${a}"`);
  }
});

test('data/processed-photos.json is valid and has no duplicates', () => {
  const p = JSON.parse(readFileSync(path.join(root, 'data/processed-photos.json'), 'utf8'));
  assert.ok(Array.isArray(p.processedDriveFileIds));
  assert.equal(new Set(p.processedDriveFileIds).size, p.processedDriveFileIds.length);
});

test('uniform photos sit under Daily, House & sports, Winter headings in that order', () => {
  const ORDER = ['Daily wear', 'House &amp; sports wear', 'Winter wear'];
  for (const s of data.schools) {
    const groups = new Set(s.uniformPhotos.map((p) => p.group || 'Daily wear'));
    const html = readFileSync(path.join(root, 'schools', `${s.slug}.html`), 'utf8');
    const end = html.indexOf('id="guide"') > 0 ? html.indexOf('<section id="guide"') : html.indexOf('<section id="books"');
    const sec = html.slice(html.indexOf('id="uniforms"'), end);
    const heads = [...sec.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);
    if (groups.size < 2) { assert.deepEqual(heads, [], `${s.slug}: no headings for a single group`); continue; }
    assert.deepEqual(heads, ORDER.filter((o) => groups.has(o.replace('&amp;', '&'))), `${s.slug} headings`);
    for (const p of s.uniformPhotos) {
      assert.ok(['Daily wear', 'House & sports wear', 'Winter wear'].includes(p.group), `${s.slug}/${p.file}: unknown group "${p.group}"`);
      if (/sweater|blazer/i.test(p.caption)) assert.equal(p.group, 'Winter wear', `${p.caption} should be Winter wear`);
    }
  }
});

test('uniform guide: shown only for schools that have one, every block has items', () => {
  for (const s of data.schools) {
    const html = readFileSync(path.join(root, 'schools', `${s.slug}.html`), 'utf8');
    if (!s.guide || !s.guide.length) { assert.ok(!html.includes('id="guide"'), `${s.slug}: no guide section`); continue; }
    assert.ok(html.includes('id="guide"'), `${s.slug}: guide section`);
    for (const g of s.guide) { assert.ok(g.title && g.items.length, `${s.slug}: ${g.title}`); assert.ok(html.includes(`>${g.title.replace(/&/g, '&amp;')}</h3>`)); }
  }
});

test('every school page has a Hindi line marked lang="hi"', () => {
  for (const s of data.schools) {
    const html = readFileSync(path.join(root, 'schools', `${s.slug}.html`), 'utf8');
    assert.match(html, /<p lang="hi"[^>]*>[^<]*यूनिफॉर्म और किताबें/);
  }
});

test('every product photo has its own Call button and a WhatsApp Book button naming the item', () => {
  const pages = [
    ...data.schools.filter((s) => s.uniformPhotos.length).map((s) => ({ file: `schools/${s.slug}.html`, name: s.fullName, photos: s.uniformPhotos })),
    ...sections.filter((s) => s.photos.length).map((s) => ({ file: `sections/${s.slug}.html`, name: s.title, photos: s.photos })),
  ];
  for (const pg of pages) {
    const html = readFileSync(path.join(root, pg.file), 'utf8');
    const figs = html.split('<figure').slice(1).map((f) => f.slice(0, f.indexOf('</figure>')));
    assert.equal(figs.length, pg.photos.length, `${pg.file}: one card per photo`);
    figs.forEach((f) => {
      const cap = f.match(/<figcaption[^>]*>([^<]*)<\/figcaption>/)[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      assert.ok(pg.photos.some((p) => p.caption === cap), `${pg.file}: unknown caption ${cap}`);
      assert.ok(f.includes('href="tel:+919926504567"'), `${pg.file}: call on "${cap}"`);
      const m = f.match(/href="(https:\/\/wa\.me\/919926504567\?text=[^"]+)"/);
      assert.ok(m, `${pg.file}: book on "${cap}"`);
      const text = decodeURIComponent(m[1].replace(/&amp;/g, '&').split('text=')[1]);
      assert.ok(text.includes(cap) && text.includes(pg.name), `${pg.file}: message names the item: ${text}`);
      assert.ok(f.indexOf('tel:') < f.indexOf('wa.me'), 'Call comes before Book');
    });
  }
});

test('photo grids load small thumbnails; the full photo is kept for the pop-up', async () => {
  for (const s of data.schools.filter((x) => x.uniformPhotos.length)) {
    const html = readFileSync(path.join(root, 'schools', `${s.slug}.html`), 'utf8');
    const imgs = [...html.matchAll(/<img src="(\.\.\/assets\/uniforms\/[^"]+)" srcset="([^"]+)"[^>]*data-full="([^"]+)"/g)];
    assert.equal(imgs.length, s.uniformPhotos.length, s.slug);
    for (const [, src, srcset, full] of imgs) {
      assert.match(src, /\/thumb\//);
      assert.match(srcset, /\/thumb\/\S+ 640w, \S+ 1000w$/);
      assert.doesNotMatch(full, /\/thumb\//);
      const m = await sharp(path.join(root, 'schools', src)).metadata();
      assert.equal(m.width, 640);
      assert.ok(statSync(path.join(root, 'schools', src)).size < 70 * 1024, `${src} is small`);
    }
  }
});

test('visit counter is off until a GoatCounter code is set, and then on every page', () => {
  const pages = ['index.html', ...data.schools.map((s) => `schools/${s.slug}.html`), ...sections.map((s) => `sections/${s.slug}.html`)];
  for (const pg of pages) {
    const html = readFileSync(path.join(root, pg), 'utf8');
    assert.ok(html.includes('<!--analytics-->'), `${pg}: marker`);
    assert.equal(html.includes('gc.zgo.at/count.js'), Boolean(data.goatcounter), `${pg}: counter ${data.goatcounter ? 'on' : 'off'}`);
    if (data.goatcounter) assert.ok(html.includes(`https://${data.goatcounter}.goatcounter.com/count`));
  }
});
