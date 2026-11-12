// Admin service (worker/src/index.js) against a fake GitHub that keeps branches and files in memory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { hashPin } from '../worker/src/index.js';
import { startFakeGitHub } from './helpers/fake-github.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'daarrsshh/agrawal-stores-website';

// ---------- fake GitHub ----------
let gitState;
const fake = startFakeGitHub(root);
function resetGit() { fake.reset(); gitState = fake; }
let api;
before(async () => { await fake.start(); api = fake.url; });
after(() => fake.stop());

// ---------- worker env ----------
class FakeKV { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k) ?? null; } async put(k, v) { this.m.set(k, v); } async delete(k) { this.m.delete(k); } }
async function makeEnv() {
  const users = [];
  for (const [name, role, pin] of [['Owner', 'owner', 'owner-pass-123'], ['Staff', 'staff', '482913']]) {
    users.push({ name, role, salt: `salt-${name}-0123`, hash: await hashPin(`salt-${name}-0123`, pin) });
  }
  return { REPO, ALLOWED_ORIGIN: 'https://agrawalstores.in', GITHUB_TOKEN: 't', SESSION_SECRET: 'test-secret-0123456789', USERS: JSON.stringify(users), GITHUB_API: api, ATTEMPTS: new FakeKV() };
}
async function call(env, method, p, body, token) {
  const res = await worker.fetch(new Request(`https://admin.example${p}`, {
    method, headers: { origin: 'https://agrawalstores.in', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}
async function loginAs(env, name, pin) {
  const role = pin.length > 6 ? 'owner' : 'staff';
  return (await call(env, 'POST', '/login', { role, pin, who: role === 'staff' ? name : undefined })).body.token;
}
const mainJson = (f) => JSON.parse(gitState.branches.get('main').get(f));
const pendingJson = (f) => JSON.parse(gitState.branches.get('admin-pending').get(f));
const fakeJpeg = '/9j/' + 'A'.repeat(4000);

test('there is no list of names or logins to read', async () => {
  resetGit();
  const env = await makeEnv();
  assert.equal((await call(env, 'GET', '/names')).status, 401);
});

test('login: staff use the shared PIN plus their name; the owner uses the password; each is checked only for its own role', async () => {
  resetGit();
  const env = await makeEnv();
  let r = await call(env, 'POST', '/login', { role: 'staff', pin: '482913', who: ' Sandeep ' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.role, r.body.name], ['staff', 'Sandeep']);
  assert.equal((await call(env, 'POST', '/login', { role: 'staff', pin: '482913' })).status, 400, 'name needed');
  assert.equal((await call(env, 'POST', '/login', { role: 'staff', pin: 'owner-pass-123', who: 'Sandeep' })).status, 401, 'owner password does not open the staff login');
  assert.equal((await call(env, 'POST', '/login', { role: 'owner', pin: '482913' })).status, 401, 'staff PIN does not open the owner login');
  r = await call(env, 'POST', '/login', { role: 'owner', pin: 'owner-pass-123' });
  assert.deepEqual([r.status, r.body.role, r.body.name], [200, 'owner', 'Owner']);
  r = await call(env, 'POST', '/login', { role: 'staff', pin: '482913', who: '<b>Ka</b>nak' });
  assert.equal(r.body.name, 'bKabnak', 'no tags in names');
});

test('wrong tries lock that login for a while: owner after 5, shared staff PIN after 10', async () => {
  resetGit();
  const env = await makeEnv();
  for (let i = 0; i < 5; i++) assert.equal((await call(env, 'POST', '/login', { role: 'owner', pin: 'wrong-password' })).status, 401);
  assert.equal((await call(env, 'POST', '/login', { role: 'owner', pin: 'owner-pass-123' })).status, 429);
  for (let i = 0; i < 9; i++) await call(env, 'POST', '/login', { role: 'staff', pin: '000000', who: 'X y' });
  assert.equal((await call(env, 'POST', '/login', { role: 'staff', pin: '482913', who: 'Sandeep' })).status, 200, 'still open after 9');
  for (let i = 0; i < 10; i++) await call(env, 'POST', '/login', { role: 'staff', pin: '000000', who: 'X y' });
  assert.equal((await call(env, 'POST', '/login', { role: 'staff', pin: '482913', who: 'Sandeep' })).status, 429, 'locked after 10');
});

test('without a valid login nothing can be read or changed; tampered or removed-user sessions are refused', async () => {
  resetGit();
  const env = await makeEnv();
  assert.equal((await call(env, 'GET', '/state')).status, 401);
  const tok = await loginAs(env, 'Sandeep', '482913');
  const [b, s] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ n: 'Sandeep', u: 'Staff', r: 'owner', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal((await call(env, 'POST', '/publish', {}, `${forged}.${s}`)).status, 401, 'cannot promote yourself to owner');
  assert.equal((await call(env, 'GET', '/state', null, tok)).status, 200);
  const env2 = { ...env, USERS: JSON.stringify(JSON.parse(env.USERS).map((u) => (u.role === 'staff' ? { ...u, salt: 'new-salt-9999', hash: 'x' } : u))) };
  assert.equal((await call(env2, 'GET', '/state', null, tok)).status, 401, 'changing the staff PIN logs staff phones out');
  assert.ok(b);
});

test('staff edits go to the pending copy only; the live site is untouched until the owner publishes', async () => {
  resetGit();
  const env = await makeEnv();
  const staff = await loginAs(env, 'Sandeep', '482913');
  const before = mainJson('data/schools.json');
  const s = before.schools.find((x) => x.uniformPhotos.length > 2);
  const [a, b] = s.uniformPhotos;
  let r = await call(env, 'POST', '/edit', { op: 'rename', page: `school:${s.slug}`, file: a.file, caption: 'Grey blazer, all sizes' }, staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(env, 'POST', '/edit', { op: 'hide', page: `school:${s.slug}`, file: b.file }, staff);
  r = await call(env, 'POST', '/edit', { op: 'move', page: `school:${s.slug}`, file: b.file, dir: -1 }, staff);
  assert.equal(r.status, 200);
  const pend = pendingJson('data/schools.json').schools.find((x) => x.slug === s.slug).uniformPhotos;
  assert.equal(pend[0].file, b.file, 'moved up');
  assert.equal(pend[0].hidden, true);
  assert.equal(pend[1].caption, 'Grey blazer, all sizes');
  assert.deepEqual(mainJson('data/schools.json'), before, 'live data unchanged');
  assert.equal(gitState.prs.filter((p) => p.state === 'open').length, 1, 'one pull request for all changes');
  const st = (await call(env, 'GET', '/state', null, staff)).body;
  assert.ok(st.pending.exists);
  assert.equal(st.pending.changes.length, 3);
  assert.ok(st.pending.changes.every((c) => c.endsWith('(by Sandeep)')));
  assert.ok(st.imageBase.includes('raw.githubusercontent.com'));
});

test('bad input is refused: prices, empty names, duplicates, unknown pages, script tags', async () => {
  resetGit();
  const env = await makeEnv();
  const staff = await loginAs(env, 'Sandeep', '482913');
  const s = mainJson('data/schools.json').schools.find((x) => x.uniformPhotos.length > 2);
  const page = `school:${s.slug}`;
  const f = s.uniformPhotos[0].file;
  for (const caption of ['Blazer Rs. 900', 'Blazer ₹900', 'Blazer price 900', 'x', '']) {
    const r = await call(env, 'POST', '/edit', { op: 'rename', page, file: f, caption }, staff);
    assert.equal(r.status, 400, caption);
  }
  assert.equal((await call(env, 'POST', '/edit', { op: 'rename', page, file: f, caption: s.uniformPhotos[1].caption }, staff)).status, 400, 'duplicate');
  assert.equal((await call(env, 'POST', '/edit', { op: 'rename', page: 'school:nope', file: f, caption: 'ok name' }, staff)).status, 400);
  assert.equal((await call(env, 'POST', '/edit', { op: 'rename', page, file: 'nope.webp', caption: 'ok name' }, staff)).status, 404);
  const r = await call(env, 'POST', '/edit', { op: 'rename', page, file: f, caption: 'Tie <script>alert(1)</script>' }, staff);
  assert.equal(r.status, 200);
  const cap = pendingJson('data/schools.json').schools.find((x) => x.slug === s.slug).uniformPhotos[0].caption;
  assert.ok(!cap.includes('<') && !cap.includes('>'), cap);
});

test('only the owner can publish, throw away changes, or change the banner', async () => {
  resetGit();
  const env = await makeEnv();
  const staff = await loginAs(env, 'Sandeep', '482913');
  const owner = await loginAs(env, 'Darshit', 'owner-pass-123');
  assert.equal((await call(env, 'POST', '/publish', {}, staff)).status, 403);
  assert.equal((await call(env, 'POST', '/discard', {}, staff)).status, 403);
  assert.equal((await call(env, 'POST', '/edit', { op: 'banner', show: true, text: 'Diwali gifts are here' }, staff)).status, 403);
  const r = await call(env, 'POST', '/edit', { op: 'banner', show: true, text: 'Diwali gifts are here', button: 'Call now' }, owner);
  assert.equal(r.status, 200);
  assert.deepEqual(pendingJson('data/site.json').banner, { show: true, text: 'Diwali gifts are here', button: 'Call now' });
});

test('photo upload: queued for processing, publish waits until photos are ready, then goes live', async () => {
  resetGit();
  const env = await makeEnv();
  const staff = await loginAs(env, 'Payal', '482913');
  const owner = await loginAs(env, 'Darshit', 'owner-pass-123');
  assert.equal((await call(env, 'POST', '/photo', { page: 'section:gifts-toys', caption: 'Teddy', image: 'not-a-photo' }, staff)).status, 400);
  const r = await call(env, 'POST', '/photo', { page: 'section:gifts-toys', caption: 'Teddy bear, large', group: 'Toys & Soft Toys', mode: 'loose', image: fakeJpeg }, staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const q = pendingJson('data/incoming.json').photos;
  assert.equal(q.length, 1);
  assert.equal(q[0].page, 'section:gifts-toys');
  assert.equal(q[0].by, 'Payal');
  assert.ok(gitState.branches.get('admin-pending').has(`incoming/${q[0].id}.jpg`));
  const st = (await call(env, 'GET', '/state', null, owner)).body;
  assert.ok(st.pending.processing);
  assert.deepEqual(st.pending.changes, ['New photo for Gifts & Toys: Teddy bear, large (by Payal)'], 'internal steps are not listed');
  assert.equal((await call(env, 'POST', '/publish', {}, owner)).status, 409, 'waits for processing');
  // the GitHub Action processes it: empties the queue, run completes successfully
  gitState.branches.get('admin-pending').set('data/incoming.json', JSON.stringify({ photos: [] }));
  gitState.run = { status: 'in_progress' };
  assert.equal((await call(env, 'POST', '/publish', {}, owner)).status, 409, 'waits while the run is going');
  gitState.run = { status: 'completed', conclusion: 'failure' };
  assert.equal((await call(env, 'POST', '/publish', {}, owner)).status, 409, 'refuses after a failed run');
  gitState.run = { status: 'completed', conclusion: 'success' };
  const pub = await call(env, 'POST', '/publish', {}, owner);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.ok(!gitState.branches.has('admin-pending'), 'pending copy cleared');
  assert.equal(gitState.prs.find((p) => p.number === 100).merged, true);
});

test('discard throws pending changes away and leaves the live site as it was', async () => {
  resetGit();
  const env = await makeEnv();
  const owner = await loginAs(env, 'Darshit', 'owner-pass-123');
  const before = mainJson('data/site.json');
  await call(env, 'POST', '/edit', { op: 'banner', show: false, text: '' }, owner);
  assert.equal((await call(env, 'POST', '/discard', {}, owner)).status, 200);
  assert.ok(!gitState.branches.has('admin-pending'));
  assert.deepEqual(mainJson('data/site.json'), before);
  assert.equal(gitState.prs.filter((p) => p.state === 'open').length, 0);
});

test('only the shop website may call the service (CORS)', async () => {
  resetGit();
  const env = await makeEnv();
  const r = await worker.fetch(new Request('https://admin.example/names', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://agrawalstores.in');
  const pre = await worker.fetch(new Request('https://admin.example/edit', { method: 'OPTIONS', headers: { origin: 'https://agrawalstores.in' } }), env);
  assert.equal(pre.status, 204);
});

test('owner can add a new school with its logo and a new section; staff cannot', async () => {
  resetGit();
  const env = await makeEnv();
  const staff = await loginAs(env, 'Sandeep', '482913');
  const owner = await loginAs(env, 'Darshit', 'owner-pass-123');
  const logo = '/9j/' + 'B'.repeat(3000);
  assert.equal((await call(env, 'POST', '/edit', { op: 'addSchool', fullName: 'Delhi Public School', name: 'DPS', logo }, staff)).status, 403);
  assert.equal((await call(env, 'POST', '/edit', { op: 'addSection', title: "Men's Section", intro: 'x y', items: 'a' }, staff)).status, 403);
  let r = await call(env, 'POST', '/edit', { op: 'addSchool', fullName: 'Delhi Public School', name: 'DPS', logo, logoW: 300, logoH: 280 }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const school = pendingJson('data/schools.json').schools.at(-1);
  assert.deepEqual([school.slug, school.name, school.fullName, school.logo, school.logoW, school.logoH], ['delhi-public-school', 'DPS', 'Delhi Public School', 'logos/delhi-public-school.jpg', 300, 280]);
  assert.deepEqual(school.uniformPhotos, []);
  assert.ok(gitState.branches.get('admin-pending').get('assets/logos/delhi-public-school.jpg').startsWith('BINARY:'));
  r = await call(env, 'POST', '/edit', { op: 'addSection', title: "Men's Section", intro: 'Shirts, trousers and accessories for men.', items: "Formal shirts\nTrousers\n\nBelts and wallets" }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sec = pendingJson('data/sections.json').sections.at(-1);
  assert.deepEqual([sec.slug, sec.title, sec.items], ['men-s-section', "Men's Section", ['Formal shirts', 'Trousers', 'Belts and wallets']]);
  assert.match(sec.waText, /Men's Section/);
  const st = (await call(env, 'GET', '/state', null, owner)).body;
  assert.deepEqual(st.pending.changes, ['New school: Delhi Public School (by Owner)', "New section: Men's Section (by Owner)"], 'logo commit not listed separately');
  // staff can now add photos to the new section
  r = await call(env, 'POST', '/photo', { page: 'section:men-s-section', caption: 'White formal shirt', mode: 'bag', image: fakeJpeg }, staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('adding schools and sections: duplicates, missing logo, empty lists and prices are refused', async () => {
  resetGit();
  const env = await makeEnv();
  const owner = await loginAs(env, 'Darshit', 'owner-pass-123');
  const existing = mainJson('data/schools.json').schools[0];
  const logo = '/9j/' + 'B'.repeat(3000);
  const bad = [
    { op: 'addSchool', fullName: existing.fullName, logo },
    { op: 'addSchool', fullName: 'New School' },
    { op: 'addSchool', fullName: 'New School', logo: 'not-an-image' },
    { op: 'addSchool', fullName: 'हिंदी', logo },
    { op: 'addSection', title: 'Gifts & Toys', intro: 'More gifts', items: 'Toys' },
    { op: 'addSection', title: 'Mens', intro: 'Shirts for men', items: '' },
    { op: 'addSection', title: 'Mens', intro: '', items: 'Shirts' },
    { op: 'addSection', title: 'Mens', intro: 'Shirts from Rs. 300', items: 'Shirts' },
  ];
  for (const b of bad) assert.equal((await call(env, 'POST', '/edit', b, owner)).status, 400, JSON.stringify(b).slice(0, 80));
});

test('owner can rename a school, edit a section, and hide or show a whole page', async () => {
  resetGit();
  const env = await makeEnv();
  const owner = await loginAs(env, 'Darshit', 'owner-pass-123');
  const staff = await loginAs(env, 'Sandeep', '482913');
  const sec = mainJson('data/sections.json').sections[2];
  let r = await call(env, 'POST', '/edit', { op: 'editSection', slug: sec.slug, title: 'Sports & Games', intro: 'Bats, balls and board games.', items: ['Cricket bats', 'Board games'] }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s2 = pendingJson('data/sections.json').sections[2];
  assert.deepEqual([s2.slug, s2.title, s2.cardText, s2.items], [sec.slug, 'Sports & Games', 'Bats, balls and board games.', ['Cricket bats', 'Board games']], 'address of the page stays the same');
  const sch = mainJson('data/schools.json').schools[1];
  r = await call(env, 'POST', '/edit', { op: 'editSchool', slug: sch.slug, fullName: "St. Joseph's Convent School", name: "St. Joseph's" }, owner);
  assert.equal(r.status, 200);
  assert.equal(pendingJson('data/schools.json').schools[1].fullName, "St. Joseph's Convent School");
  assert.equal((await call(env, 'POST', '/edit', { op: 'hidePage', page: `school:${sch.slug}` }, staff)).status, 403);
  r = await call(env, 'POST', '/edit', { op: 'hidePage', page: `section:${sec.slug}` }, owner);
  assert.equal(pendingJson('data/sections.json').sections[2].hidden, true);
  r = await call(env, 'POST', '/edit', { op: 'showPage', page: `section:${sec.slug}` }, owner);
  assert.equal(pendingJson('data/sections.json').sections[2].hidden, undefined);
});

test('stock: staff can mark a product and its sizes; bad values are refused; new photos start as in stock', async () => {
  resetGit();
  const env = await makeEnv();
  const staff = await loginAs(env, 'Sandeep', '482913');
  const s = mainJson('data/schools.json').schools.find((x) => x.uniformPhotos.length > 1);
  const page = `school:${s.slug}`, file = s.uniformPhotos[0].file;
  let r = await call(env, 'POST', '/edit', { op: 'stock', page, file, stock: 'in', sizes: [{ size: '22', stock: 'in' }, { size: '24', stock: 'few' }, { size: '26', stock: 'out' }] }, staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let p = pendingJson('data/schools.json').schools.find((x) => x.slug === s.slug).uniformPhotos[0];
  assert.equal(p.stock, 'in');
  assert.deepEqual(p.sizes, [{ size: '22', stock: 'in' }, { size: '24', stock: 'few' }, { size: '26', stock: 'out' }]);
  assert.match(r.body.message, /in stock \(sizes: 22 ✓, 24 few, 26 ✗\)/);
  // status only, sizes kept
  r = await call(env, 'POST', '/edit', { op: 'stock', page, file, stock: 'out' }, staff);
  p = pendingJson('data/schools.json').schools.find((x) => x.slug === s.slug).uniformPhotos[0];
  assert.equal(p.stock, 'out'); assert.equal(p.sizes.length, 3);
  // empty list clears sizes
  r = await call(env, 'POST', '/edit', { op: 'stock', page, file, stock: 'few', sizes: [] }, staff);
  p = pendingJson('data/schools.json').schools.find((x) => x.slug === s.slug).uniformPhotos[0];
  assert.equal(p.sizes, undefined);
  for (const bad of [{ stock: 'maybe' }, { stock: 'in', sizes: [{ size: '', stock: 'in' }] }, { stock: 'in', sizes: [{ size: '22', stock: 'in' }, { size: '22', stock: 'out' }] }, { stock: 'in', sizes: [{ size: 'M', stock: 'lots' }] }, { stock: 'in', sizes: Array.from({ length: 31 }, (_, i) => ({ size: String(i), stock: 'in' })) }]) {
    assert.equal((await call(env, 'POST', '/edit', { op: 'stock', page, file, ...bad }, staff)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  r = await call(env, 'POST', '/edit', { op: 'stock', page, file, stock: 'in', sizes: [{ size: '<b>XL</b>', stock: 'in' }] }, staff);
  assert.equal(pendingJson('data/schools.json').schools.find((x) => x.slug === s.slug).uniformPhotos[0].sizes[0].size, 'bXL/b', 'no tags in sizes');
  await call(env, 'POST', '/photo', { page, caption: 'Navy tie', mode: 'bag', image: fakeJpeg }, staff);
  assert.equal(pendingJson('data/incoming.json').photos[0].stock, 'in');
});
