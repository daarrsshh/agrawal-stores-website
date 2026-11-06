// Shrinks uniform photos for the web.
// Put phone photos (JPG/PNG) in assets/uniforms/<school-slug>/, then run: npm run images
// Each photo gets a small .webp copy next to it (max 1000px, about 60-120 KB); the school pages use the .webp.
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'assets/uniforms');
if (!existsSync(dir)) { console.log('No assets/uniforms folder yet.'); process.exit(0); }

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
let made = 0;
for (const file of walk(dir).filter((f) => /\.(jpe?g|png)$/i.test(f))) {
  const out = file.replace(/\.(jpe?g|png)$/i, '.webp');
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) continue;
  await sharp(file).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(out);
  console.log('made', path.relative(root, out), Math.round(statSync(out).size / 1024) + ' KB');
  made++;
}
console.log(made ? `Optimised ${made} photo(s).` : 'All photos already optimised.');
