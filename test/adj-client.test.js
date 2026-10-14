const test = require('node:test'), assert = require('node:assert');
const H = require('./helpers');
Object.assign(process.env, { SOURCE: 'csv', SAMPLE_DIR: H.tmpSample(), ADMIN_KEY: 'k3y', ADJ_SECRET: 'unit-secret', BALLOT_APP_URL: 'https://ballot.example.invalid/exec', CACHE_SECONDS: '0' });
const tok = require('../adj/lib/token'), { app } = require('../adj/server');
let base, server; const errors = [];
test.before(async () => { ({ server, base } = await H.listen(app)); });
test.after(() => server.close());
const txt = (d, sel) => d.querySelector(sel).textContent.replace(/\s+/g, ' ');
const link = (n, extra) => `${base}/?adj=${encodeURIComponent(n)}&t=${tok.make('unit-secret', n)}${extra || ''}`;

test('personal page: next-up highlight, countdown, ballot buttons', async () => {
  const dom = await H.page(link('Sample Adjudicator 01', '&now=2026-10-21T15:55'), errors), d = dom.window.document;
  assert.ok(await H.until(() => !d.getElementById('app').hidden));
  assert.match(txt(d, '#band'), /Next: starts in 35 minutes.*Room 1/);
  const cls = [...d.querySelectorAll('.deb')].map(x => x.className.replace('deb ', '').trim());
  assert.deepStrictEqual(cls, ['past', 'next', '', '']);
  const hrefs = [...d.querySelectorAll('a.ballot')].map(a => a.href);
  assert.strictEqual(hrefs.length, 4); assert.ok(hrefs.every(h => h.startsWith('https://ballot.example.invalid/exec?debate=D-') && /&t=[0-9a-f]{12}$/.test(h)));
  assert.strictEqual(d.querySelector('a.ballot').rel, 'noopener noreferrer');
  dom.window.close();
});
test('live section is highlighted', async () => {
  const dom = await H.page(link('Sample Adjudicator 01', '&now=2026-10-21T16:35'), errors), d = dom.window.document;
  assert.ok(await H.until(() => !d.getElementById('app').hidden));
  assert.match(txt(d, '#band'), /Now: Round 1.*Room 1/); assert.ok(d.querySelector('.deb.live'));
  dom.window.close();
});
test('wrong code shows the "link not valid" page and no names', async () => {
  const dom = await H.page(`${base}/?adj=Sample%20Adjudicator%2001&t=nope`, errors), d = dom.window.document;
  assert.ok(await H.until(() => /not valid/.test(d.getElementById('loading').textContent)));
  assert.ok(d.getElementById('app').hidden); dom.window.close();
});
test('day-by-day allocation and name search', async () => {
  const dom = await H.page(base + '/', errors), d = dom.window.document;
  assert.ok(await H.until(() => !d.getElementById('app').hidden));
  assert.strictEqual(d.getElementById('days').children.length, 10);
  assert.match(txt(d, '#out'), /30 of 30 rooms have an adjudicator/);
  const q = d.getElementById('q'); q.value = 'adjudicator 07'; q.dispatchEvent(new dom.window.Event('input'));
  assert.match(txt(d, '#out'), /Wed 21 Oct: Room 7.*Fri 30 Oct: Room 4/);
  dom.window.close();
});
test('no script errors', () => assert.deepStrictEqual(errors, []));
