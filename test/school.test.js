const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
const M = require('../shared/model'), snap = require('../public/lib/snapshot'), T = require('../shared/time');

const blk = T.parseBlock('3:30 PM - 4:30 PM');
const st = (id, name, school) => ({ id, name, category: 'Middle', state: 'Delhi', school, plan: [{ date: '2026-10-21', block: blk }, null, null], sides: null });
const built = () => snap.build({ students: [st('M-1', 'Asha', 'Ridge School'), st('M-2', 'Bhavya', 'Ridge School'), st('M-3', 'Chetan', 'DPS Vasant Kunj'), st('M-4', 'Divya', '')], debates: [], config: { rooms: 30, blocks: [blk], dates: [] }, showState: false });

test('Roster: school is read and tidied (extra spaces collapsed)', () => {
  const row = { student_id: 'M-1', name: 'A', category: 'Middle', state: 'X', school: '  Ridge   School ', 'R1 date': '', 'R1 slot': '', 'R2 date': '', 'R2 slot': '', 'R3 date': '', 'R3 slot': '' };
  assert.strictEqual(M.parseStudents([row], { year: 2026 }).students[0].school, 'Ridge School');
});
test('each school name is stored once; students point to it; missing schools are reported', () => {
  const b = built();
  assert.deepStrictEqual(b.snapshot.schools, ['Ridge School', 'DPS Vasant Kunj']);
  assert.deepStrictEqual(b.snapshot.students.map(s => s.scx), [0, 0, 1, undefined]);
  assert.ok(b.warnings.some(w => /1 student\(s\) have no school/.test(w) && /M-4/.test(w)));
});
test('export: no trace of school unless the switch is on', () => {
  const b = built();
  const off = snap.exportStudents(b.snapshot.students, false);
  assert.ok(off.every(s => !('sc' in s) && !('scx' in s)));
  assert.ok(!/Ridge|DPS/.test(JSON.stringify(off)));
  const on = snap.exportStudents(b.snapshot.students, false, { school: true });
  assert.deepStrictEqual(on.map(s => s.sc), [0, 0, 1, undefined]); assert.ok(on.every(s => !('scx' in s)));
});
test('Google asks for the school column only; the neighbouring registration/flag/note columns are never requested', async () => {
  const { googleSource } = require('../shared/source');
  const header = ['student_id', 'name', 'category', 'state', 'R1 date', 'R1 slot', 'R2 date', 'R2 slot', 'R3 date', 'R3 slot', 'side_R1', 'side_R2', 'side_R3', 'school', 'school_as_registered', 'school_flag', 'allocation_note'];
  const urls = [];
  const f = async (url) => { const u = decodeURIComponent(url); urls.push(u); if (/!1:1/.test(u)) return { ok: true, json: async () => ({ values: [header] }) }; return { ok: true, json: async () => ({ valueRanges: [...u.matchAll(/ranges='Roster'!/g)].map(() => ({ values: [['h', 'v']] })) }) }; };
  const src = googleSource({ SHEET_ID: 'x', GOOGLE_CREDENTIALS: JSON.stringify({ client_email: 'a@b', private_key: 'k' }) }, { getToken: async () => 't', fetch: f });
  await src.table('Roster', { columns: ['student_id', 'name', 'category', 'R1 date'], optional: ['state', 'school', 'side_R1', 'side_R2', 'side_R3'] });
  const asked = urls.join();
  assert.ok(/!N:N/.test(asked), 'school (column N) requested');
  assert.ok(!/!O:O|!P:P|!Q:Q/.test(asked), 'school_as_registered / school_flag / allocation_note must not be requested');
});

// ---- server: switch off by default, never leaks the internal columns
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'sc', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sch-')), DEFAULT_SLOTS_VISIBLE: 'true' });
const pub = require('../public/server');
let base, server;
test.before(async () => { await pub.refresh(); ({ server, base } = await H.listen(pub.app)); });
test.after(() => server && server.close());
const get = async p => (await fetch(base + p)).json();
const post = (b) => fetch(base + '/host/sc/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

test('server: School switch is off by default; nothing about schools is published', async () => {
  const raw = await (await fetch(base + '/api/snapshot')).text();
  assert.ok(!/Sample School|"schools"|"sc"|REGISTERED-AS|INTERNAL NOTE|school_flag/.test(raw));
  assert.strictEqual((await get('/host/sc/status')).school, false);
});
test('server: switching School on publishes the names (still never the internal columns); off again removes them', async () => {
  const s = await post({ school: true }); assert.strictEqual(s.school, true);
  const snapOn = await get('/api/snapshot');
  assert.ok(Array.isArray(snapOn.schools) && snapOn.schools.length > 10);
  const a = snapOn.students.find(x => x.i === 'J-AP-01');
  assert.strictEqual(snapOn.schools[a.sc], 'Andhra Pradesh Sample School 3');
  const raw = JSON.stringify(snapOn);
  assert.ok(!/REGISTERED-AS|INTERNAL NOTE|school_flag|school_as_registered|allocation_note/.test(raw));
  const v1 = (await get('/api/v')).v;
  await post({ school: false });
  assert.notStrictEqual((await get('/api/v')).v, v1);
  assert.ok(!/Sample School/.test(await (await fetch(base + '/api/snapshot')).text()));
});
test('server: school switch is part of backup and restore', async () => {
  await post({ school: true });
  const b = await (await fetch(base + '/host/sc/backup')).json(); assert.strictEqual(b.switches.school, true);
  await post({ school: false });
  assert.strictEqual((await fetch(base + '/host/sc/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, 200);
  assert.strictEqual((await get('/host/sc/status')).school, true);
  await post({ school: false });
});
