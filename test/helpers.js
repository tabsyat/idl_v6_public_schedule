const fs = require('fs'), os = require('os'), path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
function tmpSample() {                     // private copy of the sample CSVs a test may edit
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idl-'));
  for (const f of fs.readdirSync(path.join(root, 'sample/data'))) fs.copyFileSync(path.join(root, 'sample/data', f), path.join(dir, f));
  return dir;
}
function listen(app) { return new Promise(r => { const s = app.listen(0, () => r({ server: s, base: 'http://127.0.0.1:' + s.address().port })); }); }
async function page(url, errors) {
  return JSDOM.fromURL(url, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.fetch = (u, o) => fetch(new URL(u, w.location.href), o); w.addEventListener('error', e => (errors || []).push(e.message)); } });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(40); } return false; }   // fn may be async
async function openTab(dom, tab) {                 // wait for the data, then click a tab (the page now opens on Home)
  const d = dom.window.document, sel = '[data-tab=' + tab + ']';
  const ok = await until(() => d.getElementById('loading').hidden && d.querySelector(sel) && !d.querySelector(sel).hidden);
  if (ok) d.querySelector(sel).click();
  return ok;
}
module.exports = { openTab, root, tmpSample, listen, page, wait, until };
