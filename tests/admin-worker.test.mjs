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
  for (const [name, role, pin] of [['Darshit', 'owner', 'owner-pass-123'], ['Sandeep', 'staff', '482913'], ['Payal', 'staff', '771200']]) {
    users.push({ name, role, salt: `s-${name}`, hash: await hashPin(`s-${name}`, pin) });
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
async function loginAs(env, name, pin) { return (await call(env, 'POST', '/login', { name, pin })).body.token; }
const mainJson = (f) => JSON.parse(gitState.branches.get('main').get(f));
const pendingJson = (f) => JSON.parse(gitState.branches.get('admin-pending').get(f));
const fakeJpeg = '/9j/' + 'A'.repeat(4000);

test('names list shows who can log in, without any secrets', async () => {
  resetGit();
  const env = await makeEnv();
  const r = await call(env, 'GET', '/names');
  assert.deepEqual(r.body.names.map((n) => n.name), ['Darshit', 'Sandeep', 'Payal']);
  assert.ok(!JSON.stringify(r.body).includes('hash') && !JSON.stringify(r.body).includes('salt'));
});

test('login: right PIN works, wrong PIN fails, 5 wrong PINs lock that name for a while', async () => {
  resetGit();
  const env = await makeEnv();
  const ok = await call(env, 'POST', '/login', { name: 'Sandeep', pin: '482913' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.role, 'staff');
  for (let i = 0; i < 5; i++) assert.equal((await call(env, 'POST', '/login', { name: 'Payal', pin: '000000' })).status, 401);
  const locked = await call(env, 'POST', '/login', { name: 'Payal', pin: '771200' });
  assert.equal(locked.status, 429, 'locked even with the right PIN');
  assert.equal((await call(env, 'POST', '/login', { name: 'Nobody', pin: '1' })).status, 401);
});

test('without a valid login nothing can be read or changed; tampered or removed-user sessions are refused', async () => {
  resetGit();
  const env = await makeEnv();
  assert.equal((await call(env, 'GET', '/state')).status, 401);
  const tok = await loginAs(env, 'Sandeep', '482913');
  const [b, s] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ n: 'Sandeep', r: 'owner', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal((await call(env, 'POST', '/publish', {}, `${forged}.${s}`)).status, 401, 'cannot promote yourself to owner');
  assert.equal((await call(env, 'GET', '/state', null, tok)).status, 200);
  const env2 = { ...env, USERS: JSON.stringify(JSON.parse(env.USERS).filter((u) => u.name !== 'Sandeep')) };
  assert.equal((await call(env2, 'GET', '/state', null, tok)).status, 401, 'removed user is logged out');
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
  const staff = await loginAs(env, 'Payal', '771200');
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
