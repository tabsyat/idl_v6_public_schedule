/**
 * Adjudicator service. Separate from the public site: it holds ADJ_SECRET and reads ballot tokens.
 *   /                      day-by-day room allocation (no tokens, no students)
 *   /?adj=<name>&t=<code>  that adjudicator's debates and ballot buttons
 *   /links/<ADMIN_KEY>     host-only list of every personal link
 */
var path = require('path');
var crypto = require('crypto');
var express = require('express');
var compression = require('compression');
var createSource = require('../shared/source').createSource;
var toCsv = require('../shared/csv').toCsv;
var norm = require('../shared/text').norm;
var tokenLib = require('./lib/token');
var dataLib = require('./lib/data');
var views = require('./lib/views');

var env = process.env;
var PORT = Number(env.PORT) || 3001;
var source = createSource(env);
var csvMode = source.kind === 'csv';

var SECRET = env.ADJ_SECRET;
if (!SECRET) {
  if (!csvMode) { console.error('ADJ_SECRET is required. Set a long random value; changing it invalidates every personal link.'); process.exit(1); }
  SECRET = 'dev-secret'; console.warn('ADJ_SECRET not set: using the dev secret (sample data only).');
}
var BALLOT_BASE = (env.BALLOT_APP_URL || '').trim();
if (!BALLOT_BASE) console.warn('BALLOT_APP_URL is not set: "Open ballot" buttons will say the ballot link is not configured yet.');
var ADMIN_KEY = env.ADMIN_KEY;
if (!ADMIN_KEY) { ADMIN_KEY = crypto.randomBytes(18).toString('base64url'); console.warn('ADMIN_KEY not set. Temporary host links page: /links/' + ADMIN_KEY); }

var store = dataLib.create(source, { cacheSeconds: env.CACHE_SECONDS === undefined || env.CACHE_SECONDS === '' ? 15 : Number(env.CACHE_SECONDS), year: Number(env.EVENT_YEAR) || 2026 });

var app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(function (req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  next();
});
app.use(compression());
app.get('/healthz', function (req, res) { res.type('text').send('ok'); });

function noStore(res) { res.set('Cache-Control', 'no-store'); }
function fail(res, e) { console.error(e); noStore(res); res.status(502).json({ error: 'sheet-unavailable' }); }

app.get('/api/allocation', async function (req, res) {
  noStore(res);
  try { var r = await store.get(); res.json(Object.assign(views.allocation(r.data), { now: Date.now(), builtAt: r.data.at, stale: r.stale })); }
  catch (e) { fail(res, e); }
});

app.get('/api/me', async function (req, res) {
  noStore(res);
  var name = String(req.query.adj || ''), code = String(req.query.t || '');
  if (!name || !tokenLib.verify(SECRET, name, code)) return res.status(403).json({ error: 'invalid-link' });
  try {
    var r = await store.get();
    if (!r.data.names[norm(name)]) return res.status(404).json({ error: 'unknown-adjudicator' });
    var out = views.myDay(r.data, name, String(req.query.date || ''), BALLOT_BASE);
    out.now = Date.now(); out.builtAt = r.data.at; out.stale = r.stale;
    res.json(out);
  } catch (e) { fail(res, e); }
});

// ---- host-only links page
function isKey(k) { var a = Buffer.from(String(k)), b = Buffer.from(ADMIN_KEY); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function guard(req, res, next) { if (!isKey(req.params.key)) return res.status(404).type('text').send('Not found'); noStore(res); next(); }
function baseUrl(req) { return (env.BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, ''); }
app.get('/links/:key', guard, function (req, res) { res.sendFile(path.join(__dirname, 'static', 'links.html')); });
app.get('/links/:key/data', guard, async function (req, res) {
  try {
    var r = await store.get(), list = views.links(r.data, SECRET, baseUrl(req)), warnings = [];
    if (!BALLOT_BASE) warnings.push('BALLOT_APP_URL is not set, so ballot buttons are disabled.');
    if (!list.length) warnings.push('No adjudicator names found. Fill Adj_Grid first.');
    var noTok = r.data.debates.filter(function (d) { return !d.walkover && !d.token; }).length;
    if (noTok) warnings.push(noTok + ' debate(s) have no token yet, so their ballot button says "Ballot not ready".');
    var blank = r.data.debates.filter(function (d) { return !views.effectiveAdjs(r.data, d).length; }).length;
    if (blank) warnings.push(blank + ' debate(s) have no adjudicator (blank in Debates and no name in Adj_Grid for that room and day).');
    res.json({ links: list, warnings: warnings, builtAt: r.data.at });
  } catch (e) { fail(res, e); }
});
app.get('/links/:key/links.csv', guard, async function (req, res) {
  try {
    var r = await store.get(), list = views.links(r.data, SECRET, baseUrl(req));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="adjudicator-links.csv"' });
    res.send(toCsv([['name', 'link']].concat(list.map(function (l) { return [l.name, l.url]; }))));
  } catch (e) { fail(res, e); }
});

app.get('/', function (req, res, next) {
  res.sendFile(path.join(__dirname, 'static', req.query.adj ? 'me.html' : 'index.html'), function (e) { if (e) next(e); });
});
app.get('/shared/time.js', function (req, res) { res.sendFile(path.join(__dirname, '..', 'shared', 'time.js')); });
app.use(express.static(path.join(__dirname, 'static'), { index: false }));
app.use(function (req, res) { res.status(404).type('text').send('Not found'); });

if (require.main === module) {
  app.listen(PORT, function () {
    console.log('Adjudicator service on :' + PORT + '  source=' + source.kind + '  links page: /links/' + ADMIN_KEY);
    store.get().catch(function () { /* logged */ });
  });
}
module.exports = { app: app };
