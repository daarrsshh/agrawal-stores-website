// Small copies of product photos for the photo grids (the full 1000px photo loads only in the pop-up).
// Writes assets/uniforms/<school>/thumb/<file> and assets/gallery/<section>/thumb/<file>; skips ones already up to date.
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THUMB_W = 640;

export async function makeThumbs() {
  const schools = JSON.parse(readFileSync(path.join(root, 'data/schools.json'), 'utf8')).schools;
  const { sections } = JSON.parse(readFileSync(path.join(root, 'data/sections.json'), 'utf8'));
  const jobs = [
    ...schools.flatMap((s) => s.uniformPhotos.map((p) => path.join(root, 'assets/uniforms', s.slug, p.file))),
    ...sections.flatMap((s) => s.photos.map((p) => path.join(root, 'assets/gallery', s.slug, p.file))),
  ];
  let made = 0;
  for (const src of jobs) {
    if (!existsSync(src)) continue;
    const out = path.join(path.dirname(src), 'thumb', path.basename(src));
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
    mkdirSync(path.dirname(out), { recursive: true });
    await sharp(src).resize({ width: THUMB_W }).webp({ quality: 72 }).toFile(out);
    made++;
  }
  return made;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(`Made ${await makeThumbs()} thumbnails.`);
