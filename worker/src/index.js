// Agrawal Stores admin service (Cloudflare Worker).
//
// The admin page (agrawalstores.in/admin) talks only to this service. It:
//   - logs people in with their name + PIN (owner gets a longer password),
//   - saves every change to a "pending" copy of the site (git branch admin-pending) and keeps one pull request open,
//   - lets only the owner publish (merge) or throw away the pending changes.
// Nothing reaches the live site until the owner presses Publish.
//
// Settings (wrangler.toml [vars] / secrets):
//   REPO            "daarrsshh/agrawal-stores-website"
//   ALLOWED_ORIGIN  "https://agrawalstores.in"  (comma-separated list allowed)
//   GITHUB_TOKEN    secret: fine-grained token, this repo only, Contents + Pull requests: read and write, Actions: read
//   SESSION_SECRET  secret: long random string
//   USERS           secret: JSON list [{ "name": "Darshit", "role": "owner", "salt": "...", "hash": "..." }]
//                   (make entries with: node worker/make-user.mjs "Name" staff 123456)
//   ATTEMPTS        optional KV namespace binding, used to lock out repeated wrong PINs
//   GITHUB_API      optional, defaults to https://api.github.com (tests point it at a fake)

const BRANCH = 'admin-pending';
const PR_TITLE = 'Website changes from the admin page';
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // the admin page shrinks photos to about 0.3 MB before sending
const MAX_FAILS = 5;            // wrong PINs allowed ...
const LOCK_SECONDS = 15 * 60;   // ... before that name is locked for 15 minutes
const SESSION_DAYS = 30;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export async function hashPin(salt, pin) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`)));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)))));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- GitHub ----------
function gh(env) {
  const api = (env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
  const repo = env.REPO;
  async function call(method, p, body) {
    const res = await fetch(`${api}/repos/${repo}${p}`, {
      method,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'agrawal-stores-admin',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return { status: res.status, json };
  }
  const ok = (r, what) => {
    if (r.status >= 300) throw new HttpError(502, `GitHub ${what} failed (${r.status}): ${r.json && r.json.message}`);
    return r.json;
  };
  return {
    async branchSha(name) {
      const r = await call('GET', `/git/ref/heads/${name}`);
      return r.status === 200 ? r.json.object.sha : null;
    },
    async ensureBranch() {
      if (await this.branchSha(BRANCH)) return;
      const main = await this.branchSha('main');
      ok(await call('POST', '/git/refs', { ref: `refs/heads/${BRANCH}`, sha: main }), 'create branch');
    },
    async deleteBranch() { await call('DELETE', `/git/refs/heads/${BRANCH}`); },
    async readFile(p, ref) {
      const r = await call('GET', `/contents/${p}?ref=${ref}`);
      if (r.status === 404) return null;
      const j = ok(r, `read ${p}`);
      const bin = atob(j.content.replace(/\n/g, ''));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return { sha: j.sha, text: new TextDecoder().decode(bytes) };
    },
    async writeFile(p, contentB64, message, sha) {
      const r = await call('PUT', `/contents/${p}`, { message, content: contentB64, branch: BRANCH, ...(sha ? { sha } : {}) });
      if (r.status === 409 || r.status === 422) throw new HttpError(409, 'Someone else saved at the same moment. Please try again.');
      return ok(r, `save ${p}`);
    },
    async openPr() {
      const owner = env.REPO.split('/')[0];
      const r = await call('GET', `/pulls?state=open&head=${owner}:${BRANCH}`);
      const list = ok(r, 'list pull requests');
      return list[0] || null;
    },
    async ensurePr(body) {
      const pr = await this.openPr();
      if (pr) return pr;
      return ok(await call('POST', '/pulls', { title: PR_TITLE, head: BRANCH, base: 'main', body }), 'open pull request');
    },
    async compare() {
      const r = await call('GET', `/compare/main...${BRANCH}`);
      return r.status === 200 ? r.json : null;
    },
    async latestRun() {
      const r = await call('GET', `/actions/runs?branch=${BRANCH}&per_page=1`);
      return r.status === 200 && r.json.workflow_runs && r.json.workflow_runs[0] ? r.json.workflow_runs[0] : null;
    },
    async merge(number) {
      const r = await call('PUT', `/pulls/${number}/merge`, { merge_method: 'merge' });
      if (r.status === 405 || r.status === 409) throw new HttpError(409, 'The changes cannot be published yet (checks still running or a conflict). Try again in a few minutes.');
      return ok(r, 'publish');
    },
    async closePr(number) { ok(await call('PATCH', `/pulls/${number}`, { state: 'closed' }), 'close pull request'); },
  };
}

const utf8b64 = (text) => {
  const bytes = enc.encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// ---------- data helpers ----------
const DATA = { schools: 'data/schools.json', sections: 'data/sections.json', site: 'data/site.json', incoming: 'data/incoming.json' };

async function loadAll(g) {
  const ref = (await g.branchSha(BRANCH)) ? BRANCH : 'main';
  const out = { ref };
  for (const [k, p] of Object.entries(DATA)) {
    const f = await g.readFile(p, ref);
    out[k] = f ? { sha: f.sha, json: JSON.parse(f.text) } : { sha: null, json: k === 'incoming' ? { photos: [] } : {} };
  }
  return out;
}

export function findPage(all, page) {
  const [kind, slug] = String(page || '').split(':');
  if (kind === 'school') {
    const s = all.schools.json.schools.find((x) => x.slug === slug);
    if (s) return { kind, slug, title: s.fullName, list: s.uniformPhotos, file: 'schools' };
  }
  if (kind === 'section') {
    const s = all.sections.json.sections.find((x) => x.slug === slug);
    if (s) return { kind, slug, title: s.title, list: s.photos, file: 'sections' };
  }
  throw new HttpError(400, 'Unknown page');
}

export function cleanText(v, max = 60) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 2) throw new HttpError(400, 'Please type a name (at least 2 letters).');
  if (s.length > max) throw new HttpError(400, `Please keep it under ${max} letters.`);
  if (/(?:₹|\brs\.?\s?\d|\bmrp\b|\bprice\b|\b\d+\s?\/-)/i.test(s)) throw new HttpError(400, 'Please do not put prices on the website.');
  return s;
}

// Apply one edit. Returns { file, message } describing what changed.
export function applyEdit(all, op, user) {
  if (op.op === 'banner') {
    if (user.r !== 'owner') throw new HttpError(403, 'Only the owner can change the banner.');
    const text = op.show ? cleanText(op.text, 90) : String(op.text || '').slice(0, 90);
    const button = op.button ? cleanText(op.button, 30) : 'Call us';
    all.site.json.banner = { show: Boolean(op.show), text, button };
    return { file: 'site', message: `Banner: ${op.show ? text : 'hidden'}` };
  }
  const pg = findPage(all, op.page);
  const i = pg.list.findIndex((p) => p.file === op.file);
  if (i < 0) throw new HttpError(404, 'That product was not found. Refresh the page.');
  const p = pg.list[i];
  if (op.op === 'rename') {
    const caption = cleanText(op.caption);
    if (pg.list.some((x, j) => j !== i && x.caption.toLowerCase() === caption.toLowerCase())) throw new HttpError(400, 'Another product on this page already has that name.');
    const old = p.caption;
    p.caption = caption;
    return { file: pg.file, message: `${pg.title}: renamed "${old}" to "${caption}"` };
  }
  if (op.op === 'hide' || op.op === 'show') {
    if (op.op === 'hide') p.hidden = true; else delete p.hidden;
    return { file: pg.file, message: `${pg.title}: ${op.op === 'hide' ? 'hid' : 'showed'} "${p.caption}"` };
  }
  if (op.op === 'move') {
    const j = i + (op.dir < 0 ? -1 : 1);
    if (j < 0 || j >= pg.list.length) throw new HttpError(400, 'Already at the end.');
    [pg.list[i], pg.list[j]] = [pg.list[j], pg.list[i]];
    return { file: pg.file, message: `${pg.title}: moved "${p.caption}" ${op.dir < 0 ? 'up' : 'down'}` };
  }
  if (op.op === 'group') {
    const allowed = pg.kind === 'school' ? ['Daily wear', 'House & sports wear', 'Winter wear'] : null;
    const group = cleanText(op.group, 40);
    if (allowed && !allowed.includes(group)) throw new HttpError(400, 'Unknown group');
    p.group = group;
    return { file: pg.file, message: `${pg.title}: "${p.caption}" moved to ${group}` };
  }
  throw new HttpError(400, 'Unknown change');
}

// ---------- sessions ----------
async function makeSession(env, user) {
  const body = b64url(JSON.stringify({ n: user.name, r: user.role, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}

async function readSession(env, req) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [body, sig] = tok.split('.');
  if (!body || !sig || !safeEqual(sig, await hmac(env.SESSION_SECRET, body))) throw new HttpError(401, 'Please log in again.');
  const s = JSON.parse(unb64url(body));
  if (s.exp < Date.now()) throw new HttpError(401, 'Please log in again.');
  // a removed user loses access at once
  if (!users(env).some((u) => u.name === s.n && u.role === s.r)) throw new HttpError(401, 'Please log in again.');
  return s;
}

function users(env) {
  try { return JSON.parse(env.USERS || '[]'); } catch { return []; }
}

async function login(env, body) {
  const name = String(body.name || '');
  const user = users(env).find((u) => u.name === name);
  const key = `fail:${name}`;
  if (env.ATTEMPTS) {
    const n = Number(await env.ATTEMPTS.get(key)) || 0;
    if (n >= MAX_FAILS) throw new HttpError(429, 'Too many wrong PINs. Please wait 15 minutes.');
  }
  const good = user && safeEqual(await hashPin(user.salt, String(body.pin || '')), user.hash);
  if (!good) {
    if (env.ATTEMPTS) {
      const n = (Number(await env.ATTEMPTS.get(key)) || 0) + 1;
      await env.ATTEMPTS.put(key, String(n), { expirationTtl: LOCK_SECONDS });
    }
    throw new HttpError(401, 'Wrong PIN. Please try again.');
  }
  if (env.ATTEMPTS) await env.ATTEMPTS.delete(key);
  return { token: await makeSession(env, user), name: user.name, role: user.role };
}

// ---------- main ----------
async function route(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, '');
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  if (path === '/names' && req.method === 'GET') return { names: users(env).map((u) => ({ name: u.name, role: u.role })) };
  if (path === '/login' && req.method === 'POST') return login(env, body);

  const me = await readSession(env, req);
  const g = gh(env);

  if (path === '/state' && req.method === 'GET') {
    const all = await loadAll(g);
    const pr = all.ref === BRANCH ? await g.openPr() : null;
    const cmp = all.ref === BRANCH ? await g.compare() : null;
    const run = all.ref === BRANCH ? await g.latestRun() : null;
    const incoming = all.incoming.json.photos || [];
    return {
      me: { name: me.n, role: me.r },
      schools: all.schools.json.schools,
      sections: all.sections.json.sections,
      site: all.site.json,
      pending: {
        exists: all.ref === BRANCH && Boolean(cmp && cmp.ahead_by),
        pr: pr ? pr.number : null,
        changes: cmp ? (cmp.commits || []).map((c) => c.commit.message.split('\n')[0]).filter((m) => !/^(Merge|Queue photo|Prepare website changes)/.test(m)) : [],
        incoming: incoming.map((p) => ({ page: p.page, caption: p.caption, by: p.by })),
        processing: incoming.length > 0 || Boolean(run && run.status !== 'completed'),
        failed: Boolean(run && run.status === 'completed' && run.conclusion && run.conclusion !== 'success'),
      },
      imageBase: all.ref === BRANCH ? `https://raw.githubusercontent.com/${env.REPO}/${BRANCH}/` : 'https://agrawalstores.in/',
    };
  }

  if (path === '/edit' && req.method === 'POST') {
    await g.ensureBranch();
    const all = await loadAll(g);
    const { file, message } = applyEdit(all, body, me);
    const msg = `${message} (by ${me.n})`;
    await g.writeFile(DATA[file], utf8b64(JSON.stringify(all[file].json, null, 2) + '\n'), msg, all[file].sha);
    await g.ensurePr('Changes made on agrawalstores.in/admin. The owner publishes them from the admin page.');
    return { ok: true, message };
  }

  if (path === '/photo' && req.method === 'POST') {
    const all = await loadAll(g);
    const pg = findPage(all, body.page);
    const caption = cleanText(body.caption);
    const mode = ['bag', 'loose', 'whole'].includes(body.mode) ? body.mode : 'loose';
    const img = String(body.image || '').replace(/^data:image\/jpeg;base64,/, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(img) || img.length < 1000) throw new HttpError(400, 'The photo did not upload. Please try again.');
    if (img.length * 0.75 > MAX_PHOTO_BYTES) throw new HttpError(400, 'The photo is too big.');
    if (!img.startsWith('/9j/')) throw new HttpError(400, 'Please send a photo (JPEG).');
    let group = body.group ? cleanText(body.group, 40) : undefined;
    if (pg.kind === 'school' && group && !['Daily wear', 'House & sports wear', 'Winter wear'].includes(group)) group = undefined;
    await g.ensureBranch();
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await g.writeFile(`incoming/${id}.jpg`, img, `New photo for ${pg.title}: ${caption} (by ${me.n})`);
    const fresh = await loadAll(g);
    const list = fresh.incoming.json.photos || [];
    list.push({ id, page: `${pg.kind}:${pg.slug}`, caption, group, mode, by: me.n, at: new Date().toISOString() });
    await g.writeFile(DATA.incoming, utf8b64(JSON.stringify({ photos: list }, null, 2) + '\n'), `Queue photo ${id} for processing`, fresh.incoming.sha);
    await g.ensurePr('Changes made on agrawalstores.in/admin. The owner publishes them from the admin page.');
    return { ok: true, message: `Photo sent. It will be ready to check in a few minutes.` };
  }

  if (path === '/publish' && req.method === 'POST') {
    if (me.r !== 'owner') throw new HttpError(403, 'Only the owner can publish.');
    const all = await loadAll(g);
    if ((all.incoming.json.photos || []).length) throw new HttpError(409, 'New photos are still being prepared. Please wait a few minutes.');
    const run = await g.latestRun();
    if (run && run.status !== 'completed') throw new HttpError(409, 'Photos are still being prepared. Please wait a few minutes.');
    if (run && run.conclusion && run.conclusion !== 'success') throw new HttpError(409, 'The last photo update had a problem. Ask Claude to look at it.');
    const pr = await g.openPr();
    if (!pr) throw new HttpError(400, 'Nothing to publish.');
    await g.merge(pr.number);
    await g.deleteBranch();
    return { ok: true, message: 'Published. The website updates in about 2 minutes.' };
  }

  if (path === '/discard' && req.method === 'POST') {
    if (me.r !== 'owner') throw new HttpError(403, 'Only the owner can throw away changes.');
    const pr = await g.openPr();
    if (pr) await g.closePr(pr.number);
    await g.deleteBranch();
    return { ok: true, message: 'Pending changes thrown away.' };
  }

  throw new HttpError(404, 'Not found');
}

function cors(env, req) {
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') || '';
  return {
    'access-control-allow-origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export default {
  async fetch(req, env) {
    const headers = { 'content-type': 'application/json; charset=utf-8', ...cors(env, req) };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      return new Response(JSON.stringify(await route(req, env)), { status: 200, headers });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof HttpError ? e.message : 'Something went wrong. Please try again.';
      if (!(e instanceof HttpError)) console.error(e);
      return new Response(JSON.stringify({ error: message }), { status, headers });
    }
  },
};
