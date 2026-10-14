const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
const sample = H.tmpSample();
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: sample, ADMIN_KEY: 'k3y', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'st-')), DEFAULT_SLOTS_VISIBLE: 'true', DEFAULT_PAIRINGS_VISIBLE: 'true' });
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
