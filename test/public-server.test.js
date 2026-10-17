const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
const sample = H.tmpSample();
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: sample, ADMIN_KEY: 'k3y', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), DEFAULT_SIDES_VISIBLE: 'true', DEFAULT_SLOTS_VISIBLE: 'true', DEFAULT_PAIRINGS_VISIBLE: 'true' });
const { app, refresh } = require('../public/server');
let base, server;
const j = async (p, o) => { const r = await fetch(base + p, o); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
const post = (p, b) => j(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

test.before(async () => { await refresh(); ({ server, base } = await H.listen(app)); });
test.after(() => server.close());

test('snapshot served with ETag; unchanged data answers 304', async () => {
  const r = await fetch(base + '/api/snapshot'); const etag = r.headers.get('etag');
  assert.strictEqual(r.status, 200); assert.ok(etag);
  // raw http: Node's fetch adds "Cache-Control: no-cache" to conditional requests, which (correctly) defeats a 304
  const status = await new Promise(res => require('http').get(base + '/api/snapshot', { headers: { 'If-None-Match': etag } }, q => { q.resume(); res(q.statusCode); }));
  assert.strictEqual(status, 304);
  assert.strictEqual(r.headers.get('x-robots-tag'), 'noindex, nofollow');
});
test('snapshot is gzip-compressed once per version and reused; clients without gzip still work', async () => {
  const http = require('http'), zlib = require('zlib');
  const raw = headers => new Promise(res => http.get(base + '/api/snapshot', { headers }, r => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => res({ enc: r.headers['content-encoding'], vary: r.headers.vary, body: Buffer.concat(c) })); }));
  const a = await raw({ 'Accept-Encoding': 'gzip' }), b = await raw({ 'Accept-Encoding': 'gzip' }), plain = await raw({});
  assert.strictEqual(a.enc, 'gzip'); assert.match(a.vary, /Accept-Encoding/);
  assert.ok(a.body.equals(b.body), 'the same compressed bytes are reused for every visitor');
  const j = JSON.parse(zlib.gunzipSync(a.body)); assert.ok(j.students.length > 800);
  assert.strictEqual(plain.enc, undefined); assert.deepStrictEqual(JSON.parse(plain.body.toString()), j);
  await post('/host/k3y/switch', { slots: false });                                  // a new version must not serve the old cached bytes
  assert.strictEqual(JSON.parse(zlib.gunzipSync((await raw({ 'Accept-Encoding': 'gzip' })).body)).enabled, false);
  await post('/host/k3y/switch', { slots: true });
});
test('host page needs the unguessable key', async () => {
  assert.strictEqual((await j('/host/wrong/status')).status, 404);
  assert.strictEqual((await post('/host/wrong/refresh')).status, 404);
  assert.strictEqual((await j('/host/k3y/status')).status, 200);
});
test('slot switch off: server sends no student data at all', async () => {
  const before = (await j('/api/v')).body.v;
  const s = await post('/host/k3y/switch', { slots: false });
  assert.strictEqual(s.body.slots, false);
  const v = await j('/api/v'); assert.notStrictEqual(v.body.v, before); assert.strictEqual(v.body.enabled, false);
  const snap = await j('/api/snapshot'); assert.deepStrictEqual(Object.keys(snap.body).sort(), ['builtAt', 'enabled', 'v']);
  await post('/host/k3y/switch', { slots: true });
  assert.ok((await j('/api/snapshot')).body.students.length > 800);
});
test('pairings switch off: plans stay, debates are removed server-side', async () => {
  await post('/host/k3y/switch', { pairings: false });
  const snap = (await j('/api/snapshot')).body;
  assert.strictEqual(snap.pairings, false); assert.strictEqual(snap.debates.length, 0); assert.ok(snap.students.length > 800);
  await post('/host/k3y/switch', { pairings: true });
  assert.ok((await j('/api/snapshot')).body.debates.length > 100);
});
test('refresh picks up a new reveal; a failed refresh keeps the last good data', async () => {
  const f = path.join(sample, 'Debates.csv'), orig = fs.readFileSync(f, 'utf8');
  const hiddenBefore = (await j('/api/snapshot')).body.debates.filter(d => !d.sv).length;
  fs.writeFileSync(f, orig.replace(/,FALSE,/g, ',TRUE,'));                       // host reveals every side
  const r = await post('/host/k3y/refresh'); assert.strictEqual(r.status, 200);
  const after = (await j('/api/snapshot')).body.debates;
  assert.ok(hiddenBefore > 0 && after.filter(d => !d.sv).length === 0);
  fs.unlinkSync(f);                                                                // sheet becomes unreadable
  const bad = await post('/host/k3y/refresh'); assert.strictEqual(bad.status, 502); assert.ok(bad.body.error);
  assert.ok(bad.body.lastError);
  assert.ok((await j('/api/snapshot')).body.debates.length > 100, 'old data must still be served');
  fs.writeFileSync(f, orig);
});
test('state file keeps switches across restarts', async () => {
  await post('/host/k3y/switch', { slots: false });
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'state.json'), 'utf8'));
  assert.strictEqual(saved.slots, false);
  await post('/host/k3y/switch', { slots: true });
});

