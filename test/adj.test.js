const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const H = require('./helpers');
const sample = H.tmpSample();
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: sample, ADMIN_KEY: 'k3y', ADJ_SECRET: 'unit-secret', BALLOT_APP_URL: 'https://ballot.example.invalid/exec', CACHE_SECONDS: '0' });
const tokenLib = require('../adj/lib/token'), { app } = require('../adj/server');
let base, server;
test.before(async () => { ({ server, base } = await H.listen(app)); });
test.after(() => server.close());
const me = async (name, t, date) => { const r = await fetch(`${base}/api/me?adj=${encodeURIComponent(name)}&t=${t}` + (date ? '&date=' + date : '')); return { status: r.status, body: await r.json() }; };
const code = n => tokenLib.make('unit-secret', n);

test('token: right name+code only; case and spacing of the name do not matter', () => {
  const t = tokenLib.make('s', 'Asha  Rao');
  assert.ok(tokenLib.verify('s', 'asha rao', t));
  assert.ok(!tokenLib.verify('s', 'Asha Rao', t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')));
  assert.ok(!tokenLib.verify('other', 'Asha Rao', t));
  assert.ok(!tokenLib.verify('s', 'Asha Rao', ''));
});
test('ballot url pattern: BALLOT_APP_URL?debate=<id>&t=<token>', () => {
  assert.strictEqual(tokenLib.ballotUrl('https://x/exec', 'D-0001', 'abc'), 'https://x/exec?debate=D-0001&t=abc');
  assert.strictEqual(tokenLib.ballotUrl('https://x/exec?v=1', 'D-0001', 'abc'), 'https://x/exec?v=1&debate=D-0001&t=abc');
  assert.strictEqual(tokenLib.ballotUrl('', 'D-0001', 'abc'), null);
  assert.strictEqual(tokenLib.ballotUrl('https://x', 'D-0001', ''), null);
});
test('invalid or mismatched link: 403 and no data', async () => {
  assert.strictEqual((await me('Sample Adjudicator 01', 'bad')).status, 403);
  const r = await me('Sample Adjudicator 02', code('Sample Adjudicator 01')); assert.strictEqual(r.status, 403); assert.deepStrictEqual(Object.keys(r.body), ['error']);
});
test('an adjudicator sees only their own debates and ballot links', async () => {
  const csv = fs.readFileSync(path.join(sample, 'Debates.csv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split(','));
  const mine = csv.filter(r => r[12] === 'Sample Adjudicator 01' && r[2] === '21 Oct 2026' && r[13] !== 'DISSOLVED');
  const r = await me('Sample Adjudicator 01', code('Sample Adjudicator 01'), '2026-10-21');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.debates.length, mine.length);
  const json = JSON.stringify(r.body);
  csv.filter(x => x[12] !== 'Sample Adjudicator 01').forEach(x => assert.ok(!json.includes(x[11]), 'someone else\'s token leaked'));
  mine.forEach(x => assert.ok(json.includes('debate=' + x[0] + '&t=' + x[11])));
  assert.ok(r.body.debates.every(d => d.room === 1));
});
test('hidden sides stay hidden; walkover has no ballot; dissolved is skipped', async () => {
  const csv = fs.readFileSync(path.join(sample, 'Debates.csv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split(','));
  const hid = csv.find(r => r[14] === 'FALSE' && r[13] === 'ACTIVE'), adj = hid[12], date = new Date(hid[2] + ' UTC');
  const iso = date.toISOString().slice(0, 10);
  const r = await me(adj, code(adj), iso);
  const d = r.body.debates.find(x => x.students.some(s => s.id === hid[6]));
  assert.ok(d && d.students.every(s => s.side === null));
  const names = d.students.map(s => s.name.toLowerCase()); assert.deepStrictEqual(names, names.slice().sort());
  const w = csv.find(r => r[13] === 'WALKOVER'); const rw = await me(w[12], code(w[12]), new Date(w[2] + ' UTC').toISOString().slice(0, 10));
  const dw = rw.body.debates.find(x => x.walkover); assert.ok(dw); assert.strictEqual(dw.ballotUrl, null); assert.strictEqual(dw.ballotNote, 'walkover');
  assert.ok(dw.students.some(s => s.absent));
  const dis = csv.find(r => r[13] === 'DISSOLVED'); const rd = await me(dis[12], code(dis[12]), new Date(dis[2] + ' UTC').toISOString().slice(0, 10));
  assert.ok(!JSON.stringify(rd.body).includes('debate=' + dis[0] + '&'));
});
test('blank adjudicator in Debates falls back to Adj_Grid; blank token says "not ready"', async () => {
  const f = path.join(sample, 'Debates.csv'), orig = fs.readFileSync(f, 'utf8'), lines = orig.split('\n');
  const c = lines[1].split(','); c[12] = ''; c[11] = ''; lines[1] = c.join(',');       // D-0001: no adjudicator, no token
  fs.writeFileSync(f, lines.join('\n'));
  const r = await me('Sample Adjudicator 01', code('Sample Adjudicator 01'), '2026-10-21');
  const d = r.body.debates.find(x => x.students.some(s => s.id === c[6]));
  assert.ok(d, 'debate must still be listed via Adj_Grid'); assert.strictEqual(d.ballotUrl, null); assert.strictEqual(d.ballotNote, 'no-token');
  fs.writeFileSync(f, orig);
});
test('BALLOT_APP_URL unset: buttons say so instead of a broken link', async () => {
  const saved = process.env.BALLOT_APP_URL; // module read it at load; verify the view function directly
  const views = require('../adj/lib/views'), data = await (async () => { const src = require('../shared/source').createSource(process.env); return require('../adj/lib/data').create(src, { year: 2026, cacheSeconds: 0 }).get(); })();
  const out = views.myDay(data.data, 'Sample Adjudicator 01', '2026-10-21', '');
  assert.ok(out.debates.every(d => d.ballotUrl === null && (d.ballotNote === 'no-url' || d.ballotNote === 'walkover')));
});
test('allocation endpoint is open but has no tokens or students; links page is key-protected', async () => {
  const a = await (await fetch(base + '/api/allocation')).text();
  assert.ok(!/"token"|"students"|debate=/.test(a)); assert.ok(a.includes('Sample Adjudicator 01'));
  assert.strictEqual((await fetch(base + '/links/nope/data')).status, 404);
  const l = await (await fetch(base + '/links/k3y/data')).json(); assert.strictEqual(l.links.length, 30);
  assert.ok(l.links[0].url.includes('&t=' + code(l.links[0].name)));
  const csv = await (await fetch(base + '/links/k3y/links.csv')).text(); assert.ok(csv.startsWith('name,link'));
});
