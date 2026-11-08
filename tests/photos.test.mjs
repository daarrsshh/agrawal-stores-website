// Uniform and section photos: files, sizes, captions, and that nothing is left over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8'));
const { sections } = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8'));
const groups = [
  ...data.schools.map((s) => ({ name: s.slug, dir: `assets/uniforms/${s.slug}`, photos: s.uniformPhotos })),
  ...sections.map((s) => ({ name: s.slug, dir: `assets/gallery/${s.slug}`, photos: s.photos })),
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
    const extra = readdirSync(dir).filter((f) => !used.has(f));
    assert.deepEqual(extra, [], `${g.dir} has unused files`);
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
    const alts = [...html.matchAll(/<img src="\.\.\/assets\/uniforms\/[^"]+" alt="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(alts.length, s.uniformPhotos.length, `${s.slug}: photo count on page`);
    for (const a of alts) assert.ok(a.includes(s.fullName.replace(/&/g, '&amp;')), `${s.slug}: alt "${a}"`);
  }
});

test('data/processed-photos.json is valid and has no duplicates', () => {
  const p = JSON.parse(readFileSync(path.join(root, 'data/processed-photos.json'), 'utf8'));
  assert.ok(Array.isArray(p.processedDriveFileIds));
  assert.equal(new Set(p.processedDriveFileIds).size, p.processedDriveFileIds.length);
});
