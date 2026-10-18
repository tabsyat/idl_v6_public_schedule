const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'k3y', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cl-')), DEFAULT_SLOTS_VISIBLE: 'true', DEFAULT_PAIRINGS_VISIBLE: 'true' });
const pub = require('../public/server');
let base, server; const errors = [];
test.before(async () => { await pub.refresh(); ({ server, base } = await H.listen(pub.app)); });
test.after(() => server.close());
const open = async (q) => { const dom = await H.page(base + q, errors); return dom; };
const txt = (d, sel) => d.querySelector(sel).textContent.replace(/\s+/g, ' ');
const type = (dom, val) => { const q = dom.window.document.getElementById('q'); q.value = val; q.dispatchEvent(new dom.window.Event('input')); };

test('student finds their live room by name (3:45 PM, 21 Oct)', async () => {
  const dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;
  assert.ok(await H.openTab(dom, 'find'));
  type(dom, 'mutala');
  assert.match(txt(d, '#card'), /Now: R1.*Room 1/);
  assert.match(txt(d, '#card'), /R2.*Sat 24 Oct.*R3.*Opponent and room will be announced during attendance of that round/);
  dom.window.close();
});
test('search by ID; same-name students are listed separately with IDs', async () => {
  const dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;
  await H.openTab(dom, 'find');
  type(dom, 'j-ap-01'); assert.match(txt(d, '#card'), /Mutala Naga Varchasvi/);
  type(dom, 'saanvi sharma'); const r = txt(d, '#results'); assert.ok((r.match(/Saanvi Sharma/g) || []).length === 2); assert.match(r, /S-\w\w-\d\d/);
  dom.window.close();
});
test('unplaced round shows "Slot to be confirmed"', async () => {
  const dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;
  await H.openTab(dom, 'find');
  type(dom, 'J-HR-47'); assert.match(txt(d, '#card'), /Slot to be confirmed/);
  dom.window.close();
});
test('hidden sides show no Prop/Opp anywhere; revealed sides do', async () => {
  const dom = await open('/?now=2026-10-22T15:45'), d = dom.window.document;
  await H.openTab(dom, 'find');
  d.querySelector('[data-tab=browse]').click();
  assert.ok(txt(d, '#bOut').includes('30 of 30 rooms paired'));
  assert.strictEqual(d.querySelectorAll('#bOut .badge').length, 0, 'hidden-sides block must carry no side hints');
  d.getElementById('bBlock').value = d.getElementById('bBlock').options[d.getElementById('bBlock').options.length > 1 ? 1 : 0].value;
  d.getElementById('bBlock').dispatchEvent(new dom.window.Event('change'));
  assert.ok(d.querySelectorAll('#bOut .badge.p').length > 0, '4:30 block was revealed in the sample');
  dom.window.close();
});
test('projector mode: big grid of the live section, 12 rooms per page', async () => {
  const dom = await open('/?mode=projector&now=2026-10-21T15:45'), d = dom.window.document;
  assert.ok(await H.until(() => d.querySelectorAll('.p-cell').length > 0));
  assert.strictEqual(d.querySelectorAll('.p-cell').length, 12);
  assert.match(txt(d, '#pSub'), /Live now/); assert.match(txt(d, '#pFoot'), /Page 1 of 3/);
  dom.window.close();
});
test('switching the schedule off shows the holding message', async () => {
  await fetch(base + '/host/k3y/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: false }) });
  const dom = await open('/'), d = dom.window.document;
  assert.ok(await H.until(() => /released soon/.test(d.getElementById('loading').textContent)));
  const vis = [...d.querySelectorAll('#tabs button')].filter(b => !b.hidden).map(b => b.textContent);
  assert.deepStrictEqual(vis, ['Motions'], 'only Motions stays reachable while the schedule is held back');
  dom.window.close();
  await fetch(base + '/host/k3y/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: true }) });
});
test('no script errors', () => assert.deepStrictEqual(errors, []));

const sw = body => fetch(base + '/host/k3y/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('card: own side is a badge under the round label, only for rounds the host revealed (no opponent badge, no sentence)', async () => {
  await sw({ sidesAuto: false, sidesAll: { r1: true, r2: false, r3: false } });
  let dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;
  await H.openTab(dom, 'find');
  type(dom, 'J-KA-05');
  const card = d.getElementById('card');
  assert.ok(card.querySelector('.round .rn .badge'), 'own side badge under R1');
  assert.strictEqual(card.querySelectorAll('.round .detail .badge').length, 0, 'no opponent side badge');
  assert.ok(!/You speak/.test(card.textContent));
  assert.strictEqual(card.querySelectorAll('.round .rn .badge').length, 1, 'only R1 was revealed');
  dom.window.close();
  await sw({ sidesAll: { r2: true } });                       // R2 is still only a planned slot: its Roster side now shows too
  dom = await open('/?now=2026-10-21T15:45'); d = dom.window.document;
  await H.openTab(dom, 'find');
  type(dom, 'J-KA-05');
  const rows = [...d.querySelectorAll('#card .round')];
  assert.strictEqual(rows.filter(r => r.querySelector('.rn .badge')).length, 2);
  assert.ok(rows[1].querySelector('.rn .badge') && /announced during attendance/.test(rows[1].textContent), 'unpaired R2 shows the Roster side');
  assert.ok(!rows[2].querySelector('.rn .badge'), 'R3 not revealed');
  dom.window.close();
});
test('no Room finder tab', async () => {
  const dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;
  await H.openTab(dom, 'find');
  assert.ok(!d.querySelector('[data-tab=room]') && !d.getElementById('v-room'));
  dom.window.close();
});
test('tabs: Motions is always second (Schedule list off here: Find me, Motions, All rooms)', async () => {
  const dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;
  await H.openTab(dom, 'find');
  assert.deepStrictEqual([...d.querySelectorAll('#tabs button')].filter(b => !b.hidden).map(b => b.textContent), ['Find me', 'Motions', 'All rooms']);
  dom.window.close();
});
