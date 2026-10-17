const test = require('node:test'), assert = require('node:assert');
const S = require('../public/lib/sides'), M = require('../shared/model'), snap = require('../public/lib/snapshot');
const cfg = { lead: 3 };
const IST = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) - 330 * 60000;

test('side values from the sheet: Prop / Opp in any case or short form; anything else is blank', () => {
  ['Prop', 'prop', ' P ', 'Proposition'].forEach(v => assert.strictEqual(M.normSide(v), 'Prop'));
  ['Opp', 'opp', 'O', 'Opposition'].forEach(v => assert.strictEqual(M.normSide(v), 'Opp'));
  ['', null, undefined, 'x', '?'].forEach(v => assert.strictEqual(M.normSide(v), ''));
});
test('Roster: only Juniors keep sides; Middle/Senior cells are ignored and counted', () => {
  const row = (id, cat, a, b, c) => ({ student_id: id, name: id, category: cat, 'R1 date': '21 Oct 2026', 'R1 slot': '3:30 PM - 4:30 PM', 'R2 date': '', 'R2 slot': '', 'R3 date': '', 'R3 slot': '', side_R1: a, side_R2: b, side_R3: c });
  const r = M.parseStudents([row('J1', 'Junior', 'Prop', 'opp', ''), row('M1', 'Middle', 'Prop', '', ''), row('J2', 'Junior', '', '', ''), row('S1', 'Senior', '', '', '')], { year: 2026 });
  assert.deepStrictEqual(r.students[0].sides, ['Prop', 'Opp', '']);
  assert.strictEqual(r.students[1].sides, null); assert.strictEqual(r.students[2].sides, null);
  assert.strictEqual(r.ignoredSides, 1); assert.strictEqual(r.juniors, 2); assert.strictEqual(r.juniorsWithSides, 1);
});
test('release time = 00:00 IST, 3 days before the round date', () => {
  assert.strictEqual(S.releaseAt('2026-10-21', 3), IST(2026, 10, 18, 0, 0));
  assert.strictEqual(S.releaseAt('2026-10-02', 3), IST(2026, 9, 29, 0, 0));            // crosses a month boundary
  assert.strictEqual(S.config({}).lead, 3); assert.strictEqual(S.config({ SIDE_LEAD_DAYS: '5' }).lead, 5); assert.strictEqual(S.config({ SIDE_LEAD_DAYS: '0' }).lead, 0);
});
test('rule: automatic opens exactly at the release time; override ignores time; off hides', () => {
  const at = S.releaseAt('2026-10-21', 3), off = { r1: false, r2: false, r3: false };
  const auto = { auto: true, all: off };
  assert.strictEqual(S.revealer(cfg, auto, at - 1)(1, '2026-10-21'), false);
  assert.strictEqual(S.revealer(cfg, auto, at)(1, '2026-10-21'), true);
  assert.strictEqual(S.revealer(cfg, { auto: false, all: off }, at + 1e9)(1, '2026-10-21'), false, 'automatic rule off');
  assert.strictEqual(S.revealer(cfg, { auto: false, all: { r1: true, r2: false, r3: false } }, 0)(1, '2026-10-21'), true, 'override, any time');
  assert.strictEqual(S.revealer(cfg, { auto: false, all: { r1: true, r2: false, r3: false } }, 0)(2, '2026-10-21'), false, 'override is per round');
  assert.strictEqual(S.revealer(cfg, auto, at + 1e9)(1, null), false, 'no date: only an override can show it');
  assert.strictEqual(S.revealer(cfg, { auto: false, all: { r1: true } }, 0)(1, null), true);
});
test('instants are sorted and distinct (the moments the public data changes by itself)', () => {
  assert.deepStrictEqual(S.instants(cfg, ['2026-10-22', '2026-10-21', '2026-10-21']), [S.releaseAt('2026-10-21', 3), S.releaseAt('2026-10-22', 3)]);
});
test('host summary: revealed / total / next batch per round', () => {
  const dates = { 1: { '2026-10-21': 3, '2026-10-22': 2 }, 2: {}, 3: { '2026-10-27': 4 }, nodate: { 3: 1 } };
  const off = { r1: false, r2: false, r3: false };
  const now = S.releaseAt('2026-10-21', 3) + 1000;
  let v = S.hostView(cfg, { auto: true, all: off }, dates, now);
  assert.deepStrictEqual([v.rounds[0].revealed, v.rounds[0].total, v.rounds[0].nextCount, v.rounds[0].next], [3, 5, 2, S.releaseAt('2026-10-22', 3)]);
  assert.strictEqual(v.rounds[1].total, 0);
  assert.deepStrictEqual([v.rounds[2].revealed, v.rounds[2].total], [0, 5]);
  v = S.hostView(cfg, { auto: true, all: { r1: false, r2: false, r3: true } }, dates, now);
  assert.deepStrictEqual([v.rounds[2].revealed, v.rounds[2].override, v.rounds[2].next], [5, true, null]);
  v = S.hostView(cfg, { auto: false, all: off }, dates, now);
  assert.strictEqual(v.rounds[0].revealed, 0); assert.strictEqual(v.rounds[0].next, null, 'no "next batch" when automatic is off');
});

