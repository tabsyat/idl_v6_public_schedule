const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'hk', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sh-')), DEFAULT_SLOTS_VISIBLE: 'true', DEFAULT_ROSTER_VISIBLE: 'true' });
const pub = require('../public/server');
let base, server; const errors = [];
test.before(async () => { await pub.refresh(); ({ server, base } = await H.listen(pub.app)); });
test.after(() => server.close());
const status = async () => (await fetch(base + '/host/hk/status')).json();
const tick = (dom, id, on) => { const c = dom.window.document.getElementById(id); c.checked = on; c.dispatchEvent(new dom.window.Event('change')); };

test('host page: automatic switch and one checkbox per round, with live counts', async () => {
  const dom = await H.page(base + '/host/hk', errors), d = dom.window.document;
  assert.ok(await H.until(() => d.getElementById('sInfo1').textContent.length > 0));
  assert.match(d.getElementById('sAutoLabel').textContent, /3 days before each student's round day/);
  assert.ok(d.getElementById('swSidesAuto').checked, 'automatic rule is on by default');
  assert.match(d.getElementById('sInfo1').textContent, /Visible to \d+ of 27\d Juniors now/);
  tick(dom, 'swSidesR1', true);
  assert.ok(await H.until(async () => (await status()).sidesAll.r1 === true));
  assert.ok(await H.until(() => /Showing to all 27\d Juniors/.test(d.getElementById('sInfo1').textContent)));
  assert.strictEqual((await status()).sidesAll.r2, false, 'other rounds untouched');
  tick(dom, 'swSidesR1', false); tick(dom, 'swSidesAuto', false);
  assert.ok(await H.until(async () => { const s = await status(); return s.sidesAll.r1 === false && s.sidesAuto === false; }));
  assert.ok(await H.until(() => /Automatic reveal is off/.test(d.getElementById('sInfo1').textContent)));
  assert.ok(!d.getElementById('swSides'), 'the old single "Reveal Junior sides" checkbox is gone');
  dom.window.close();
});
test('Schedule tab and student card show the revealed side; hidden rounds show none', async () => {
  await fetch(base + '/host/hk/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidesAuto: false, sidesAll: { r1: true, r2: false, r3: false } }) });
  const dom = await H.page(base + '/?now=2026-10-21T15:55', errors), d = dom.window.document;
  await H.openTab(dom, 'roster');
  assert.ok(await H.until(() => d.querySelectorAll('#rOut tbody tr').length > 0));
  const q = d.getElementById('rq'); q.value = 'J-AP-01'; q.dispatchEvent(new dom.window.Event('input'));
  const row = [...d.querySelectorAll('#rOut tbody tr')].find(r => /Mutala/.test(r.textContent));
  assert.ok(row, 'Mutala found in the Schedule');
  assert.match(row.children[3].textContent, /speaks\s*Opp/);            // Roster: side_R1 = Opp
  assert.doesNotMatch(row.children[4].textContent + row.children[5].textContent, /speaks/);
  dom.window.close();
});
test('Schedule tab: no opponent side tag, whatever the category (only the student\'s own "speaks" badge)', async () => {
  await fetch(base + '/host/hk/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidesAll: { r1: true, r2: true, r3: true } }) });
  const dom = await H.page(base + '/?now=2026-10-21T15:55', errors), d = dom.window.document;
  await H.openTab(dom, 'roster');
  assert.ok(await H.until(() => d.querySelectorAll('#rOut tbody tr').length > 0));
  const paired = [...d.querySelectorAll('#rOut td.rc')].filter(td => /Room \d+ vs/.test(td.textContent));
  assert.ok(paired.length > 0, 'sample has paired rounds on the first page');
  paired.forEach(td => { assert.ok(td.querySelectorAll('.badge').length <= 1); assert.ok(!td.querySelector('.rrm ~ .badge'), 'badge after the opponent name'); });
  dom.window.close();
});
test('no script errors', () => assert.deepStrictEqual(errors, []));
