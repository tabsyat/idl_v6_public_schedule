const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'uk', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ui-')), DEFAULT_SLOTS_VISIBLE: 'true', DEFAULT_ROSTER_VISIBLE: 'true' });
const pub = require('../public/server');
let base, server; const errors = [];
test.before(async () => { await pub.refresh(); ({ server, base } = await H.listen(pub.app)); });
test.after(() => server.close());
const txt = (d, sel) => d.querySelector(sel).textContent.replace(/\s+/g, ' ');
const type = (dom, id, val) => { const q = dom.window.document.getElementById(id); q.value = val; q.dispatchEvent(new dom.window.Event('input')); };
const open = async (q = '/') => { const dom = await H.page(base + q, errors); await H.until(() => dom.window.document.getElementById('loading').hidden); return dom; };

test('title reads "IDL 6.0 Round 1"; the page opens on Home, which has no tab of its own', async () => {
  const dom = await open(), d = dom.window.document;
  assert.strictEqual(d.title, 'IDL 6.0 Round 1');
  assert.strictEqual(d.querySelector('.bar h1').textContent, 'IDL 6.0 Round 1');
  assert.ok(!d.getElementById('v-home').hidden);
  ['roster', 'find', 'browse', 'motions'].forEach(n => assert.ok(d.getElementById('v-' + n).hidden, n + ' hidden on Home'));
  assert.ok([...d.querySelectorAll('#tabs button')].every(b => b.getAttribute('aria-selected') === 'false'));
  assert.ok(![...d.querySelectorAll('#tabs button')].some(b => b.dataset.tab === 'home'), 'no Home tab');
  assert.match(txt(d, '#v-home'), /Welcome to IDL 6.0 Round 1/);
  assert.deepStrictEqual([...d.querySelectorAll('#homeLinks button')].map(b => b.dataset.go), ['roster', 'motions', 'find', 'browse'], 'Motions is second on Home');
  assert.deepStrictEqual([...d.querySelectorAll('#tabs button')].filter(b => !b.hidden).map(b => b.dataset.tab), ['roster', 'motions', 'find', 'browse'], 'and second in the ribbon');
  dom.window.close();
});
test('Home buttons open the tab; clicking the title returns to Home from anywhere', async () => {
  const dom = await open(), d = dom.window.document;
  d.querySelector('#homeLinks [data-go=find]').click();
  assert.ok(!d.getElementById('v-find').hidden && d.getElementById('v-home').hidden);
  assert.strictEqual(d.querySelector('[data-tab=find]').getAttribute('aria-selected'), 'true');
  d.getElementById('homeLink').click();
  assert.ok(!d.getElementById('v-home').hidden && d.getElementById('v-find').hidden);
  assert.ok([...d.querySelectorAll('#tabs button')].every(b => b.getAttribute('aria-selected') === 'false'));
  d.querySelector('#homeLinks [data-go=browse]').click(); assert.ok(!d.getElementById('v-browse').hidden);
  d.getElementById('homeLink').click(); assert.ok(!d.getElementById('v-home').hidden);
  dom.window.close();
});
test('a student link (#ID) still opens straight on the card', async () => {
  const dom = await open('/#J-AP-01'), d = dom.window.document;
  assert.ok(await H.until(() => /Mutala/.test(d.getElementById('card').textContent)));
  assert.ok(!d.getElementById('v-find').hidden); dom.window.close();
});
test('Back to search clears the name and shows the empty search page', async () => {
  const dom = await open(), d = dom.window.document;
  d.querySelector('[data-tab=find]').click(); type(dom, 'q', 'mutala');
  assert.match(txt(d, '#card'), /Mutala/); assert.ok(d.getElementById('results').hidden);
  d.getElementById('backBtn').click();
  assert.strictEqual(d.getElementById('q').value, '', 'search box emptied');
  assert.strictEqual(d.getElementById('card').textContent, '', 'card gone');
  assert.match(txt(d, '#results'), /Type at least 2 letters of your name, or your student ID/);
  assert.ok(!d.getElementById('v-find').hidden, 'stays on Find me');
  assert.strictEqual(dom.window.location.hash, '');
  type(dom, 'q', 'mutala'); assert.match(txt(d, '#card'), /Mutala/, 'searching again works');
  dom.window.close();
});
test('Back to search also works for a card opened from the Schedule tab or an opponent link', async () => {
  const dom = await open('/?now=2026-10-21T15:55'), d = dom.window.document;
  d.querySelector('[data-tab=roster]').click(); type(dom, 'rq', 'J-AP-01');
  d.querySelector('#rOut .rn1 button').click();
  assert.ok(!d.getElementById('v-find').hidden); assert.match(txt(d, '#card'), /Mutala/);
  d.querySelector('#card .detail .opp-link').click();                   // jump to the opponent's card
  assert.notStrictEqual(d.querySelector('#card .who-h').textContent, 'Mutala Naga Varchasvi', 'now on the opponent\'s card');
  d.getElementById('backBtn').click();
  assert.strictEqual(d.getElementById('q').value, ''); assert.match(txt(d, '#results'), /Type at least 2 letters/);
  dom.window.close();
});
test('Schedule: Clear all resets category, state, filter text and sort', async () => {
  const dom = await open(), d = dom.window.document;
  d.querySelector('[data-tab=roster]').click();
  assert.ok(await H.until(() => d.querySelectorAll('#rOut tbody tr').length > 0));
  const total = d.getElementById('rCount').textContent.match(/of (\d+) students/)[1];
  const set = (id, v) => { const e = d.getElementById(id); e.value = v; e.dispatchEvent(new dom.window.Event('change')); };
  set('rCat', 'Junior'); set('rState', [...d.getElementById('rState').options][1].value); set('rSort', 'id'); type(dom, 'rq', 'a');
  assert.notStrictEqual(d.getElementById('rCount').textContent.match(/^(\d+)/)[1], total);
  assert.ok(!d.getElementById('rClear').hidden, 'button is visible');
  d.getElementById('rClear').click();
  assert.strictEqual(d.getElementById('rq').value, ''); assert.strictEqual(d.getElementById('rCat').value, '');
  assert.strictEqual(d.getElementById('rState').value, ''); assert.strictEqual(d.getElementById('rSort').value, 'name');
  assert.strictEqual(d.getElementById('rCount').textContent.match(/^(\d+)/)[1], total, 'whole list is back');
  dom.window.close();
});
test('the projector link is gone from All rooms', async () => {
  const dom = await open(), d = dom.window.document;
  d.querySelector('[data-tab=browse]').click();
  assert.ok(!d.getElementById('projLink')); assert.doesNotMatch(d.getElementById('v-browse').textContent, /projector/i);
  dom.window.close();
});
test('Motions stays second when the Schedule list is switched off (Find me, Motions, All rooms)', async () => {
  const sw = b => fetch(base + '/host/uk/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  await sw({ roster: false });
  const dom = await open(), d = dom.window.document;
  assert.deepStrictEqual([...d.querySelectorAll('#tabs button')].filter(b => !b.hidden).map(b => b.dataset.tab), ['find', 'motions', 'browse']);
  assert.deepStrictEqual([...d.querySelectorAll('#homeLinks button')].map(b => b.dataset.go), ['find', 'motions', 'browse']);
  dom.window.close(); await sw({ roster: true });
});
test('side badges say "Prop (for)" and "Opp (Against)" everywhere', async () => {
  await fetch(base + '/host/uk/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sidesAll: { r1: true, r2: true, r3: true } }) });
  const dom = await open('/?now=2026-10-21T15:45'), d = dom.window.document;     // section 1 of the 3:30 block is the one with Junior pairings
  const labels = sel => [...new Set([...d.querySelectorAll(sel)].map(b => b.textContent))].sort();
  d.querySelector('[data-tab=browse]').click();                                   // All rooms, Junior debates with revealed sides
  assert.deepStrictEqual(labels('#bOut .badge:not(.x)'), ['Opp (Against)', 'Prop (for)']);
  assert.ok(![...d.querySelectorAll('#bOut .badge')].some(b => b.textContent === 'Prop' || b.textContent === 'Opp'), 'no bare Prop/Opp left');
  d.querySelector('[data-tab=find]').click(); type(dom, 'q', 'J-AP-01');          // student card: own side under the round label
  assert.deepStrictEqual(labels('#card .rn .badge'), ['Opp (Against)', 'Prop (for)']);
  d.querySelector('[data-tab=roster]').click(); type(dom, 'rq', 'J-AP-01');       // Schedule list
  assert.ok([...d.querySelectorAll('#rOut td.rc .badge')].every(b => /^(Prop \(for\)|Opp \(Against\))$/.test(b.textContent)));
  dom.window.close();
});
test('Schedule on phones: cells carry the labels the card layout uses, and the phone rules exist', async () => {
  const dom = await open(), d = dom.window.document;
  d.querySelector('[data-tab=roster]').click();
  assert.ok(await H.until(() => d.querySelectorAll('#rOut tbody tr').length > 0));
  const row = d.querySelector('#rOut tbody tr');
  assert.deepStrictEqual([...row.querySelectorAll('td.rc')].map(td => td.getAttribute('data-label')), ['R1', 'R2', 'R3']);
  assert.ok(row.querySelector('td.rid') && row.querySelector('td.rst') && row.querySelector('td.rn1'));
  const css = fs.readFileSync(path.join(__dirname, '../public/static/app.css'), 'utf8');
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.tbl\.rost tr \{ display: flex/);
  assert.match(css, /td\.rc::before \{ content: attr\(data-label\)/);
  dom.window.close();
});
test('no script errors', () => assert.deepStrictEqual(errors, []));
