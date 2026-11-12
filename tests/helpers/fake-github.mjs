// Fake GitHub REST API used by the admin tests: branches, files, pull requests and workflow runs, all in memory.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO = 'daarrsshh/agrawal-stores-website';

export function startFakeGitHub(root) {
  const g = {};
  g.reset = () => {
    const main = new Map();
    for (const f of ['data/schools.json', 'data/sections.json', 'data/site.json']) main.set(f, readFileSync(path.join(root, f), 'utf8'));
    Object.assign(g, { branches: new Map([['main', main]]), prs: [], nextPr: 100, run: null, commits: new Map([['main', []]]) });
  };
  g.reset();
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname.replace(`/repos/${REPO}`, ''));
    const B = g.branches;
    let m;
    if ((m = p.match(/^\/git\/ref\/heads\/(.+)$/)) && req.method === 'GET') return B.has(m[1]) ? json(res, 200, { object: { sha: `sha-${m[1]}` } }) : json(res, 404, { message: 'Not Found' });
    if (p === '/git/refs' && req.method === 'POST') { const name = body.ref.replace('refs/heads/', ''); B.set(name, new Map(B.get('main'))); g.commits.set(name, []); return json(res, 201, {}); }
    if ((m = p.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method === 'DELETE') { B.delete(m[1]); return json(res, 204, {}); }
    if ((m = p.match(/^\/contents\/(.+)$/))) {
      if (req.method === 'GET') {
        const files = B.get(u.searchParams.get('ref'));
        if (!files || !files.has(m[1])) return json(res, 404, { message: 'Not Found' });
        const text = files.get(m[1]);
        return json(res, 200, { sha: `f${text.length}`, content: Buffer.from(text, 'utf8').toString('base64') });
      }
      if (req.method === 'PUT') {
        const files = B.get(body.branch);
        if (!files) return json(res, 422, { message: 'no branch' });
        if (files.has(m[1]) && body.sha !== `f${files.get(m[1]).length}`) return json(res, 409, { message: 'sha mismatch' });
        files.set(m[1], m[1].endsWith('.json') ? Buffer.from(body.content, 'base64').toString('utf8') : `BINARY:${body.content.length}`);
        g.commits.get(body.branch).push(body.message);
        return json(res, 200, { content: {} });
      }
    }
    if (p === '/pulls' && req.method === 'GET') return json(res, 200, g.prs.filter((x) => x.state === 'open'));
    if (p === '/pulls' && req.method === 'POST') { const pr = { number: g.nextPr++, state: 'open', head: body.head }; g.prs.push(pr); return json(res, 201, pr); }
    if ((m = p.match(/^\/pulls\/(\d+)$/)) && req.method === 'PATCH') { g.prs.find((x) => x.number === +m[1]).state = body.state; return json(res, 200, {}); }
    if ((m = p.match(/^\/pulls\/(\d+)\/merge$/)) && req.method === 'PUT') {
      const pr = g.prs.find((x) => x.number === +m[1]);
      B.set('main', new Map(B.get(pr.head))); pr.state = 'closed'; pr.merged = true;
      return json(res, 200, { merged: true });
    }
    if ((m = p.match(/^\/compare\/main\.\.\.(.+)$/))) {
      const c = g.commits.get(m[1]) || [];
      return json(res, 200, { ahead_by: c.length, commits: c.map((message) => ({ commit: { message } })) });
    }
    if (p === '/actions/runs') return json(res, 200, { workflow_runs: g.run ? [g.run] : [] });
    json(res, 404, { message: `fake github: ${req.method} ${p}` });
  });
  g.start = () => new Promise((r) => server.listen(0, '127.0.0.1', () => { g.url = `http://127.0.0.1:${server.address().port}`; r(g); }));
  g.stop = () => server.close();
  return g;
}
