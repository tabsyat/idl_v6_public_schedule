const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'sk', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')), DEFAULT_SLOTS_VISIBLE: 'true' });
const pub = require('../public/server'), S = require('../public/lib/sides');
let base, server;
test.before(async () => { await pub.refresh(); ({ server, base } = await H.listen(pub.app)); });
test.after(() => server.close());
const J = async p => (await fetch(base + p)).json();
const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }));
const rows = fs.readFileSync(path.join(process.env.SAMPLE_DIR, 'Roster.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(','));
// student id, R1 date (ISO), R1 side for Juniors
const jr = rows.filter(r => r[2] === 'Junior' && r[10] && r[4]).map(r => ({ id: r[0], date: new Date(r[4] + ' UTC').toISOString().slice(0, 10), side: r[10] }));
const early = jr.find(x => x.date === '2026-10-21'), late = jr.find(x => x.date === '2026-10-22');
const rel = iso => S.releaseAt(iso, 3);

test('sample has Juniors on two different R1 days', () => assert.ok(early && late));

test('automatic rule: a side opens 3 days before THAT student\'s round, student by student', async () => {
  await post('/host/sk/switch', { sidesAuto: true, sidesAll: { r1: false, r2: false, r3: false } });
  pub.setClock(() => rel('2026-10-21') - 1000);                                      // just before 18 Oct 00:00 IST
  const v0 = (await J('/api/v')).v, snap0 = await J('/api/snapshot');
  assert.ok(snap0.students.every(s => !s.sd), 'nothing revealed yet');
  assert.ok(!/"sd"/.test(JSON.stringify(snap0)));
  pub.setClock(() => rel('2026-10-21') + 1000);                                      // just after: only 21 Oct rounds
  const v1 = (await J('/api/v')).v;
  assert.notStrictEqual(v1, v0, 'public version changes by itself when a release time passes (phones re-fetch)');
  const snap1 = await J('/api/snapshot'), byId = {}; snap1.students.forEach(s => byId[s.i] = s);
  assert.deepStrictEqual(byId[early.id].sd, [early.side, null, null]);
  assert.ok(!byId[late.id].sd, 'the student whose R1 is on 22 Oct must not see a side yet');
  pub.setClock(() => rel('2026-10-22') + 1000);
  assert.deepStrictEqual((await J('/api/snapshot')).students.find(s => s.i === late.id).sd, [late.side, null, null]);
});
test('Junior debates follow the same rule; Middle and Senior are untouched', async () => {
  pub.setClock(() => rel('2026-10-21') - 1000);
  const before = await J('/api/snapshot');
  assert.ok(before.debates.filter(d => d.m[0].startsWith('J-') && d.d === '2026-10-21').every(d => d.sv === 0));
  pub.setClock(() => rel('2026-10-21') + 1000);
  const after = await J('/api/snapshot');
  assert.ok(after.debates.filter(d => d.m[0].startsWith('J-') && d.d === '2026-10-21').some(d => d.sv === 1));
  const nonJr = d => !d.m[0].startsWith('J-');
  assert.deepStrictEqual(before.debates.filter(nonJr), after.debates.filter(nonJr));
});
test('override: "show everyone now" ignores the date and is per round', async () => {
  pub.setClock(() => rel('2026-10-21') - 1e9);                                       // long before everything
  await post('/host/sk/switch', { sidesAuto: false, sidesAll: { r2: true } });
  const snap = await J('/api/snapshot');
  const withSd = snap.students.filter(s => s.sd);
  assert.ok(withSd.length > 200 && withSd.every(s => s.sd[0] === null && s.sd[2] === null && /^(Prop|Opp)$/.test(s.sd[1])));
  const st = (await J('/host/sk/status')); assert.strictEqual(st.sidesInfo.rounds[1].override, true); assert.strictEqual(st.sidesInfo.rounds[1].revealed, st.sidesInfo.rounds[1].total);
  await post('/host/sk/switch', { sidesAll: { r2: false } });
  assert.ok((await J('/api/snapshot')).students.every(s => !s.sd), 'switching it off hides again');
});
test('automatic off and no override: nothing shows, even long after the dates', async () => {
  pub.setClock(() => rel('2026-10-30') + 1e9);
  await post('/host/sk/switch', { sidesAuto: false, sidesAll: { r1: false, r2: false, r3: false } });
  const snap = await J('/api/snapshot');
  assert.ok(snap.students.every(s => !s.sd) && snap.debates.filter(d => d.m[0].startsWith('J-')).every(d => d.sv === 0));
});
test('host summary shows how many are visible and when the next batch opens', async () => {
  pub.setClock(() => rel('2026-10-21') + 1000);
  await post('/host/sk/switch', { sidesAuto: true });
  const r1 = (await J('/host/sk/status')).sidesInfo.rounds[0];
  const on21 = jr.filter(x => x.date === '2026-10-21').length;
  assert.strictEqual(r1.revealed, on21); assert.strictEqual(r1.total, rows.filter(r => r[2] === 'Junior' && r[10]).length, 'total includes Juniors whose R1 has no date yet (only an override can show those)');
  assert.strictEqual(r1.next, rel('2026-10-22')); assert.strictEqual(r1.nextCount, jr.filter(x => x.date === '2026-10-22').length);
});
test('switches survive in backup/restore; an older single "sides" switch maps to all three rounds', async () => {
  await post('/host/sk/switch', { sidesAuto: false, sidesAll: { r1: true, r2: false, r3: true } });
  const b = await (await fetch(base + '/host/sk/backup')).json();
  assert.strictEqual(b.switches.sidesAuto, false); assert.deepStrictEqual(b.switches.sidesAll, { r1: true, r2: false, r3: true });
  await post('/host/sk/switch', { sidesAuto: true, sidesAll: { r1: false, r3: false } });
  assert.strictEqual((await post('/host/sk/restore', b)).status, 200);
  const st = await J('/host/sk/status'); assert.strictEqual(st.sidesAuto, false); assert.deepStrictEqual(st.sidesAll, { r1: true, r2: false, r3: true });
  const old = { app: 'idl-public', version: 1, switches: { slots: true, sides: true }, motions: {}, release: {} };
  assert.strictEqual((await post('/host/sk/restore', old)).status, 200);
  assert.deepStrictEqual((await J('/host/sk/status')).sidesAll, { r1: true, r2: true, r3: true });
});
test('the Roster is read for side_R1..R3 only (Google asks for those columns, nothing private)', async () => {
  const { googleSource } = require('../shared/source');
  const urls = [], header = ['student_id', 'name', 'category', 'state', 'R1 date', 'R1 slot', 'R2 date', 'R2 slot', 'R3 date', 'R3 slot', 'side_R1', 'side_R2', 'side_R3', 'Side Balance'];
  const f = async (url) => { const u = decodeURIComponent(url); urls.push(u); if (/!1:1/.test(u)) return { ok: true, json: async () => ({ values: [header] }) }; return { ok: true, json: async () => ({ valueRanges: [...u.matchAll(/ranges='Roster'!/g)].map(() => ({ values: [['h', 'v']] })) }) }; };
  const src = googleSource({ SHEET_ID: 'x', GOOGLE_CREDENTIALS: JSON.stringify({ client_email: 'a@b', private_key: 'k' }) }, { getToken: async () => 't', fetch: f });
  const r = await src.table('Roster', { columns: ['student_id', 'name', 'category', 'R1 date'], optional: ['state', 'side_R1', 'side_R2', 'side_R3'] });
  assert.ok(/!K:K/.test(urls.join()) && /!L:L/.test(urls.join()) && /!M:M/.test(urls.join()), 'side columns requested');
  assert.ok(!/!N:N/.test(urls.join()), 'the Side Balance column is never requested');
  assert.ok('side_R1' in r[0]);
});
