/**
 * Public service: students, parents and hosts. Read-only; holds NO ballot tokens and NO adjudicator data.
 * Sheet is read only when the host presses "Refresh" on the private host page (or at startup).
 */
var path = require('path');
var crypto = require('crypto');
var zlib = require('zlib');
var express = require('express');
var compression = require('compression');
var createSource = require('../shared/source').createSource;
var M = require('../shared/model');
var snapshotLib = require('./lib/snapshot');
var createStore = require('./lib/store').createStore;
var motionsLib = require('./lib/motions');
var sidesLib = require('./lib/sides');
var T = require('../shared/time');

var env = process.env;
var YEAR = Number(env.EVENT_YEAR) || 2026;
var SLOT_TAB = env.SLOT_TAB || 'Roster';
var SHOW_STATE = String(env.SHOW_STATE || 'false').toLowerCase() === 'true';
var PORT = Number(env.PORT) || 3000;
var isTrue = function (v) { return String(v || '').toLowerCase() === 'true'; };

var source = createSource(env);
var store = createStore(env.DATA_DIR || path.join(__dirname, '..', 'data'), {
  slots: isTrue(env.DEFAULT_SLOTS_VISIBLE), pairings: env.DEFAULT_PAIRINGS_VISIBLE == null ? true : isTrue(env.DEFAULT_PAIRINGS_VISIBLE),
  roster: isTrue(env.DEFAULT_ROSTER_VISIBLE), school: isTrue(env.DEFAULT_SCHOOL_VISIBLE),
  sidesAuto: env.DEFAULT_SIDES_AUTO == null ? true : isTrue(env.DEFAULT_SIDES_AUTO), sidesAll: isTrue(env.DEFAULT_SIDES_VISIBLE),
  motionsAuto: env.DEFAULT_MOTIONS_AUTO == null ? true : isTrue(env.DEFAULT_MOTIONS_AUTO)
});

var SCFG = sidesLib.config(env);                  // Junior sides: shown 3 days before each student's round (SIDE_LEAD_DAYS)
var clock = function () { return Date.now(); };   // tests can replace it (setClock)
var MCFG = motionsLib.config(env, YEAR);          // dates 21-31 Oct, released 3 days ahead at 00:00 IST

var ADMIN_KEY = env.ADMIN_KEY;
if (!ADMIN_KEY) {
  ADMIN_KEY = crypto.randomBytes(18).toString('base64url');
  console.warn('ADMIN_KEY is not set. Using a temporary one (changes on every restart): /host/' + ADMIN_KEY);
}

// ---------------------------------------------------------------- data
var current = null;          // { v, builtAt, snapshot, stats, warnings }
var lastError = null;        // { at, message }
var version = 0;
var inflight = null;
function bump() { version = Math.max(version + 1, Date.now()); return version; }

function refresh() {
  if (inflight) return inflight;
  inflight = (async function () {
    try {
      var studentCols = ['student_id', 'name', 'category', 'R1 date', 'R1 slot', 'R2 date', 'R2 slot', 'R3 date', 'R3 slot'];
      var res = await Promise.all([
        source.table(SLOT_TAB, { columns: studentCols, optional: ['state', 'school', 'side_R1', 'side_R2', 'side_R3', 'R1 batch', 'R2 batch', 'R3 batch'] }),
        source.table('Debates', { columns: M.DEBATE_PUBLIC_COLUMNS, optional: M.DEBATE_PUBLIC_OPTIONAL }),
        source.raw('Config').catch(function () { return []; })
      ]);
      var ps = M.parseStudents(res[0], { year: YEAR });
      var pd = M.parseDebates(res[1], { year: YEAR });
      var cfg = M.parseConfig(res[2], YEAR);
      var built = snapshotLib.build({ students: ps.students, debates: pd.debates, config: cfg, showState: true });
      var warnings = pd.warnings.concat(built.warnings);
      if (ps.ignoredSides) warnings.push(ps.ignoredSides + ' Middle/Senior student(s) have side_R cells filled; they are ignored (only Junior sides are used).');
      if (ps.juniors && !ps.juniorsWithSides) warnings.push('No Junior has a side in the Roster (side_R1..R3 empty or missing in tab "' + SLOT_TAB + '"). Junior sides can only come from Debates.');
      if (!res[2].length) warnings.push('Config tab not readable: block list was taken from the slot plan and debates.');
      if (!ps.students.length) throw new Error('Tab "' + SLOT_TAB + '" has no students. Check SLOT_TAB.');
      // state is held privately; payload() only sends it while the Roster switch (or SHOW_STATE) is on
      built.snapshot.studentsNoState = built.snapshot.students.map(function (s) { var o = {}; Object.keys(s).forEach(function (k) { if (k !== 'st') o[k] = s[k]; }); return o; });
      current = { v: bump(), builtAt: Date.now(), snapshot: built.snapshot, stats: built.stats, warnings: warnings,
        instants: sidesLib.instants(SCFG, built.snapshot.releaseDates) };
      lastError = null;
      memo = { v: -1 };
      console.log('Refreshed: ' + built.stats.students + ' students, ' + built.stats.debates + ' debates.');
    } catch (e) {
      lastError = { at: Date.now(), message: String(e && e.message || e) };
      console.error('Refresh failed:', lastError.message);
      throw e;
    } finally { inflight = null; }
  })();
  return inflight;
}

