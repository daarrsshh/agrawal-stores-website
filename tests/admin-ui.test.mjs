// Admin page (admin/index.html) in a real browser, talking to the real admin service and a fake GitHub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import worker, { hashPin } from '../worker/src/index.js';
import { startFakeGitHub, REPO } from './helpers/fake-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fake = startFakeGitHub(root);
let browser, site, svc, siteUrl, svcUrl, env;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json' };

before(async () => {
  await fake.start();
  // the website (serves admin/ and assets/)
  site = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (u === '/admin/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(`window.ADMIN_API = ${JSON.stringify(svcUrl)};`); }
    const f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
    if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  siteUrl = `http://127.0.0.1:${site.address().port}`;
  // the admin service, run through a tiny Node adapter
  const users = [];
  for (const [name, role, pin] of [['Darshit', 'owner', 'owner-pass-123'], ['Sandeep', 'staff', '482913']]) users.push({ name, role, salt: `s${name}`, hash: await hashPin(`s${name}`, pin) });
  env = { REPO, ALLOWED_ORIGIN: siteUrl, GITHUB_TOKEN: 't', SESSION_SECRET: 'ui-test-secret-123456', USERS: JSON.stringify(users), GITHUB_API: fake.url };
  svc = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const r = await worker.fetch(new Request(`http://svc${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'OPTIONS'].includes(req.method) ? undefined : body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
  });
  await new Promise((r) => svc.listen(0, '127.0.0.1', r));
  svcUrl = `http://127.0.0.1:${svc.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser.close(); site.close(); svc.close(); fake.stop(); });

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // product pictures come from raw.githubusercontent.com / the live site: answer them with a local photo
  const pic = readFileSync(path.join(root, 'assets/uniforms/st-norbert/thumb/grey-blazer.webp'));
  await page.route(/^https:\/\//, (r) => r.fulfill({ contentType: 'image/webp', body: pic }));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${siteUrl}/admin/`);
  return { ctx, page };
}
async function loginStaff(page) {
  await page.getByRole('button', { name: 'Sandeep' }).click();
  for (const d of '482913') await page.locator(`#pinpad [data-k="${d}"]`).click();
  await page.getByText('Namaste,').waitFor();
}
const pending = (f) => JSON.parse(fake.branches.get('admin-pending').get(f));

test('staff: log in with name + PIN pad, wrong PIN shows a clear message, owner tools are hidden', async () => {
  fake.reset();
  const { ctx, page } = await phone();
  await page.getByRole('button', { name: 'Sandeep' }).click();
  for (const d of '111111') await page.locator(`#pinpad [data-k="${d}"]`).click();
  await page.getByText('Wrong PIN').waitFor();
  for (const d of '482913') await page.locator(`#pinpad [data-k="${d}"]`).click();
  await page.getByText('Namaste,').waitFor();
  assert.ok(await page.locator('#s-home [data-go="add-page"]').isVisible());
  assert.ok(!(await page.locator('[data-go="publish"]').isVisible()), 'staff cannot see publish');
  assert.ok(!(await page.locator('[data-go="banner"]').isVisible()));
  // stays logged in after reload
  await page.reload();
  await page.getByText('Namaste,').waitFor();
  await ctx.close();
});

test('staff: add a product with a photo; it is queued for the owner and the live site is untouched', async () => {
  fake.reset();
  const { ctx, page } = await phone();
  await loginStaff(page);
  await page.locator('#s-home [data-go="add-page"]').click();
  await page.getByRole('button', { name: 'Gifts & Toys' }).click();
  // forgetting the photo is caught
  await page.locator('#add-name').fill('Teddy bear, large');
  await page.locator('#add-send').click();
  await page.getByText('Please take a photo first').waitFor();
  // a real photo, as a phone camera would give it
  await page.locator('#add-photo').setInputFiles(path.join(root, 'assets/shop-front.webp'));
  await page.locator('#add-preview:not(.hidden)').waitFor();
  await page.getByText('Toys & Soft Toys').click();
  await page.locator('#add-send').click();
  await page.getByText('Photo sent').waitFor();
  const q = pending('data/incoming.json').photos;
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].page, q[0].caption, q[0].group, q[0].mode, q[0].by], ['section:gifts-toys', 'Teddy bear, large', 'Toys & Soft Toys', 'loose', 'Sandeep']);
  assert.ok(fake.branches.get('admin-pending').get(`incoming/${q[0].id}.jpg`).startsWith('BINARY:'));
  assert.ok(!fake.branches.get('main').has('data/incoming.json'), 'live site untouched');
  await ctx.close();
});

test('staff: rename, hide and move a product; a price in the name is refused', async () => {
  fake.reset();
  const { ctx, page } = await phone();
  await loginStaff(page);
  await page.locator('#s-home [data-go="edit-page"]').click();
  await page.getByRole('button', { name: 'St. Norbert School' }).click();
  const first = page.locator('#edit-list [data-i="0"]');
  const firstFile = JSON.parse(fake.branches.get('main').get('data/schools.json')).schools.find((s) => s.slug === 'st-norbert').uniformPhotos[0].file;
  await first.click();
  await page.locator('#ed-name').fill('Grey blazer Rs 900');
  await page.locator('#ed-save-name').click();
  await page.getByText('Please do not put prices').waitFor();
  await page.locator('#edit-list [data-i="0"]').click();
  await page.locator('#ed-name').fill('Light grey half-sleeve shirt (all sizes)');
  await page.locator('#ed-save-name').click();
  await page.getByText('Saved.').waitFor();
  await page.locator('#edit-list [data-i="0"]').click();
  await page.locator('#ed-hide').click();
  await page.getByText('Hidden · छुपा हुआ').waitFor();
  await page.locator('#edit-list [data-i="0"]').click();
  await page.locator('#ed-down').click();
  await page.getByText('moved').waitFor();
  const list = pending('data/schools.json').schools.find((s) => s.slug === 'st-norbert').uniformPhotos;
  const moved = list.findIndex((p) => p.file === firstFile);
  assert.equal(moved, 1);
  assert.equal(list[1].caption, 'Light grey half-sleeve shirt (all sizes)');
  assert.equal(list[1].hidden, true);
  await ctx.close();
});

test('owner: sees changes, cannot publish while photos are being prepared, then publishes; banner can be changed', async () => {
  fake.reset();
  const { ctx, page } = await phone();
  await loginStaff(page);
  await page.locator('#s-home [data-go="add-page"]').click();
  await page.getByRole('button', { name: 'St. Joseph School' }).click();
  await page.locator('#add-photo').setInputFiles(path.join(root, 'assets/shop-front.webp'));
  await page.locator('#add-preview:not(.hidden)').waitFor();
  await page.locator('#add-name').fill('Navy tie');
  await page.locator('#add-send').click();
  await page.getByText('Photo sent').waitFor();
  await page.locator('#logout-btn').click();

  await page.getByRole('button', { name: 'Darshit' }).click();
  await page.locator('#owner-pass').fill('owner-pass-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByText('Namaste,').waitFor();
  assert.equal((await page.locator('#pending-count').textContent()).trim().length > 0, true);

  await page.locator('[data-go="banner"]').click();
  await page.locator('#banner-text').fill('Diwali gifts are here');
  await page.locator('#banner-button').fill('Call now');
  await page.getByRole('button', { name: 'Save banner' }).click();
  await page.getByText('Banner saved').waitFor();

  await page.locator('[data-go="publish"]').click();
  await page.getByText('Preparing 1 new photo').waitFor();
  assert.ok(await page.locator('#do-publish').isDisabled(), 'publish waits for photos');
  // GitHub Action finishes preparing the photo
  fake.branches.get('admin-pending').set('data/incoming.json', JSON.stringify({ photos: [] }));
  fake.run = { status: 'completed', conclusion: 'success' };
  await page.locator('#do-refresh').click();
  await page.getByText('Changes waiting').waitFor();
  assert.ok(await page.getByText('Banner: Diwali gifts are here (by Darshit)').isVisible());
  await page.locator('#do-publish').click();
  await page.getByText('Published.').waitFor();
  assert.ok(!fake.branches.has('admin-pending'));
  assert.equal(JSON.parse(fake.branches.get('main').get('data/site.json')).banner.text, 'Diwali gifts are here');
    await ctx.close();
});

test('admin page is hidden from Google and not part of the public site', () => {
  const html = readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(readFileSync(path.join(root, 'robots.txt'), 'utf8'), /Disallow: \/admin\//);
  assert.ok(!readFileSync(path.join(root, 'sitemap.xml'), 'utf8').includes('/admin'));
  assert.ok(!readFileSync(path.join(root, 'index.html'), 'utf8').includes('admin/'), 'no public link to the admin page');
});