test('roster switch: state is only sent while the Roster switch is on', async () => {
  const { app } = require('../public/server');
  const { listen } = require('./helpers');
  const { server, base } = await listen(app);
  try {
    const key = process.env.ADMIN_KEY;
    const get = async () => (await fetch(base + '/api/snapshot')).json();
    await fetch(`${base}/host/${key}/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: true, roster: false }) });
    let snap = await get();
    if (snap.students) { assert.strictEqual(snap.roster, false); assert.ok(snap.students.every(s => !('st' in s))); }
    await fetch(`${base}/host/${key}/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roster: true }) });
    snap = await get();
    assert.strictEqual(snap.roster, true); assert.ok(snap.students.some(s => s.st));
    await fetch(`${base}/host/${key}/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roster: false }) });
    assert.ok((await get()).students.every(s => !('st' in s)));
  } finally { server.close(); }
});

test('Junior sides: hidden until a round is revealed; decided server-side, no ordering hint', async () => {
  await post('/host/k3y/switch', { pairings: true, sidesAuto: false, sidesAll: { r1: false, r2: false, r3: false } });
  const off = (await j('/api/snapshot')).body, names = {}; off.students.forEach(s => names[s.i] = s.n.toLowerCase());
  const jr = off.debates.filter(d => d.m[0].startsWith('J-'));
  assert.ok(jr.length > 50 && jr.every(d => d.sv === 0 && names[d.m[0]] <= names[d.m[1]]));
  assert.ok(!/"(jr|hm|sd|sdd)"/.test(JSON.stringify(off)), 'internal or unrevealed side fields must not be exported');
  assert.ok(off.students.every(s => !('sd' in s)));
  await post('/host/k3y/switch', { sidesAll: { r1: true } });
  const on = (await j('/api/snapshot')).body;
  assert.ok(on.debates.filter(d => d.n === 1 && d.m[0].startsWith('J-')).some(d => d.sv === 1));
  assert.ok(on.debates.filter(d => d.n === 2 && d.m[0].startsWith('J-')).every(d => d.sv === 0), 'R2 not revealed');
  const withSd = on.students.filter(s => s.sd);
  assert.ok(withSd.length > 200 && withSd.every(s => s.sd[1] === null && s.sd[2] === null && /^(Prop|Opp)$/.test(s.sd[0])));
  const st = (await j('/host/k3y/status')).body;
  assert.strictEqual(st.sidesAll.r1, true); assert.strictEqual(st.sidesAll.r2, false); assert.strictEqual(st.sidesAuto, false);
  await post('/host/k3y/switch', { sidesAll: { r1: false } });
});
