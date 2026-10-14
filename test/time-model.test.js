const test = require('node:test'), assert = require('node:assert');
const T = require('../shared/time'), M = require('../shared/model'), { parseCsv } = require('../shared/csv');

test('block parsing and section count', () => {
  assert.deepStrictEqual(T.parseBlock('3:30 PM - 4:30 PM'), { label: '3:30 PM - 4:30 PM', start: 930, end: 990, sections: 3 });
  assert.strictEqual(T.parseBlock('5:30 PM - 6:00 PM').sections, 1);          // the 30-minute block has only section 1
  assert.strictEqual(T.parseBlock('12:30 PM - 1:30 PM').start, 750);          // 12:30 PM is noon, not midnight
  assert.strictEqual(T.parseBlock('10:30 AM \u2013 11:30 AM').sections, 3);    // en dash tolerated
  assert.strictEqual(T.parseBlock('nonsense'), null);
});
test('section start = block start + (section-1) x 20 min, in IST', () => {
  const ms = T.sectionStartMs('2026-10-21', 930, 3);                          // 3:30 PM block, section 3 = 4:10 PM
  assert.strictEqual(T.istClock(ms), '16:10');
  assert.strictEqual(T.istIso(ms), '2026-10-21');
  assert.strictEqual(T.sectionEndMs('2026-10-21', 930, 3) - ms, 20 * 60000);
  assert.strictEqual(T.range(970, 990), '4:10 \u2013 4:30 PM');
  assert.strictEqual(T.range(1070, 1090), '5:50 \u2013 6:10 PM');             // crosses noon-style am/pm boundary
});
test('dates: with and without year, ISO', () => {
  assert.strictEqual(T.parseDate('21 Oct 2026'), '2026-10-21');
  assert.strictEqual(T.parseDate('21 Oct'), '2026-10-21');
  assert.strictEqual(T.parseDate('UNPLACED'), null);
  assert.strictEqual(T.dayLabel('2026-10-24'), 'Sat 24 Oct');
});
test('Adj_Grid: several names in one cell are split', () => {
  const rows = parseCsv('Room,21 Oct 2026,22 Oct 2026\n1,"A One, B Two",C Three\n2,,"D Four;E Five"\n');
  const g = M.parseAdjGrid(rows, 2026);
  assert.deepStrictEqual(g.grid['2026-10-21'][1], ['A One', 'B Two']);
  assert.deepStrictEqual(g.grid['2026-10-22'][2], ['D Four', 'E Five']);
  assert.strictEqual(g.grid['2026-10-21'][2], undefined);
});
test('Debates: DISSOLVED and unknown statuses are ignored, bad rows are reported', () => {
  const base = { category: 'Junior', date: '21 Oct 2026', block: '3:30 PM - 4:30 PM', section: '1', room: '1', prop_id: 'A', prop_name: 'A', opp_id: 'B', opp_name: 'B', round: 'R1', sides_visible: 'TRUE' };
  const r = M.parseDebates([{ ...base, status: 'ACTIVE' }, { ...base, status: 'DISSOLVED' }, { ...base, status: 'WALKOVER', absent_id: 'B' }, { ...base, status: 'ACTIVE', room: 'x' }], {});
  assert.strictEqual(r.debates.length, 2); assert.strictEqual(r.dropped, 1); assert.strictEqual(r.bad, 1);
  assert.strictEqual(r.debates[1].walkover, true);
});