// serialized public payload for the current (data version, switches); recomputed only when something changed
var memo = { v: -1 };
function payload() {
  var sw = store.get();
  if (!current) return null;
  var now = clock(), reached = 0;
  current.instants.forEach(function (t) { if (t <= now) reached++; });      // Junior sides can open by themselves at these moments
  var base = Math.max(current.v, switchRev), v = base + '.' + reached;
  var key = v + ':' + (sw.slots ? 1 : 0) + (sw.pairings ? 1 : 0) + (sw.roster ? 1 : 0) + (sw.school ? 1 : 0) + (sw.sidesAuto ? 1 : 0) + (sw.sidesAll.r1 ? 1 : 0) + (sw.sidesAll.r2 ? 1 : 0) + (sw.sidesAll.r3 ? 1 : 0);
  if (memo.key === key) return memo;
  var obj;
  if (!sw.slots) obj = { v: v, enabled: false, builtAt: current.builtAt };
  else {
    var withState = sw.roster || SHOW_STATE, reveal = sidesLib.revealer(SCFG, { auto: sw.sidesAuto, all: sw.sidesAll }, now);
    obj = { v: v, enabled: true, pairings: sw.pairings, roster: sw.roster, builtAt: current.builtAt, showState: withState,
      cfg: current.snapshot.cfg,
      schools: sw.school ? current.snapshot.schools : undefined,
      students: snapshotLib.exportStudents(withState ? current.snapshot.students : current.snapshot.studentsNoState, reveal, { school: sw.school }),
      debates: sw.pairings ? snapshotLib.exportDebates(current.snapshot.debates, reveal) : [] };
  }
  memo = { key: key, v: v, enabled: sw.slots, pairings: sw.pairings, roster: sw.roster, json: JSON.stringify(obj) };
  return memo;
}
var switchRev = 0;

// ---------------------------------------------------------------- web
var app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(function (req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  });
  next();
});
app.use(compression());

app.get('/healthz', function (req, res) { res.type('text').send('ok'); });

app.get('/api/v', function (req, res) {
  res.set('Cache-Control', 'no-store');
  var p = payload();
  if (!p) return res.status(503).json({ error: 'not-ready', now: Date.now() });
  res.json({ v: p.v, enabled: p.enabled, pairings: p.pairings, roster: p.roster, builtAt: current.builtAt, now: Date.now() });
});

app.get('/api/snapshot', function (req, res) {
  var p = payload();
  if (!p) return res.status(503).json({ error: 'not-ready' });
  res.set({ 'Cache-Control': 'no-cache', 'ETag': 'W/"' + p.key + '"', 'Vary': 'Accept-Encoding' });
  if (req.fresh) return res.status(304).end();
  // compress ONCE per version and reuse it: 700 phones opening the page together cost one gzip, not 700
  if (req.acceptsEncodings('gzip')) {
    if (!p.gz) p.gz = zlib.gzipSync(p.json, { level: 6 });
    res.set('Content-Encoding', 'gzip');
    return res.type('json').send(p.gz);
  }
  res.type('json').send(p.json);
});

function motionData() { return Object.assign({}, store.getData(), { auto: store.get().motionsAuto }); }
// ---- Motions: the server decides what is released, on every request. Unreleased text is never sent.
app.get('/api/motions', function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(motionsLib.publicView(MCFG, motionData(), Date.now()));
});

