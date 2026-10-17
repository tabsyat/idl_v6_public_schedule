const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-'));
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'mk', DATA_DIR: dataDir, DEFAULT_SLOTS_VISIBLE: 'true' });
const { app, refresh } = require('../public/server');
let base, server;
test.before(async () => { await refresh(); ({ server, base } = await H.listen(app)); });
test.after(() => server.close());
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const J = async p => (await fetch(base + p)).json();
const stable = v => JSON.stringify(Object.assign({}, v, { now: 0 }));
const FAR = Date.UTC(2090, 0, 1), PAST = Date.UTC(2021, 0, 1);

test('motion text typed on the host page stays private until the date is released', async () => {
  let r = await post('/host/mk/motions', { date: '2026-10-21', motions: { Junior: 'SECRET-JUNIOR-TEXT', Middle: 'SECRET-MIDDLE', Senior: 'SECRET-SENIOR' } });
  assert.strictEqual(r.status, 200);
  await post('/host/mk/motions/release', { date: '2026-10-21', action: 'set', at: FAR });
  const pub = await J('/api/motions'), d = pub.dates.find(x => x.d === '2026-10-21');
  assert.strictEqual(d.ok, 0); assert.strictEqual(d.rel, FAR);
  for (const p of ['/api/motions', '/api/snapshot', '/api/v']) assert.ok(!/SECRET/.test(JSON.stringify(await J(p))), p + ' must not leak it');
  assert.strictEqual((await fetch(base + '/host/wrong/motions')).status, 404, 'host endpoints need the key');
});
test('releasing: a past time, or "Release now", shows the text; hold hides it again', async () => {
  await post('/host/mk/motions/release', { date: '2026-10-21', action: 'set', at: PAST });
  let d = (await J('/api/motions')).dates.find(x => x.d === '2026-10-21');
  assert.strictEqual(d.ok, 1); assert.strictEqual(d.m.Junior, 'SECRET-JUNIOR-TEXT');
  await post('/host/mk/motions/release', { date: '2026-10-21', action: 'hold' });
  d = (await J('/api/motions')).dates.find(x => x.d === '2026-10-21');
  assert.strictEqual(d.ok, 0); assert.ok(!('m' in d));
  await post('/host/mk/motions/release', { date: '2026-10-21', action: 'set', at: FAR });
  await post('/host/mk/motions/release', { date: '2026-10-21', action: 'now' });
  d = (await J('/api/motions')).dates.find(x => x.d === '2026-10-21');
  assert.strictEqual(d.ok, 1, 'Release now also clears a hold');
  await post('/host/mk/motions/release', { date: '2026-10-21', action: 'default' });
  assert.strictEqual((await J('/host/mk/motions')).dates[0].at, null);
});
test('validation: unknown date, bad action, bad time, too-long motion', async () => {
  assert.strictEqual((await post('/host/mk/motions', { date: '2026-12-25', motions: {} })).status, 400);
  assert.strictEqual((await post('/host/mk/motions/release', { date: '2026-10-21', action: 'explode' })).status, 400);
  assert.strictEqual((await post('/host/mk/motions/release', { date: '2026-10-21', action: 'set', at: 'soon' })).status, 400);
  assert.strictEqual((await post('/host/mk/motions', { date: '2026-10-21', motions: { Junior: 'x'.repeat(1600) } })).status, 400);
});
test('motions and overrides are saved in state.json (so the persistent disk keeps them)', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.strictEqual(saved.motions['2026-10-21'].Senior, 'SECRET-SENIOR');
});
test('backup then restore round-trips switches, motions and release times', async () => {
  await post('/host/mk/switch', { roster: true });
  await post('/host/mk/motions', { date: '2026-10-22', motions: { Middle: 'BACKED-UP' } });
  await post('/host/mk/motions/release', { date: '2026-10-22', action: 'set', at: FAR });
  const res = await fetch(base + '/host/mk/backup');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="idl-backup-\d{8}-\d{4}\.json"/);
  const file = await res.json();
  assert.strictEqual(file.app, 'idl-public'); assert.strictEqual(file.switches.roster, true);
  // wipe everything, then restore
  await post('/host/mk/motions', { date: '2026-10-22', motions: {} }); await post('/host/mk/motions/release', { date: '2026-10-22', action: 'default' });
  await post('/host/mk/switch', { roster: false });
  const r = await post('/host/mk/restore', file);
  assert.strictEqual(r.status, 200);
  const h = await J('/host/mk/motions'), d = h.dates.find(x => x.d === '2026-10-22');
  assert.strictEqual(d.m.Middle, 'BACKED-UP'); assert.strictEqual(d.at, FAR);
  assert.strictEqual((await J('/host/mk/status')).roster, true);
});
test('restore rejects files that are not backups, and changes nothing', async () => {
  const before = stable(await J('/host/mk/motions'));
  assert.strictEqual((await post('/host/mk/restore', { hello: 1 })).status, 400);
  assert.strictEqual((await post('/host/mk/restore', { app: 'idl-public', version: 1, motions: { '2026-10-21': { Junior: 5 } } })).status, 400);
  assert.strictEqual(stable(await J('/host/mk/motions')), before);
});

test('automatic release switch: off = only manual release; on = the 3-day rule', async () => {
  assert.strictEqual((await J('/host/mk/status')).motionsAuto, true, 'default is on');
  await post('/host/mk/motions', { date: '2026-10-29', motions: { Junior: 'AUTO-TEST' } });
  await post('/host/mk/motions/release', { date: '2026-10-29', action: 'default' });
  await post('/host/mk/switch', { motionsAuto: false });
  assert.strictEqual((await J('/host/mk/motions')).auto, false);
  const d = async () => (await J('/api/motions')).dates.find(x => x.d === '2026-10-29');
  assert.strictEqual((await d()).ok, 0);
  assert.strictEqual((await J('/host/mk/motions')).dates.find(x => x.d === '2026-10-29').state, 'manual');
  await post('/host/mk/motions/release', { date: '2026-10-29', action: 'now' });
  assert.strictEqual((await d()).ok, 1); assert.strictEqual((await d()).m.Junior, 'AUTO-TEST');
  await post('/host/mk/motions/release', { date: '2026-10-29', action: 'default' });
  await post('/host/mk/switch', { motionsAuto: true });
});
