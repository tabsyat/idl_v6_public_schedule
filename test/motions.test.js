const test = require('node:test'), assert = require('node:assert');
const M = require('../public/lib/motions');
const cfg = M.config({}, 2026);
const IST = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000;
const data = (motions, release) => ({ motions: motions || {}, release: release || {} });
const full = { Junior: 'J motion', Middle: 'M motion', Senior: 'S motion' };

test('dates run 21-31 Oct and each releases at 00:00 IST, 3 days before', () => {
  assert.strictEqual(cfg.dates.length, 11);
  assert.strictEqual(cfg.dates[0], '2026-10-21'); assert.strictEqual(cfg.dates[10], '2026-10-31');
  assert.strictEqual(M.defaultRelease('2026-10-21', 3), IST(2026, 10, 18));
  assert.strictEqual(M.defaultRelease('2026-10-22', 3), IST(2026, 10, 19));
  assert.strictEqual(M.defaultRelease('2026-11-01', 3), IST(2026, 10, 29), 'month rollover');
});
test('released exactly at the release moment, not a millisecond before', () => {
  const d = data({ '2026-10-21': full });
  const before = M.publicView(cfg, d, IST(2026, 10, 18) - 1).dates[0], at = M.publicView(cfg, d, IST(2026, 10, 18)).dates[0];
  assert.strictEqual(before.ok, 0); assert.strictEqual(before.rel, IST(2026, 10, 18)); assert.ok(!('m' in before));
  assert.strictEqual(at.ok, 1); assert.deepStrictEqual(at.m, full);
});
test('unreleased dates never carry motion text', () => {
  const v = M.publicView(cfg, data({ '2026-10-25': full }), IST(2026, 10, 18));
  const d = v.dates.find(x => x.d === '2026-10-25');
  assert.strictEqual(d.ok, 0); assert.ok(!/motion/.test(JSON.stringify(d)));
});
test('next = the soonest upcoming release time', () => {
  assert.strictEqual(M.publicView(cfg, data(), IST(2026, 10, 18, 12)).next, IST(2026, 10, 19));
  assert.strictEqual(M.publicView(cfg, data(), IST(2026, 11, 5)).next, null);
});
test('override time, release now, and hold', () => {
  const t = IST(2026, 10, 20, 9);
  let v = M.publicView(cfg, data({ '2026-10-21': full }, { '2026-10-21': { at: t } }), t - 1).dates[0];
  assert.strictEqual(v.ok, 0); assert.strictEqual(v.rel, t);
  v = M.publicView(cfg, data({ '2026-10-21': full }, { '2026-10-21': { at: t } }), t).dates[0];
  assert.strictEqual(v.ok, 1);
  v = M.publicView(cfg, data({ '2026-10-21': full }, { '2026-10-21': { hold: true } }), IST(2026, 10, 25)).dates[0];
  assert.strictEqual(v.ok, 0); assert.strictEqual(v.rel, null); assert.ok(!('m' in v), 'a held date hides even after its time has passed');
});
test('released with nothing typed yet: ok but no motions', () => {
  const v = M.publicView(cfg, data(), IST(2026, 10, 19)).dates[0];
  assert.strictEqual(v.ok, 1); assert.ok(!('m' in v));
});
test('partial motions only send what was typed', () => {
  const v = M.publicView(cfg, data({ '2026-10-21': { Junior: 'only junior', Middle: '   ' } }), IST(2026, 10, 19)).dates[0];
  assert.deepStrictEqual(v.m, { Junior: 'only junior' });
});
test('host view shows state, default time and typed text', () => {
  const h = M.hostView(cfg, data({ '2026-10-21': full }, { '2026-10-22': { hold: true } }), IST(2026, 10, 18, 1));
  assert.strictEqual(h.dates[0].state, 'released'); assert.strictEqual(h.dates[0].filled, 3); assert.strictEqual(h.dates[0].m.Junior, 'J motion');
  assert.strictEqual(h.dates[1].state, 'held'); assert.strictEqual(h.dates[2].state, 'scheduled');
  assert.strictEqual(h.dates[0].def, IST(2026, 10, 18)); assert.strictEqual(h.dates[0].label, 'Wed 21 Oct');
});
test('cleanMotions: trims, normalises newlines, rejects long or non-text input', () => {
  assert.deepStrictEqual(M.cleanMotions({ Junior: '  hi\r\nthere  ', Middle: '', Senior: null }).value, { Junior: 'hi\nthere' });
  assert.ok(M.cleanMotions({ Junior: 'x'.repeat(M.MAX_LEN + 1) }).error);
  assert.ok(M.cleanMotions({ Junior: 5 }).error);
  assert.ok(M.cleanMotions(null).error);
});
test('cleanBackup drops unknown dates and rejects bad times', () => {
  const ok = M.cleanBackup({ motions: { '2026-10-21': full, '1999-01-01': full }, release: { '2026-10-21': { at: IST(2026, 10, 20), hold: true } } }, cfg);
  assert.deepStrictEqual(Object.keys(ok.motions), ['2026-10-21']); assert.strictEqual(ok.release['2026-10-21'].hold, true);
  assert.ok(M.cleanBackup({ release: { '2026-10-21': { at: 'tomorrow' } } }, cfg).error);
  assert.ok(M.cleanBackup(null, cfg).error);
});

test('automatic rule OFF: nothing opens by itself; Release now and explicit times still work', () => {
  const m = { '2026-10-21': full }, late = IST(2026, 11, 20);
  let d = M.publicView(cfg, { motions: m, release: {}, auto: false }, late);
  assert.strictEqual(d.dates[0].ok, 0); assert.strictEqual(d.dates[0].rel, null); assert.strictEqual(d.next, null);
  assert.strictEqual(M.hostView(cfg, { motions: m, release: {}, auto: false }, late).dates[0].state, 'manual');
  d = M.publicView(cfg, { motions: m, release: { '2026-10-21': { at: IST(2026, 10, 1) } }, auto: false }, late);
  assert.strictEqual(d.dates[0].ok, 1, 'an explicit time/Release now still opens the date');
  d = M.publicView(cfg, { motions: m, release: { '2026-10-21': { at: IST(2026, 10, 1), hold: true } }, auto: false }, late);
  assert.strictEqual(d.dates[0].ok, 0);
  assert.strictEqual(M.publicView(cfg, { motions: m, release: {} }, late).dates[0].ok, 1, 'auto defaults to on when unspecified');
});