// ---- host page (private, unguessable URL; no password by design)
function isHostKey(k) {
  var a = Buffer.from(String(k)), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function guard(req, res, next) {
  if (!isHostKey(req.params.key)) return res.status(404).type('text').send('Not found');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  next();
}
function status() {
  var sw = store.get();
  return {
    slots: sw.slots, pairings: sw.pairings, roster: sw.roster, school: sw.school, motionsAuto: sw.motionsAuto, sidesAuto: sw.sidesAuto, sidesAll: sw.sidesAll,
    sidesInfo: sidesLib.hostView(SCFG, { auto: sw.sidesAuto, all: sw.sidesAll }, current ? current.snapshot.sideDates : null, clock()), source: source.kind, slotTab: SLOT_TAB, showState: SHOW_STATE,
    refreshing: !!inflight, builtAt: current ? current.builtAt : null, v: current ? current.v : null,
    stats: current ? current.stats : null, warnings: current ? current.warnings.slice(0, 60) : [],
    lastError: lastError, now: Date.now()
  };
}
app.get('/host/:key', guard, function (req, res) { res.sendFile(path.join(__dirname, 'static', 'host.html')); });
app.get('/host/:key/status', guard, function (req, res) { res.json(status()); });
app.post('/host/:key/refresh', guard, async function (req, res) {
  try { await refresh(); res.json(status()); }
  catch (e) { res.status(502).json(Object.assign(status(), { error: String(e.message || e) })); }
});
app.post('/host/:key/switch', guard, express.json({ limit: '1kb' }), function (req, res) {
  var b = req.body || {}, patch = {};
  if (typeof b.slots === 'boolean') patch.slots = b.slots;
  if (typeof b.pairings === 'boolean') patch.pairings = b.pairings;
  if (typeof b.roster === 'boolean') patch.roster = b.roster;
  if (typeof b.school === 'boolean') patch.school = b.school;
  if (typeof b.sidesAuto === 'boolean') patch.sidesAuto = b.sidesAuto;
  if (b.sidesAll && typeof b.sidesAll === 'object') patch.sidesAll = b.sidesAll;
  if (typeof b.motionsAuto === 'boolean') patch.motionsAuto = b.motionsAuto;
  store.set(patch);
  switchRev = bump();
  res.json(status());
});

function motionsHost() { return motionsLib.hostView(MCFG, motionData(), Date.now()); }
app.get('/host/:key/motions', guard, function (req, res) { res.json(motionsHost()); });
app.post('/host/:key/motions', guard, express.json({ limit: '50kb' }), function (req, res) {
  var b = req.body || {};
  if (MCFG.dates.indexOf(b.date) < 0) return res.status(400).json({ error: 'Unknown date.' });
  var r = motionsLib.cleanMotions(b.motions);
  if (r.error) return res.status(400).json({ error: r.error });
  store.setMotions(b.date, r.value);
  res.json(motionsHost());
});
app.post('/host/:key/motions/release', guard, express.json({ limit: '1kb' }), function (req, res) {
  var b = req.body || {};
  if (MCFG.dates.indexOf(b.date) < 0) return res.status(400).json({ error: 'Unknown date.' });
  if (b.action === 'now') store.setRelease(b.date, { at: Date.now(), hold: false });
  else if (b.action === 'hold') store.setRelease(b.date, { hold: true });
  else if (b.action === 'unhold') store.setRelease(b.date, { hold: false });
  else if (b.action === 'default') store.setRelease(b.date, { at: null, hold: false });
  else if (b.action === 'set') {
    if (!motionsLib.validAt(b.at)) return res.status(400).json({ error: 'That release time is not valid.' });
    store.setRelease(b.date, { at: b.at });
  } else return res.status(400).json({ error: 'Unknown action.' });
  res.json(motionsHost());
});

// ---- backup / restore (switches + motions + release overrides)
app.get('/host/:key/backup', guard, function (req, res) {
  var d = store.getData(), now = Date.now();
  var stamp = T.istIso(now).replace(/-/g, '') + '-' + T.istClock(now).replace(':', '');
  var out = { app: 'idl-public', version: 1, exportedAt: now, switches: store.get(), motions: d.motions, release: d.release };
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="idl-backup-' + stamp + '.json"' });
  res.send(JSON.stringify(out, null, 2));
});
app.post('/host/:key/restore', guard, express.json({ limit: '300kb' }), function (req, res) {
  var b = req.body || {};
  if (b.app !== 'idl-public' || b.version !== 1) return res.status(400).json({ error: 'That file is not an IDL backup (or it is from a different version).' });
  var r = motionsLib.cleanBackup(b, MCFG);
  if (r.error) return res.status(400).json({ error: r.error });
  var patch = {}, sw = b.switches || {};
  ['slots', 'pairings', 'roster', 'school', 'motionsAuto', 'sidesAuto'].forEach(function (k) { if (typeof sw[k] === 'boolean') patch[k] = sw[k]; });
  if (sw.sidesAll && typeof sw.sidesAll === 'object') patch.sidesAll = sw.sidesAll;
  else if (typeof sw.sides === 'boolean') patch.sidesAll = { r1: sw.sides, r2: sw.sides, r3: sw.sides };   // backup from the older single switch
  store.set(patch);
  store.replaceData({ motions: r.motions, release: r.release });
  switchRev = bump();
  res.json(Object.assign(status(), { motions: motionsHost() }));
});

app.get('/shared/time.js', function (req, res) { res.sendFile(path.join(__dirname, '..', 'shared', 'time.js')); });
app.use(express.static(path.join(__dirname, 'static'), { index: 'index.html', extensions: ['html'] }));
app.use(function (req, res) { res.status(404).type('text').send('Not found'); });

// ---------------------------------------------------------------- start
if (require.main === module) {
  app.listen(PORT, function () {
    console.log('Public service on :' + PORT + '  source=' + source.kind + '  host page: /host/' + ADMIN_KEY);
    refresh().catch(function () { /* logged; host can retry from the host page */ });
    var every = Number(env.AUTO_REFRESH_SECONDS) || 0;
    if (every > 0) setInterval(function () { refresh().catch(function () {}); }, every * 1000);
  });
}
module.exports = { app: app, refresh: refresh, payload: payload, setClock: function (fn) { clock = fn || function () { return Date.now(); }; memo = { v: -1 }; } };
