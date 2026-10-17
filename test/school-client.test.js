const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
const H = require('./helpers');
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'sk2', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sc2-')), DEFAULT_SLOTS_VISIBLE: 'true', DEFAULT_ROSTER_VISIBLE: 'true' });
const pub = require('../public/server');
let base, server; const errors = [];
test.before(async () => { await pub.refresh(); ({ server, base } = await H.listen(pub.app)); });
test.after(() => server.close());
const sw = b => fetch(base + '/host/sk2/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const txt = (d, sel) => d.querySelector(sel).textContent.replace(/\s+/g, ' ');
const type = (dom, id, val) => { const q = dom.window.document.getElementById(id); q.value = val; q.dispatchEvent(new dom.window.Event('input')); };

test('School off: no School column, card or search match', async () => {
  await sw({ school: false });
  const dom = await H.page(base + '/', errors), d = dom.window.document;
  await H.openTab(dom, 'roster');
  assert.ok(await H.until(() => d.querySelectorAll('#rOut tbody tr').length > 0));
  assert.deepStrictEqual([...d.querySelectorAll('#rOut thead th')].map(t => t.textContent), ['Name', 'ID', 'State', 'Round 1', 'Round 2', 'Round 3']);
  type(dom, 'rq', 'sample school'); assert.match(txt(d, '#rOut'), /No students match/);
  dom.window.close();
});
test('School on: column after State, filterable by school name', async () => {
  await sw({ school: true });
  const dom = await H.page(base + '/', errors), d = dom.window.document;
  await H.openTab(dom, 'roster');
  assert.ok(await H.until(() => d.querySelectorAll('#rOut tbody tr').length > 0));
  assert.deepStrictEqual([...d.querySelectorAll('#rOut thead th')].map(t => t.textContent), ['Name', 'ID', 'State', 'School', 'Round 1', 'Round 2', 'Round 3']);
  type(dom, 'rq', 'J-AP-01'); const row = d.querySelector('#rOut tbody tr');
  assert.strictEqual(row.children[3].textContent, 'Andhra Pradesh Sample School 3');
  type(dom, 'rq', 'andhra pradesh sample school 3');
  const rows = [...d.querySelectorAll('#rOut tbody tr')];
  assert.ok(rows.length >= 2 && rows.every(r => r.children[3].textContent === 'Andhra Pradesh Sample School 3'));
  dom.window.close();
});
test('School on: Find me card shows the school; search by school lists its students', async () => {
  const dom = await H.page(base + '/', errors), d = dom.window.document;
  await H.openTab(dom, 'find');
  type(dom, 'q', 'J-AP-01');
  assert.strictEqual(d.querySelector('#card .who-school').textContent, 'Andhra Pradesh Sample School 3');
  d.getElementById('backBtn').click();
  type(dom, 'q', 'andhra pradesh sample school 3');
  const res = txt(d, '#results'); assert.match(res, /Mutala Naga Varchasvi/); assert.match(res, /Andhra Pradesh Sample School 3/);
  dom.window.close();
});
test('host page: School checkbox saves the switch', async () => {
  await sw({ school: false });
  const dom = await H.page(base + '/host/sk2', errors), d = dom.window.document;
  assert.ok(await H.until(() => d.getElementById('facts').children.length > 0));
  assert.strictEqual(d.getElementById('swSchool').checked, false);
  const c = d.getElementById('swSchool'); c.checked = true; c.dispatchEvent(new dom.window.Event('change'));
  assert.ok(await H.until(async () => (await (await fetch(base + '/host/sk2/status')).json()).school === true));
  dom.window.close();
});
test('contact button: mailto link at the top, on every tab', async () => {
  const dom = await H.page(base + '/', errors), d = dom.window.document;
  const a = d.getElementById('contactBtn');
  assert.strictEqual(a.getAttribute('href'), 'mailto:idlschedule@indiandebatingleague.com');
  assert.strictEqual(a.textContent, 'Contact us in case of any queries');
  assert.ok(d.querySelector('header').contains(a), 'inside the top header');
  dom.window.close();
});
test('no script errors', () => assert.deepStrictEqual(errors, []));