// ---- export: each side is released by its own student's date
function mini() {
  const T = require('../shared/time'), blk = T.parseBlock('3:30 PM - 4:30 PM');
  const mk = (id, name, d1, side) => ({ id, name, category: 'Junior', state: '', plan: [{ date: d1, block: blk }, null, null], sides: [side, '', ''] });
  const students = [mk('J-A', 'Asha', '2026-10-21', 'Prop'), mk('J-B', 'Bhavya', '2026-10-21', 'Opp'), mk('J-C', 'Chetan', '2026-10-22', 'Prop'), mk('J-D', 'Divya', '2026-10-22', 'Opp')];
  const debates = [{ row: 2, date: '2026-10-21', block: blk, section: 1, room: 1, round: 1, walkover: false, sidesVisible: true, category: 'Junior', absentId: '', propId: 'J-B', propName: 'Bhavya', oppId: 'J-A', oppName: 'Asha' }];
  return snap.build({ students, debates, config: { rooms: 30, blocks: [blk], dates: [] }, showState: false });
}
test('export: students and Junior debates are released date by date, never earlier', () => {
  const b = mini(), sw = { auto: true, all: { r1: false, r2: false, r3: false } };
  const t1 = S.releaseAt('2026-10-21', 3), t2 = S.releaseAt('2026-10-22', 3);
  const at = (now) => S.revealer(cfg, sw, now);
  let st = snap.exportStudents(b.snapshot.students, at(t1 - 1)), db = snap.exportDebates(b.snapshot.debates, at(t1 - 1));
  assert.ok(st.every(s => !s.sd)); assert.strictEqual(db[0].sv, 0); assert.deepStrictEqual(db[0].m, ['J-A', 'J-B'], 'alphabetical while hidden (Bhavya is Prop but listed second)');
  st = snap.exportStudents(b.snapshot.students, at(t1)); db = snap.exportDebates(b.snapshot.debates, at(t1));
  assert.deepStrictEqual(st.filter(s => s.sd).map(s => s.i).sort(), ['J-A', 'J-B']);       // the 21 Oct students only
  assert.deepStrictEqual(st.find(s => s.i === 'J-A').sd, ['Prop', null, null]);
  assert.strictEqual(db[0].sv, 1); assert.deepStrictEqual(db[0].m, ['J-B', 'J-A']);          // now real order [Prop, Opp]
  st = snap.exportStudents(b.snapshot.students, at(t2));
  assert.strictEqual(st.filter(s => s.sd).length, 4);
  assert.ok(!/"(sdd|jr|hm)"/.test(JSON.stringify(st) + JSON.stringify(db)));
});
test('the date used is the debate date once paired, not the planned one', () => {
  const b = mini();
  const a = b.snapshot.students.find(s => s.i === 'J-A');
  assert.deepStrictEqual(a.sdd, ['2026-10-21', null, null]);
  assert.deepStrictEqual(b.snapshot.sideDates[1], { '2026-10-21': 2, '2026-10-22': 2 });
  assert.deepStrictEqual(b.snapshot.releaseDates, ['2026-10-21', '2026-10-22']);
});
test('warning when the Roster side disagrees with the Debates row', () => {
  const b = mini();                                  // Debates: J-B is Prop, J-A is Opp; Roster: J-A Prop, J-B Opp
  assert.ok(b.warnings.some(w => /do not match the Roster sides/.test(w) && /J-B/.test(w)));
});
