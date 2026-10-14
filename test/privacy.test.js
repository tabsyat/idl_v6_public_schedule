const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { root } = require('./helpers');
const { createSource, googleSource } = require('../shared/source');
const M = require('../shared/model'), snapshotLib = require('../public/lib/snapshot');

async function buildSample(showState) {
  const src = createSource({ SOURCE: 'csv', SAMPLE_DIR: path.join(root, 'sample/data') });
  const ps = M.parseStudents(await src.table('Roster'), { year: 2026 });
  const pd = M.parseDebates(await src.table('Debates', { columns: M.DEBATE_PUBLIC_COLUMNS, optional: M.DEBATE_PUBLIC_OPTIONAL }), { year: 2026 });
  const cfg = M.parseConfig(await src.raw('Config'), 2026);
  return { built: snapshotLib.build({ students: ps.students, debates: pd.debates, config: cfg, showState }), pd };
}

test('public snapshot never contains token, adjudicator, debate id or key', async () => {
  const { built } = await buildSample(false);
  const json = JSON.stringify(built.snapshot);
  const raw = fs.readFileSync(path.join(root, 'sample/data/Debates.csv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split(','));
  for (const row of raw) { assert.ok(!json.includes(row[11]), 'token ' + row[11] + ' leaked'); assert.ok(!json.includes('"' + row[0] + '"'), 'debate id leaked'); }
  assert.ok(!/Sample Adjudicator/.test(json));
  assert.ok(!/"(token|adjudicator|debate_id|key|time_made)"/.test(json));
  const allowed = new Set(['d', 'b', 's', 'r', 'n', 'm', 'sv', 'w', 'ab']);
  built.snapshot.debates.forEach(d => Object.keys(d).forEach(k => assert.ok(allowed.has(k), 'unexpected field ' + k)));
  assert.ok(!json.includes('"st"'), 'state must be absent unless SHOW_STATE=true');
});

test('hidden sides: alphabetical order, no side flag; revealed: Prop first', async () => {
  const { built, pd } = await buildSample(false);
  const names = {}; built.snapshot.students.forEach(s => names[s.i] = s.n.toLowerCase());
  let hidden = 0, shown = 0;
  built.snapshot.debates.forEach(d => {
    if (d.sv === 0) { hidden++; assert.ok(names[d.m[0]] <= names[d.m[1]], 'not alphabetical: ' + d.m); }
    else shown++;
  });
  assert.ok(hidden > 50 && shown > 50, 'sample should contain both kinds');
  // revealed debates really are [Prop, Opp] from the sheet
  const first = pd.debates.find(x => x.sidesVisible);
  const out = built.snapshot.debates.find(x => x.sv === 1 && x.m[0] === first.propId && x.m[1] === first.oppId);
  assert.ok(out);
  // hidden sides must not depend on who was Prop: alphabetical even when Prop sorts last
  const h = pd.debates.filter(x => !x.sidesVisible).find(x => x.propName.toLowerCase() > x.oppName.toLowerCase());
  assert.ok(h, 'need a hidden debate where Prop sorts after Opp');
  const o2 = built.snapshot.debates.find(x => x.sv === 0 && x.m.includes(h.propId) && x.m.includes(h.oppId) && x.d === h.date && x.r === h.room);
  assert.strictEqual(o2.m[0], h.oppId);
});

test('walkover is flagged with the absent id; dissolved debates are gone', async () => {
  const { built, pd } = await buildSample(false);
  assert.strictEqual(built.snapshot.debates.filter(d => d.w).length, 2);
  built.snapshot.debates.filter(d => d.w).forEach(d => assert.ok(d.m.includes(d.ab)));
  assert.strictEqual(built.snapshot.debates.length, pd.debates.length);
});

test('Google source: public reader asks only for whitelisted columns (token column never requested)', async () => {
  const header = ['debate_id', 'category', 'date', 'block', 'section', 'room', 'prop_id', 'prop_name', 'opp_id', 'opp_name', 'round', 'token', 'adjudicator', 'status', 'sides_visible', 'key', 'absent_id', 'time_made'];
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(decodeURIComponent(url));
    const u = decodeURIComponent(url);
    if (/values\/'Debates'!1:1/.test(u)) return { ok: true, json: async () => ({ values: [header] }) };
    const ranges = [...u.matchAll(/ranges='Debates'!([A-Z]+):/g)].map(m => m[1]);
    return { ok: true, json: async () => ({ valueRanges: ranges.map(() => ({ values: [['hdr', 'v1', 'v2']] })) }) };
  };
  const src = googleSource({ SHEET_ID: 'x', GOOGLE_CREDENTIALS: JSON.stringify({ client_email: 'a@b', private_key: 'k' }) }, { getToken: async () => 't', fetch: fakeFetch });
  const rows = await src.table('Debates', { columns: M.DEBATE_PUBLIC_COLUMNS, optional: M.DEBATE_PUBLIC_OPTIONAL });
  const asked = urls.join(' ');
  assert.ok(!/!L:L/.test(asked), 'token column (L) was requested');
  assert.ok(!/!M:M/.test(asked), 'adjudicator column (M) was requested');
  assert.ok(!/!A:A/.test(asked) && !/!P:P/.test(asked) && !/!R:R/.test(asked), 'debate_id / key / time_made requested');
  assert.strictEqual(rows.length, 2);
  assert.ok(!('token' in rows[0]) && !('adjudicator' in rows[0]));
});

test('Google source: missing required column gives a clear error', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ values: [['debate_id', 'room']] }) });
  const src = googleSource({ SHEET_ID: 'x', GOOGLE_CREDENTIALS: JSON.stringify({ client_email: 'a@b', private_key: 'k' }) }, { getToken: async () => 't', fetch: fakeFetch });
  await assert.rejects(() => src.table('Debates', { columns: ['date'] }), /Missing column "date"/);
});
