/**
 * sides.js - when a JUNIOR's side (Prop / Opp) becomes visible. Pure functions, no I/O.
 *
 * Sides are pre-assigned in the Roster (side_R1, side_R2, side_R3; Juniors only). For each round there are two rules:
 *   1. OVERRIDE "show everyone now" (host checkbox per round): the side is visible to every Junior for that round.
 *   2. AUTOMATIC rule (host switch): a Junior's side for a round becomes visible at 00:00 IST, LEAD days (default 3)
 *      before the date of THAT student's round (the debate's date once paired, else the planned date).
 * Visible = override OR (automatic AND release time reached). With the automatic rule off and no override, nothing shows.
 * The SERVER decides this on every request; a side that is not visible yet is never sent to a browser.
 * Middle and Senior are not covered here: they follow Debates.sides_visible only.
 */
var IST_MS = 330 * 60000;

function config(env) {
  var lead = (env.SIDE_LEAD_DAYS == null || env.SIDE_LEAD_DAYS === '') ? 3 : Number(env.SIDE_LEAD_DAYS);
  if (!isFinite(lead) || lead < 0) lead = 3;
  return { lead: lead };
}

/** 00:00 IST, `lead` days before the date, as epoch ms */
function releaseAt(iso, lead) {
  var p = iso.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2] - lead) - IST_MS;
}

/** sw = { auto: bool, all: { r1, r2, r3 } }  ->  function (round, isoDate) => bool */
function revealer(cfg, sw, now) {
  return function (round, iso) {
    if (sw.all && sw.all['r' + round]) return true;
    if (!sw.auto || !iso) return false;
    return now >= releaseAt(iso, cfg.lead);
  };
}

/** sorted, distinct release instants for a list of ISO dates (the moments the public data can change by itself) */
function instants(cfg, isoList) {
  var seen = {}, out = [];
  (isoList || []).forEach(function (iso) { var t = releaseAt(iso, cfg.lead); if (!seen[t]) { seen[t] = 1; out.push(t); } });
  return out.sort(function (a, b) { return a - b; });
}

/** Host-page summary per round. sideDates = { 1: { 'YYYY-MM-DD': count }, 2: ..., 3: ..., nodate: {1: n, ...} } */
function hostView(cfg, sw, sideDates, now) {
  var show = revealer(cfg, sw, now), rounds = [];
  [1, 2, 3].forEach(function (n) {
    var by = (sideDates && sideDates[n]) || {}, nodate = ((sideDates && sideDates.nodate) || {})[n] || 0;
    var total = nodate, revealed = 0, next = null, nextCount = 0;
    if (show(n, null)) revealed += nodate;
    Object.keys(by).forEach(function (iso) {
      var c = by[iso], t = releaseAt(iso, cfg.lead);
      total += c;
      if (show(n, iso)) revealed += c;
      else if (sw.auto && !(sw.all && sw.all['r' + n])) {
        if (next === null || t < next) { next = t; nextCount = c; } else if (t === next) nextCount += c;
      }
    });
    rounds.push({ n: n, total: total, revealed: revealed, override: !!(sw.all && sw.all['r' + n]), next: next, nextCount: nextCount });
  });
  return { now: now, lead: cfg.lead, auto: !!sw.auto, rounds: rounds };
}

module.exports = { config: config, releaseAt: releaseAt, revealer: revealer, instants: instants, hostView: hostView };
