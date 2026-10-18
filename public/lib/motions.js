/**
 * motions.js - release rules for the Motions tab (pure functions, no I/O).
 *
 * Each competition date has up to 3 motions (Junior, Middle, Senior) typed in on the host page.
 * A date is released at 00:00 IST, LEAD days before it (default 3: 21 Oct opens on 18 Oct 00:00 IST),
 * unless the host overrides the time ("at"), releases it now, or holds it ("hold").
 * The default rule is OPTIONAL: data.auto (host switch) turns it on or off. With it off, a date opens only when the host
 * releases it ("Release now") or sets an explicit time for it.
 * The SERVER decides what is released, every time it is asked: unreleased motion text is never sent to browsers.
 */
var T = require('../../shared/time');

var CATS = ['Junior', 'Middle', 'Senior'];
var IST_MS = 330 * 60000;
var MAX_LEN = 1500;
var MIN_AT = Date.UTC(2020, 0, 1), MAX_AT = Date.UTC(2100, 0, 1);

function isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function config(env, year) {
  var lead = (env.MOTION_LEAD_DAYS == null || env.MOTION_LEAD_DAYS === '') ? 3 : Number(env.MOTION_LEAD_DAYS);
  if (!isFinite(lead) || lead < 0) lead = 3;
  var dates = [];
  if (env.MOTION_DATES) dates = String(env.MOTION_DATES).split(',').map(function (s) { return s.trim(); }).filter(isIso);
  if (!dates.length) for (var d = 21; d <= 31; d++) dates.push(year + '-10-' + (d < 10 ? '0' : '') + d);
  return { dates: dates, lead: lead };
}

/** 00:00 IST, `lead` days before the date, as epoch ms */
function defaultRelease(iso, lead) {
  var p = iso.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2] - lead) - IST_MS;
}

function effective(cfg, data, iso) {
  var r = (data.release || {})[iso] || {};
  var def = defaultRelease(iso, cfg.lead);
  var at = typeof r.at === 'number' && isFinite(r.at) ? r.at : null;
  var eff = at != null ? at : (data.auto === false ? null : def);       // null = manual: no time set and auto is off
  return { def: def, at: at, hold: !!r.hold, eff: eff };
}

function text(data, iso, cat) {
  var t = ((data.motions || {})[iso] || {})[cat];
  return typeof t === 'string' && t.trim() ? t : '';
}

/** What the public page may see. Unreleased dates carry NO motion text. */
function publicView(cfg, data, now) {
  var next = null;
  var dates = cfg.dates.map(function (iso) {
    var e = effective(cfg, data, iso), o = { d: iso };
    if (!e.hold && e.eff != null && e.eff <= now) {
      o.ok = 1;
      var m = {}, any = false;
      CATS.forEach(function (c) { var t = text(data, iso, c); if (t) { m[c] = t; any = true; } });
      if (any) o.m = m;
    } else {
      o.ok = 0;
      o.rel = e.hold ? null : e.eff;
      if (!e.hold && e.eff != null && (next === null || e.eff < next)) next = e.eff;
    }
    return o;
  });
  return { now: now, next: next, dates: dates };
}

/** What the host page sees (includes the typed text and the default time). */
function hostView(cfg, data, now) {
  return {
    now: now, cats: CATS, lead: cfg.lead, auto: data.auto !== false,
    dates: cfg.dates.map(function (iso) {
      var e = effective(cfg, data, iso), m = {}, filled = 0;
      CATS.forEach(function (c) { m[c] = text(data, iso, c); if (m[c]) filled++; });
      return { d: iso, label: T.dayLabel(iso), def: e.def, at: e.at, eff: e.eff, hold: e.hold, filled: filled, m: m,
        state: e.hold ? 'held' : e.eff == null ? 'manual' : (e.eff <= now ? 'released' : 'scheduled') };
    })
  };
}

/** Validate typed motions for one date. Returns { value } or { error }. */
function cleanMotions(input) {
  var out = {};
  if (!input || typeof input !== 'object') return { error: 'No motions sent.' };
  for (var i = 0; i < CATS.length; i++) {
    var c = CATS[i], t = input[c];
    if (t == null) t = '';
    if (typeof t !== 'string') return { error: 'Motion for ' + c + ' must be text.' };
    t = t.replace(/\r\n?/g, '\n').trim();
    if (t.length > MAX_LEN) return { error: 'Motion for ' + c + ' is too long (' + t.length + ' characters; the limit is ' + MAX_LEN + ').' };
    if (t) out[c] = t;
  }
  return { value: out };
}

function validAt(n) { return typeof n === 'number' && isFinite(n) && n >= MIN_AT && n <= MAX_AT; }

/** Validate a whole backup file's motions + release data against the allowed dates. */
function cleanBackup(b, cfg) {
  var motions = {}, release = {};
  if (!b || typeof b !== 'object') return { error: 'That file is not an IDL backup.' };
  var bm = b.motions || {}, br = b.release || {};
  for (var i = 0; i < cfg.dates.length; i++) {
    var iso = cfg.dates[i];
    if (bm[iso] != null) {
      var r = cleanMotions(bm[iso]);
      if (r.error) return { error: iso + ': ' + r.error };
      if (Object.keys(r.value).length) motions[iso] = r.value;
    }
    var x = br[iso];
    if (x && typeof x === 'object') {
      var o = {};
      if (x.at != null) { if (!validAt(x.at)) return { error: iso + ': release time is not valid.' }; o.at = x.at; }
      if (x.hold) o.hold = true;
      if (Object.keys(o).length) release[iso] = o;
    }
  }
  return { motions: motions, release: release };
}

module.exports = { CATS: CATS, MAX_LEN: MAX_LEN, isIso: isIso, config: config, defaultRelease: defaultRelease, effective: effective,
  publicView: publicView, hostView: hostView, cleanMotions: cleanMotions, cleanBackup: cleanBackup, validAt: validAt };
