/**
 * time.js - IST date/time rules shared by the servers AND the browsers (served at /shared/time.js).
 * Section start = block start + (section - 1) x 20 min. A block with 30 minutes holds 1 section.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IDLTime = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var SECTION_MIN = 20, IST_MIN = 330, MIN_MS = 60000;
  var MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var MON_LONG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** '21 Oct 2026' | '21 Oct' | '2026-10-21' -> 'YYYY-MM-DD' (or null). */
  function parseDate(text, defaultYear) {
    if (text == null) return null;
    var s = String(text).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?$/.exec(s))) {
      var mi = MON.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi < 0) return null;
      var y = m[3] ? Number(m[3]) : (defaultYear || 2026), d = Number(m[1]);
      if (d < 1 || d > 31) return null;
      return y + '-' + pad(mi + 1) + '-' + pad(d);
    }
    return null;
  }

  /** '3:30 PM - 4:30 PM' -> {label,start,end,sections} (minutes after midnight) or null. */
  function parseBlock(text) {
    if (text == null) return null;
    var m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*(?:-|\u2013|\u2014|to)\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(String(text));
    if (!m) return null;
    function mins(h, mi, ap) { h = Number(h) % 12; if (/p/i.test(ap)) h += 12; return h * 60 + Number(mi); }
    var start = mins(m[1], m[2], m[3]), end = mins(m[4], m[5], m[6]);
    if (end <= start) return null;
    return { label: String(text).trim(), start: start, end: end, sections: Math.max(1, Math.floor((end - start) / SECTION_MIN)) };
  }

  /** minutes after midnight -> '3:40 PM' */
  function clock(min) {
    var h = Math.floor(min / 60) % 24, mi = min % 60, ap = h >= 12 ? 'PM' : 'AM';
    return ((h % 12) || 12) + ':' + pad(mi) + ' ' + ap;
  }
  /** '3:40 - 4:00 PM' style range (collapses AM/PM when both are the same). */
  function range(startMin, endMin) {
    var a = clock(startMin), b = clock(endMin);
    return a.slice(-2) === b.slice(-2) ? a.slice(0, -3) + ' \u2013 ' + b : a + ' \u2013 ' + b;
  }

  /** epoch ms of 00:00 IST on an ISO date */
  function dayStartMs(iso) {
    var p = iso.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) - IST_MIN * MIN_MS;
  }
  function sectionStartMin(blockStart, section) { return blockStart + (section - 1) * SECTION_MIN; }
  function sectionStartMs(iso, blockStart, section) { return dayStartMs(iso) + sectionStartMin(blockStart, section) * MIN_MS; }
  function sectionEndMs(iso, blockStart, section) { return sectionStartMs(iso, blockStart, section) + SECTION_MIN * MIN_MS; }

  function ist(ms) {
    var d = new Date(ms + IST_MIN * MIN_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
  }
  function istIso(ms) { var p = ist(ms); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }
  function istClock(ms, withSeconds) { var p = ist(ms); return pad(p.h) + ':' + pad(p.mi) + (withSeconds ? ':' + pad(p.s) : ''); }
  /** 'Fri 24 Oct' */
  function dayLabel(iso) {
    var p = iso.split('-'), dow = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return DOW[dow] + ' ' + Number(p[2]) + ' ' + MON_LONG[+p[1] - 1];
  }
  function shortDay(iso) { var p = iso.split('-'); return Number(p[2]) + ' ' + MON_LONG[+p[1] - 1]; }

  return {
    SECTION_MIN: SECTION_MIN, parseDate: parseDate, parseBlock: parseBlock, clock: clock, range: range,
    dayStartMs: dayStartMs, sectionStartMin: sectionStartMin, sectionStartMs: sectionStartMs, sectionEndMs: sectionEndMs,
    istIso: istIso, istClock: istClock, dayLabel: dayLabel, shortDay: shortDay
  };
});
