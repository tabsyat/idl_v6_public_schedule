/* IDL public page. Data layer = load(); display layer = the render* functions. Plain ES5 for old phones. */
(function () {
  'use strict';
  var T = window.IDLTime;
  var SEC = T.SECTION_MIN * 60000;
  var POLL_MS = 20000, STALE_MS = 120000, PAGE_SIZE = 12;
  var params = new URLSearchParams(location.search);
  var PROJECTOR = params.get('mode') === 'projector';
  var ROTATE_S = Number(params.get('rotate')) || 12;

  var S = { homeKey: '', snap: null, v: null, enabled: true, offset: 0, lastOk: 0, builtAt: 0, tab: 'home', sel: null, q: '',
    idx: null, deep: null, browse: { i: null }, proj: { i: null, page: 0, paused: false }, fixedNow: null,
    roster: { shown: 50, cat: '', state: '', sort: 'name', q: '' },
    motions: null, mTimer: null, mOk: 0, mPoll: 0 };

  // ------------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(parent) { for (var i = 1; i < arguments.length; i++) { var c = arguments[i]; if (c == null) continue; parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); } return parent; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function norm(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    return s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function now() { return Date.now() + S.offset; }
  function block(b) { return S.snap.cfg.blocks[b]; }
  function secStartMs(date, b, sec) { return T.sectionStartMs(date, block(b).s, sec); }
  function secRange(b, sec) { var st = T.sectionStartMin(block(b).s, sec); return T.range(st, st + T.SECTION_MIN); }
  function blockRange(b) { return T.range(block(b).s, block(b).e); }
  function student(id) { return S.idx.byId[id]; }
  function inMin(ms) { var m = Math.round(ms / 60000); return m < 1 ? 'less than a minute' : m === 1 ? '1 minute' : m < 90 ? m + ' minutes' : Math.round(m / 60) + ' hours'; }

  // ------------------------------------------------------------------ data layer
  function buildIndex(snap) {
    var byId = {}, rounds = {}, bySlot = {}, active = {}, mine = {}, blocks = snap.cfg.blocks;       // mine: studentId -> the debates that student is in
    snap.students.forEach(function (s) {
      byId[s.i] = s; s._k = norm(s.n);
      s._m = s._k + (snap.schools && s.sc != null ? ' ' + norm(snap.schools[s.sc]) : '');      // name + school: what search and filters match against
      s.p.forEach(function (p) { if (p) active[p[0] + '|' + p[1]] = 1; });
    });
    snap.debates.forEach(function (d) {
      active[d.d + '|' + d.b] = 1;
      var k = d.d + '|' + d.b + '|' + d.s;
      (bySlot[k] = bySlot[k] || []).push(d);
      d.m.forEach(function (id) { if (!(d.w && d.ab === id)) (mine[id] = mine[id] || []).push(d); });     // the absent student of a walkover did not debate
      if (d.n >= 1 && d.n <= 3) d.m.forEach(function (id) { (rounds[id] = rounds[id] || [[], [], []])[d.n - 1].push(d); });
    });
    // Which debate counts for which Roster round (the Debates round column is not used):
    // first a debate on the round's own date and slot, then any leftover debate fills the earliest round that has none.
    snap.students.forEach(function (s) {
      var ds = (mine[s.i] || []).slice().sort(function (a, b) { return T.sectionStartMs(a.d, blocks[a.b].s, a.s) - T.sectionStartMs(b.d, blocks[b.b].s, b.s); });
      var got = [null, null, null], used = [], n, k;
      for (n = 0; n < 3; n++) { var p = s.p[n]; if (!p) continue;
        for (k = 0; k < ds.length; k++) if (used.indexOf(k) < 0 && ds[k].d === p[0] && ds[k].b === p[1]) { got[n] = ds[k]; used.push(k); break; } }
      for (k = 0; k < ds.length; k++) { if (used.indexOf(k) >= 0) continue;
        for (n = 0; n < 3; n++) if (!got[n]) { got[n] = ds[k]; used.push(k); break; } }
      s._dn = got;
    });
    var slots = [];
    Object.keys(active).forEach(function (k) {
      var a = k.split('|'), b = +a[1];
      for (var sec = 1; sec <= blocks[b].n; sec++) slots.push({ date: a[0], b: b, sec: sec, start: T.sectionStartMs(a[0], blocks[b].s, sec) });
    });
    slots.sort(function (x, y) { return x.start - y.start; });
    return { byId: byId, rounds: rounds, bySlot: bySlot, slots: slots, students: snap.students };
  }
  function pick(id, n) {
    var c = (S.idx.rounds[id] || [[], [], []])[n - 1];
    if (!c.length) return null;
    var ok = c.filter(function (d) { return !(d.w && d.ab === id); });
    return ok.length ? ok[ok.length - 1] : c[c.length - 1];
  }
  function info(s, n, rosterOnly) {          // rosterOnly: ignore the Debates rows, use the Roster plan as it is
    var d = rosterOnly === false ? pick(s.i, n) : null, p = s.p[n - 1];     // students' rounds always come from the Roster; only All rooms / projector read the Debates
    if (d) {
      var start = secStartMs(d.d, d.b, d.s), st = T.sectionStartMin(block(d.b).s, d.s);
      // the Debates row is the real pairing: its batch wins over the Roster batch
      return { k: d.w && d.ab === s.i ? 'absent' : 'paired', d: d, date: d.d, start: start, end: start + SEC, startMin: st, time: secRange(d.b, d.s),
        slot: blockRange(d.b), batch: d.s, bt: secRange(d.b, d.s) };
    }
    if (p) {
      var bl = block(p[1]), ds = T.dayStartMs(p[0]), bn = p[2] >= 1 && p[2] <= bl.n ? p[2] : 0;
      if (bn) {      // Roster batch known: the 20-minute batch window, not the whole slot
        var bs = T.sectionStartMin(bl.s, bn);
        return { k: 'planned', b: p[1], date: p[0], start: ds + bs * 60000, end: ds + bs * 60000 + SEC, startMin: bs, time: T.range(bs, bs + T.SECTION_MIN),
          slot: T.range(bl.s, bl.e), batch: bn, bt: T.range(bs, bs + T.SECTION_MIN) };
      }
      return { k: 'planned', b: p[1], date: p[0], start: ds + bl.s * 60000, end: ds + bl.e * 60000, startMin: bl.s, time: T.range(bl.s, bl.e), slot: T.range(bl.s, bl.e), batch: 0 };
    }
    return { k: 'tbc' };
  }
  function slotHidden(x) { return !!(S.snap && S.snap.batchOnly && x && x.batch); }                  // host switch: show the batch, not the whole slot
  // a round is done when the debate matched to it (see buildIndex) has ended its 20-minute batch
  function roundDone(s, n) {
    var d = s._dn && s._dn[n - 1];
    return !!d && secStartMs(d.d, d.b, d.s) + SEC <= now();
  }
  function doneBadge() { return el('span', 'badge done', 'Completed'); }
  // missed: 2 hours have passed since the round's time window (server time) and no debate in the Debates tab is matched to it
  function roundMissed(s, n, x) {
    if (!x || x.k === 'tbc' || !S.snap.pairings || (s._dn && s._dn[n - 1])) return false;      // pairings off = no debates are sent, so nothing can be judged
    return x.end + 2 * 3600000 <= now();          // 2 hours after the round's time window ended (its batch, or its whole slot when there is no batch)
  }
  function missBadge() { return el('span', 'badge miss', 'Missed'); }
  function batchTag(x) { return x && x.batch ? ' (Batch ' + x.batch + ')' : ''; }                       // for the Now / Next text
  function batchLine(x) { return x && x.batch ? el('span', 'batch', 'Batch ' + x.batch + ' (' + x.bt + ')') : null; }   // line under the slot time
  function slotIndexNow() {
    var t = now(), sl = S.idx.slots;
    for (var i = 0; i < sl.length; i++) if (sl[i].start + SEC > t) return i;
    return Math.max(0, sl.length - 1);
  }
  function findSlot(date, b, sec) {
    var sl = S.idx.slots;
    for (var i = 0; i < sl.length; i++) if (sl[i].date === date && sl[i].b === b && sl[i].sec === sec) return i;
    return -1;
  }
  function debatesIn(slot) { return (S.idx.bySlot[slot.date + '|' + slot.b + '|' + slot.sec] || []).slice().sort(function (a, b) { return a.r - b.r; }); }

  // what matters to a student right now
  function headline(s) {
    var t = now(), infos = [1, 2, 3].map(function (n) { return info(s, n); }), next = null, nextN = 0, hasTbc = false, i;
    for (i = 0; i < 3; i++) {
      var x = infos[i];
      if (x.k === 'tbc') { hasTbc = true; continue; }
      if (x.k === 'absent') continue;
      if (x.start <= t && t < x.end) return { type: x.k === 'paired' ? 'live' : 'window', info: x, n: i + 1 };
      if (x.start > t && (!next || x.start < next.start)) { next = x; nextN = i + 1; }
    }
    if (next) return { type: 'next', info: next, n: nextN };
    return { type: hasTbc ? 'pending' : 'done' };
  }
  function schoolOf(s) { return S.snap && S.snap.schools && s.sc != null ? S.snap.schools[s.sc] : ''; }
  function oppOf(d, id) { return d.so ? null : student(d.m[0] === id ? d.m[1] : d.m[0]); }
  var SOLO_TEXT = 'Solo speech: no opponent';

  // ------------------------------------------------------------------ pieces of UI
  function nameBtn(id, cls) { var s = student(id), b = el('button', cls || 'opp-link', s ? s.n : id); b.setAttribute('data-open', id); b.type = 'button'; return b; }
  // a student's own side in round n: from the paired debate when its sides are shown, else the Roster side the server has revealed
  function mySide(s, n, x) {
    // the side of the student's real debate on that date and slot, once its sides are shown; otherwise the Roster side the server has revealed
    if (!/^junior/i.test(s.c || '')) return null;       // Middle and Senior sides are announced on the call: no side badge for them on the card or the Schedule
    var d = s._dn ? s._dn[n - 1] : null;
    if (d && d.sv) { if (d.so) return d.ss || null; return d.m[0] === s.i ? 'Prop' : 'Opp'; }
    return s.sd && s.sd[n - 1] ? s.sd[n - 1] : null;
  }
  var SIDE_LABEL = { Prop: 'Prop (For)', Opp: 'Opp (Against)' };      // the words every side badge shows
  function sideTag(side) { return side ? el('span', 'badge ' + (side === 'Prop' ? 'p' : 'o'), SIDE_LABEL[side]) : null; }
  function sideBadge(d, i) {
    if (d.so) return d.sv && d.ss ? el('span', 'badge ' + (d.ss === 'Prop' ? 'p' : 'o'), SIDE_LABEL[d.ss]) : null;
    return d.sv ? el('span', 'badge ' + (i === 0 ? 'p' : 'o'), i === 0 ? SIDE_LABEL.Prop : SIDE_LABEL.Opp) : null; }
  function speakerCell(d, i, asButton) {
    // solo speech: Speaker 1 column = Prop, Speaker 2 = Opp; the lone student sits in the column of their side (Prop, or side not shown yet, in column 1)
    if (d.so && i !== (d.sv && d.ss === 'Opp' ? 1 : 0)) return el('span', 'tbc', SOLO_TEXT);
    var id = d.m[d.so ? 0 : i], w = el('span'), n = asButton ? nameBtn(id) : el('span', null, student(id).n);
    if (d.w && d.ab === id) { n.className = (n.className ? n.className + ' ' : '') + 'absent'; }
    add(w, n, sideBadge(d, i), d.w && d.ab === id ? el('span', 'badge x', 'absent') : null);
    return w;
  }

  function renderCard() {
    var box = clear($('card')), s = S.sel && student(S.sel);
    if (!s) return;
    var back = el('button', 'link back', 'Back to search'); back.type = 'button'; back.id = 'backBtn';
    add(box, back, el('h2', 'who-h', s.n),
      el('p', 'who-sub', s.i + ', ' + s.c + (s.st ? ', ' + s.st : '')), schoolOf(s) ? el('p', 'who-school', schoolOf(s)) : null);
    var h = headline(s), band;
    if (h.type === 'live') {
      band = el('div', 'band live'); add(band, el('div', 'txt'), el('div', 'big', 'Room ' + h.info.d.r));
      var tx = band.firstChild; add(tx, el('b', null, 'Now: R' + h.n), h.info.time + batchTag(h.info) + (h.info.d.so ? ', solo speech' : ', vs ' + oppOf(h.info.d, s.i).n));
    } else if (h.type === 'window') {
      band = el('div', 'band live'); var t2 = el('div', 'txt'); add(t2, el('b', null, 'Your slot is open now: R' + h.n), h.info.time + batchTag(h.info)); add(band, t2);
    } else if (h.type === 'next') {
      band = el('div', 'band next'); var t3 = el('div', 'txt');
      var when = T.dayLabel(h.info.date) + ', ' + h.info.time + batchTag(h.info), soon = h.info.start - now();
      add(t3, el('b', null, 'Next: R' + h.n), when + (soon > 0 && soon < 3600000 ? ' (starts in ' + inMin(soon) + ')' : '')); add(band, t3);
      if (h.info.k === 'paired') add(band, el('div', 'big', 'Room ' + h.info.d.r));
    } else if (h.type === 'pending') {
      band = el('div', 'band next'); add(band, el('div', 'txt', 'Some of your rounds do not have a slot yet. The organisers will confirm them.'));
    } else {
      band = el('div', 'band done'); add(band, el('div', 'txt', 'All your rounds are finished.'));
    }
    add(box, band);

    var ol = el('ol', 'rounds'), t = now();
    [1, 2, 3].forEach(function (n) {
      var x = info(s, n), li = el('li', 'round');
      var rn = el('div', 'rn'), side = x.k === 'absent' ? null : mySide(s, n, x);
      var done = roundDone(s, n);
      add(rn, el('span', null, 'R' + n), sideTag(side), done ? doneBadge() : null, roundMissed(s, n, x) ? missBadge() : null);
      add(li, rn);
      if (x.k === 'tbc') {
        add(li, el('div', 'when', 'Slot to be confirmed'), el('div'));
        add(li, add(el('div', 'detail'), el('span', 'tbc', 'The organisers will confirm this slot.')));
      } else {
        if (x.start <= t && t < x.end) li.className += ' live'; else if (done) li.className += ' past';
        var when2 = el('div', 'when'); add(when2, el('span', 'day', T.dayLabel(x.date)), slotHidden(x) ? null : el('span', 'time', x.slot || x.time), batchLine(x));
        add(li, when2);
        var room = el('div', 'room'); if (x.k === 'paired') add(room, 'Room ' + x.d.r);
        add(li, room);
        var det = el('div', 'detail');
        if (x.k === 'paired') {
          var d = x.d, opp = oppOf(d, s.i);
          if (opp) add(det, 'vs ', nameBtn(opp.i)); else add(det, SOLO_TEXT);
          if (!d.sv && !side && opp) add(det, el('br'), 'Sides are announced on the call.');
          if (d.w) add(det, el('br'), 'Walkover: ' + student(d.ab).n + ' was marked absent.');
        } else if (x.k === 'absent') {
          add(det, 'You were marked absent for this debate. Check with the organisers for a new slot.');
        }
        if (det.firstChild) add(li, det);
      }
      add(ol, li);
    });
    add(box, ol);
  }

  function quick(s) {
    var h = headline(s);
    if (h.type === 'live') return { cls: 'quick now', text: 'Now: Room ' + h.info.d.r };
    if (h.type === 'window') return { cls: 'quick now', text: 'Slot open now' };
    if (h.type === 'next') return { cls: 'quick', text: 'Next: R' + h.n + ', ' + T.shortDay(h.info.date) + ', ' + T.clock(h.info.startMin) + (h.info.batch ? ', Batch ' + h.info.batch : '') + (h.info.k === 'paired' ? ', Room ' + h.info.d.r : '') };
    if (h.type === 'pending') return { cls: 'quick', text: 'Slot to be confirmed' };
    return { cls: 'quick', text: 'Finished' };
  }

  function search(q) {
    var raw = q.trim().toLowerCase(), out = [], i, s;
    if (raw.length < 2) return null;
    var idMode = raw.indexOf(' ') < 0 && raw.indexOf('-') >= 0;
    if (idMode) { for (i = 0; i < S.idx.students.length; i++) { s = S.idx.students[i]; if (s.i.toLowerCase().indexOf(raw) >= 0) out.push(s); } }
    else {
      var toks = norm(q).split(' ').filter(Boolean);
      if (!toks.length) return null;
      for (i = 0; i < S.idx.students.length; i++) { s = S.idx.students[i]; if (toks.every(function (t) { return s._m.indexOf(t) >= 0; })) out.push(s); }
      out.sort(function (a, b) {
        var pa = a._k.indexOf(toks[0]) === 0 ? 0 : 1, pb = b._k.indexOf(toks[0]) === 0 ? 0 : 1;
        return pa - pb || (a._k < b._k ? -1 : a._k > b._k ? 1 : 0);
      });
    }
    return out;
  }

  function renderFind() {
    var res = clear($('results')), list = search(S.q);
    if (S.sel) { res.hidden = true; renderCard(); return; }
    res.hidden = false; clear($('card'));
    if (list === null) { add(res, el('p', 'msg', 'Type at least 2 letters of your name, or your student ID.')); return; }
    if (!list.length) { add(res, el('p', 'msg', 'No student found. Check the spelling, or try your student ID.')); return; }
    if (list.length === 1) { S.sel = list[0].i; res.hidden = true; renderCard(); return; }
    var ul = el('ul', 'res');
    list.slice(0, 25).forEach(function (s) {
      var li = el('li'), b = el('button'), l = el('span'), q = quick(s);
      b.type = 'button'; b.setAttribute('data-open', s.i);
      add(l, el('span', 'who', s.n), el('span', 'sub', s.i + ', ' + s.c + (s.st ? ', ' + s.st : '') + (schoolOf(s) ? ', ' + schoolOf(s) : '')));
      add(b, l, el('span', q.cls, q.text)); add(li, b); add(ul, li);
    });
    add(res, ul);
    if (list.length > 25) add(res, el('p', 'more', (list.length - 25) + ' more students match. Keep typing to narrow the list.'));
  }

  // ---- browse
  function fillSelect(sel, items, value) {
    clear(sel);
    items.forEach(function (it) { var o = el('option', null, it.label); o.value = it.value; if (String(it.value) === String(value)) o.selected = true; sel.appendChild(o); });
  }
  function browseHash(sl) { return 'rooms' + (S.browse.i == null || !sl ? '' : '/' + sl.date + '/' + block(sl.b).s + '/' + sl.sec); }   // a refresh keeps the chosen date, slot and batch
  function renderBrowse() {
    var i = S.browse.i == null ? slotIndexNow() : S.browse.i, sl = S.idx.slots[i], out = clear($('bOut'));
    if (!sl) { add(out, el('p', 'msg', 'No batches are scheduled yet.')); return; }
    if (S.tab === 'browse') { try { history.replaceState(null, '', location.pathname + location.search + '#' + browseHash(sl)); } catch (e) { /* ignore */ } }
    var dates = [], blocksOn = [], seenD = {}, seenB = {};
    S.idx.slots.forEach(function (x) {
      if (!seenD[x.date]) { seenD[x.date] = 1; dates.push({ value: x.date, label: T.dayLabel(x.date) }); }
      if (x.date === sl.date && !seenB[x.b]) { seenB[x.b] = 1; blocksOn.push({ value: x.b, label: blockRange(x.b) }); }
    });
    // Batch options carry the time range of the chosen slot, e.g. "Batch 1 (3:30 – 3:50 PM)"
    var secs = []; for (var k = 1; k <= block(sl.b).n; k++) secs.push({ value: k, label: 'Batch ' + k + ' (' + secRange(sl.b, k) + ')' });
    fillSelect($('bDate'), dates, sl.date); fillSelect($('bBlock'), blocksOn, sl.b); fillSelect($('bSec'), secs, sl.sec);
    var ds = debatesIn(sl);
    add(out, el('p', 'sum', T.dayLabel(sl.date) + ', ' + secRange(sl.b, sl.sec) + '.'));
    if (!ds.length) { add(out, el('p', 'msg', 'No pairings are published for this batch yet.')); return; }
    var tb = el('table', 'tbl'), hd = el('tr');
    ['Room', 'Speaker 1', 'Speaker 2'].forEach(function (t) { add(hd, el('th', null, t)); });
    add(tb, add(el('thead'), hd));
    var body = el('tbody');
    ds.forEach(function (d) {
      var tr = el('tr');
      add(tr, el('td', 'rm', String(d.r)), add(el('td'), speakerCell(d, 0, true)), add(el('td'), speakerCell(d, 1, true)));
      add(body, tr);
    });
    add(tb, body); add(out, add(el('div'), tb));
  }

  // ---- roster (all students, 3 rounds each); only present when the host switches it on
  function roundCell(s, n) {
    var x = info(s, n, true), td = el('td', 'rc');          // Schedule tab = Roster only: date, slot, batch, side; no room or opponent
    td.setAttribute('data-label', 'R' + n);                    // shown as the row label in the phone layout
    if (x.k === 'tbc') { add(td, el('span', 'tbc', 'To be confirmed')); return td; }
    var done = roundDone(s, n);
    if (done) td.className += ' past';
    add(td, el('b', null, T.shortDay(x.date)), slotHidden(x) ? null : ' ' + (x.slot || x.time));
    if (x.batch) add(td, el('br'), batchLine(x));
    if (done) add(td, el('br'), doneBadge());
    else if (roundMissed(s, n, x)) add(td, el('br'), missBadge());
    var own = x.k === 'absent' ? null : mySide(s, n, x);
    if (own) add(td, el('br'), 'speaks ', sideTag(own));
    if (x.k === 'paired') {
      var d = x.d, oi = d.m[0] === s.i ? 1 : 0, opp = d.so ? null : student(d.m[oi]);
      add(td, el('br'), el('span', 'rrm', 'Room ' + d.r), opp ? ' vs ' : ' ', opp ? nameBtn(opp.i) : el('span', 'tbc', SOLO_TEXT));
      if (d.w) add(td, el('br'), el('span', 'tbc', 'Walkover: ' + student(d.ab).n + ' absent'));
    } else if (x.k === 'absent') add(td, el('br'), el('span', 'tbc', 'Marked absent'));
    return td;
  }
  function rosterList() {
    var R = S.roster, toks = norm(R.q).split(' ').filter(Boolean), raw = R.q.trim().toLowerCase();
    var out = S.idx.students.filter(function (s) {
      if (R.cat && s.c !== R.cat) return false;
      if (R.state && (s.st || '') !== R.state) return false;
      if (!toks.length) return true;
      return s.i.toLowerCase().indexOf(raw) >= 0 || toks.every(function (t) { return s._m.indexOf(t) >= 0; });
    });
    out.sort(function (a, b) {
      var x = R.sort === 'id' ? a.i : a._k, y = R.sort === 'id' ? b.i : b._k;
      return x < y ? -1 : x > y ? 1 : (a.i < b.i ? -1 : 1);
    });
    return out;
  }
  function fillRosterFilters() {
    var cats = {}, states = {};
    S.idx.students.forEach(function (s) { if (s.c) cats[s.c] = 1; if (s.st) states[s.st] = 1; });
    function opts(map, allLabel, cur) { var a = [{ value: '', label: allLabel }]; Object.keys(map).sort().forEach(function (k) { a.push({ value: k, label: k }); }); return { a: a, cur: cur }; }
    var c = opts(cats, 'All categories', S.roster.cat), st = opts(states, 'All states', S.roster.state);
    fillSelect($('rCat'), c.a, c.cur); fillSelect($('rState'), st.a, st.cur);
  }
  function renderRoster() {
    var list = rosterList(), R = S.roster, out = clear($('rOut'));
    if (!$('rCat').options.length) fillRosterFilters();
    $('rCount').textContent = list.length + ' of ' + S.idx.students.length + ' students. Times are IST.';
    if (!list.length) { add(out, el('p', 'msg', 'No students match.')); $('rMore').hidden = true; return; }
    var tb = el('table', 'tbl rost'), hd = el('tr');
    var withSchool = !!S.snap.schools;
    ['Name', 'ID', 'State'].concat(withSchool ? ['School'] : [], ['Round 1', 'Round 2', 'Round 3']).forEach(function (t) { add(hd, el('th', null, t)); });
    add(tb, add(el('thead'), hd));
    var body = el('tbody');
    list.slice(0, R.shown).forEach(function (s) {
      var tr = el('tr');
      add(tr, add(el('td', 'rn1'), nameBtn(s.i)), el('td', 'rid', s.i), el('td', 'rst', s.st || ''));
      if (withSchool) add(tr, el('td', 'rsch', schoolOf(s)));
      [1, 2, 3].forEach(function (n) { add(tr, roundCell(s, n)); });
      add(body, tr);
    });
    add(tb, body); add(out, tb);
    $('rMore').hidden = list.length <= R.shown;
    $('rMore').textContent = 'Show more (' + (list.length - R.shown) + ' left)';
  }

  // ---- motions (released by the server; unreleased text is never in the data)
  var MCATS = ['Junior', 'Middle', 'Senior'];
  var MNOTE = { Junior: 'Sides revealed 3 days before your round', Middle: 'Sides will be revealed during attendance, please prepare for both sides', Senior: 'Sides will be revealed during attendance, please prepare for both sides' };
  function relText(ms) {
    var hm = T.istClock(ms).split(':'), h = Number(hm[0]), mi = Number(hm[1]);
    return T.shortDay(T.istIso(ms)) + ', ' + T.clock(h * 60 + mi) + ' IST';
  }
  function renderMotions() {
    var out = clear($('mOut')), M = S.motions;
    if (!M) { add(out, el('p', 'msg', S.mOk ? 'Loading…' : 'Loading the motions…')); return; }
    M.dates.forEach(function (x) {
      var c = el('article', 'mcard' + (x.ok ? ' open' : ' locked')), h = el('h3', null, T.dayLabel(x.d));
      add(h, el('span', 'mchip', x.ok ? 'Released' : 'Not released yet'));
      add(c, h);
      if (!x.ok) add(c, el('p', 'mwait', x.rel ? 'Releases ' + relText(x.rel) : 'Release time to be announced'));
      else if (!x.m) add(c, el('p', 'mwait', 'The motions will be posted here shortly.'));
      else MCATS.forEach(function (cat) {
        if (!x.m[cat]) return;
        add(c, add(el('div', 'mrow'), add(el('div', 'mhead'), el('span', 'mcat', cat), MNOTE[cat] ? el('span', 'mnote' + (cat === 'Junior' ? '' : ' strong'), '(' + MNOTE[cat] + ')') : null), el('p', 'mtxt', x.m[cat])));
      });
      add(out, c);
    });
  }
  function scheduleMotions() {
    clearTimeout(S.mTimer);
    if (!S.motions || S.motions.next == null) return;
    var wait = S.motions.next - now() + 1500;           // just after the release moment
    if (wait < 1500) wait = 1500;
    if (wait < 2000000000) S.mTimer = setTimeout(loadMotions, wait);
  }
  function loadMotions() {
    return fetch('api/motions', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('motions ' + r.status);
      return r.json();
    }).then(function (j) {
      var js = JSON.stringify(j.dates), changed = js !== S.mJson;
      S.mOk = Date.now(); S.motions = j; S.mJson = js; scheduleMotions();
      if (S.tab === 'motions') { if (changed) render(); else renderFoot(); }
    }).catch(function () { if (S.tab === 'motions' && !S.motions) { clear($('mOut')); add($('mOut'), el('p', 'msg', 'Cannot reach the server. Check your connection and try again.')); } });
  }

  // ---- projector
  function renderProj() {
    var i = S.proj.i == null ? slotIndexNow() : S.proj.i, sl = S.idx.slots[i], grid = clear($('pGrid'));
    if (!sl) { $('pTitle').textContent = 'No batches scheduled'; return; }
    var ds = debatesIn(sl), pages = Math.max(1, Math.ceil(ds.length / PAGE_SIZE)), t = now();
    if (S.proj.page >= pages) S.proj.page = 0;
    var live = sl.start <= t && t < sl.start + SEC, before = sl.start > t;
    $('pTitle').textContent = T.dayLabel(sl.date) + ', ' + secRange(sl.b, sl.sec);
    $('pSub').textContent = 'Batch ' + sl.sec + (S.snap.batchOnly ? '. ' : ' of the ' + blockRange(sl.b) + ' slot. ') + (live ? 'Live now' : before ? 'Starts in ' + inMin(sl.start - t) : 'Finished');
    $('pLive').textContent = S.proj.i == null ? 'Following live' : 'Follow live';
    if (!ds.length) add(grid, el('div', 'p-empty', 'No pairings published for this batch yet.'));
    ds.slice(S.proj.page * PAGE_SIZE, (S.proj.page + 1) * PAGE_SIZE).forEach(function (d) {
      var c = el('div', 'p-cell'), nm = el('div', 'p-names');
      add(c, el('div', 'p-room', String(d.r)));
      [0, 1].forEach(function (k) {
        var row = el('div'); add(row, speakerCell(d, k, false)); add(nm, row);
      });
      add(c, nm); add(grid, c);
    });
    $('pFoot').textContent = '';
    add($('pFoot'), el('span', null, ds.length + ' of ' + S.snap.cfg.rooms + ' rooms paired' + (pages > 1 ? '. Page ' + (S.proj.page + 1) + ' of ' + pages : '')),
      el('span', null, 'Updated ' + T.istClock(S.lastOk + S.offset, true) + ' IST'));
  }

  // ------------------------------------------------------------------ shell
  var TAB_HASH = { roster: 'schedule', motions: 'motions', browse: 'rooms', find: 'find' };       // tab -> address-bar hash, so a refresh stays on the same tab
  var HASH_TAB = { schedule: 'roster', motions: 'motions', rooms: 'browse', find: 'find' };
  function setTab(t) {
    S.tab = t; S.tabChosen = true;
    // the #ID in the address bar belongs to a student's card: drop it on every other tab, bring it back on Find me
    var hs = t === 'find' && S.sel ? encodeURIComponent(S.sel) : t === 'browse' && S.idx ? browseHash(S.idx.slots[S.browse.i]) : (TAB_HASH[t] || '');
    try { history.replaceState(null, '', location.pathname + location.search + (hs ? '#' + hs : '')); } catch (e) { /* ignore */ }
    applyTab();
    render();
  }
  // Order of the tabs (ribbon) and of the Home buttons: Motions always sits in second place.
  //   Schedule on:  Schedule, Motions, Find me, All rooms        Schedule off: Find me, Motions, All rooms
  function tabOrder() {
    var base = [];
    if (S.snap && S.enabled) { if (S.snap.roster) base.push('roster'); base.push('find', 'browse'); }
    base.splice(Math.min(1, base.length), 0, 'motions');
    return base;
  }
  function orderTabs() { var box = $('tabs'); tabOrder().forEach(function (k) { var b = tabBtn(k); if (b) box.appendChild(b); }); }
  var HOME_ITEMS = {
    roster: ['Schedule', 'Every student\'s slots for all three rounds'],
    motions: ['Motions', 'Read the motions once they are released'],
    find: ['Find me', 'Search your name or ID to see your slots for all three rounds'],
    browse: ['All rooms', 'Who is in each room, batch by batch']
  };
  // Home page: opened by default and by clicking the title; it has no tab of its own
  function renderHome() {
    var items = tabOrder().map(function (k) { return [k, HOME_ITEMS[k][0], HOME_ITEMS[k][1]]; });
    var key = items.map(function (i) { return i[0]; }).join();
    if (S.homeKey === key) return;                       // unchanged: keep the buttons (and keyboard focus) as they are
    S.homeKey = key;
    var box = clear($('homeLinks'));
    items.forEach(function (i) {
      var b = el('button'); b.type = 'button'; b.setAttribute('data-go', i[0]);
      add(b, el('b', null, i[1]), el('span', null, i[2])); box.appendChild(b);
    });
  }
  function render() {
    if (S.tab === 'home' && !PROJECTOR) { renderHome(); renderFoot(); return; }
    if (S.tab === 'motions' && !PROJECTOR) { renderMotions(); renderFoot(); return; }
    if (!S.snap) return;
    try {
      if (PROJECTOR) renderProj();
      else if (S.tab === 'find') renderFind();
      else if (S.tab === 'roster') renderRoster();
      else renderBrowse();
      renderFoot();
    } catch (e) { console.error(e); msg('Something went wrong showing the schedule. Reload the page.'); }
  }
  function renderFoot() {
    if (S.tab === 'motions' && !PROJECTOR) { $('footTime').textContent = S.mOk ? 'Motions checked at ' + T.istClock(S.mOk + S.offset, true) + ' IST.' : ''; return; }
    if (!S.snap) { $('footTime').textContent = ''; return; }
    var s = T.istClock(S.lastOk + S.offset, true), b = T.istClock(S.builtAt + S.offset);
    $('footTime').textContent = 'Checked at ' + s + ' IST. Schedule data from ' + b + ' IST.';
  }
  function msg(text) {
    if (PROJECTOR) { $('proj').hidden = false; $('pTitle').textContent = text; $('pSub').textContent = ''; clear($('pGrid')); clear($('pFoot')); return; }
    $('loading').hidden = false; $('loading').textContent = text;
  }
  function warn(msg) { var w = $('warn'); w.hidden = !msg; w.textContent = msg || ''; }
  function staleCheck() {
    if (S.lastOk && Date.now() - S.lastOk > STALE_MS) warn('Cannot reach the server. Showing the schedule from ' + T.istClock(S.builtAt + S.offset) + ' IST. It may be out of date.');
  }

  function tabBtn(n) { return $('tabs').querySelector('[data-tab="' + n + '"]'); }
  function applySnapshot(snap) {
    S.snap = snap; S.enabled = snap.enabled !== false; S.builtAt = snap.builtAt;
    $('loading').hidden = true;
    if (!S.enabled) {
      ['roster', 'find', 'browse'].forEach(function (n) { tabBtn(n).hidden = true; });
      $('tabs').hidden = PROJECTOR;
      if (!PROJECTOR) { if (!S.tabChosen || ['roster', 'find', 'browse'].indexOf(S.tab) >= 0) S.tab = 'home'; applyTab(); render(); }
      msg('The schedule will be released soon. Please check back later.'); return;
    }
    ['find', 'browse'].forEach(function (n) { tabBtn(n).hidden = false; });
    $('tabs').hidden = PROJECTOR;
    S.idx = buildIndex(snap);
    if (S.pendingBrowse) {          // restore the batch that was open before the refresh
      var pb = S.pendingBrowse; S.pendingBrowse = null;
      for (var q = 0; q < S.idx.slots.length; q++) { var sx = S.idx.slots[q]; if (sx.date === pb.date && sx.sec === pb.sec && block(sx.b).s === pb.s) { S.browse.i = q; break; } }
    }
    $('tabRoster').hidden = !snap.roster;
    orderTabs();
    if (!snap.roster && S.tab === 'roster') S.tab = 'home';
    clear($('rCat')); clear($('rState'));
    if (PROJECTOR) { $('proj').hidden = false; document.body.className = 'proj'; }
    else applyTab();
    render();
    if (S.deep && student(S.deep)) { var id = S.deep; S.deep = null; openStudent(id); } else S.deep = null;
  }
  function applyTab() {
    ['home', 'roster', 'find', 'browse', 'motions'].forEach(function (n) { $('v-' + n).hidden = n !== S.tab || (n !== 'motions' && n !== 'home' && (!S.snap || !S.enabled)); });
    Array.prototype.forEach.call($('tabs').children, function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === S.tab ? 'true' : 'false'); });
    $('main').className = S.tab === 'roster' ? 'wide' : '';
  }

  function loadSnapshot() {
    return fetch('api/snapshot', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('snapshot ' + r.status);
      return r.json();
    }).then(function (snap) { S.v = snap.v; applySnapshot(snap); });
  }
  function poll() {
    var t0 = Date.now();
    if (t0 - S.mPoll > 55000) { S.mPoll = t0; loadMotions(); }       // motions are heavier than the version check: every minute is plenty (releases also fire their own timer)
    return fetch('api/v', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) { var e = new Error('v ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function (j) {
      var t1 = Date.now();
      S.lastOk = t1; if (S.fixedNow == null) S.offset = j.now - (t0 + t1) / 2;
      warn('');
      if (j.v !== S.v) return loadSnapshot();
      renderFoot();
    }).catch(function (e) {
      if (!S.snap) msg(e.status === 503 ? 'The schedule is not available yet. Try again in a minute.' : 'Cannot reach the server. Check your connection and try again.');
      else staleCheck();
    });
  }
  function loop() { (document.hidden ? Promise.resolve() : poll()).then(function () { setTimeout(loop, POLL_MS); }); }   // a tab in the background does not poll; it checks again as soon as it is shown

  // ------------------------------------------------------------------ events
  function openStudent(id) {
    S.sel = id; S.q = student(id).n; $('q').value = S.q;
    try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch (e) { /* ignore */ }
    if (S.tab !== 'find') setTab('find'); else render();
    window.scrollTo(0, 0);
  }
  function stepSlot(cur, delta) {
    var n = (cur == null ? slotIndexNow() : cur) + delta, last = S.idx.slots.length - 1;
    return Math.min(Math.max(n, 0), last);
  }
  function wire() {
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setTab(b.getAttribute('data-tab')); });
    $('q').addEventListener('input', function () { S.q = this.value; S.sel = null; renderFind(); });
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-open]') : null;
      if (b) { openStudent(b.getAttribute('data-open')); return; }
      if (e.target.id === 'backBtn') {
        S.sel = null; S.q = ''; $('q').value = '';        // clear the name too, otherwise the single match re-opens the same card
        try { history.replaceState(null, '', location.pathname + location.search + '#find'); } catch (x) { /* ignore */ }
        renderFind(); window.scrollTo(0, 0); return;
      }
      var go = e.target.closest ? e.target.closest('[data-go]') : null;
      if (go) { setTab(go.getAttribute('data-go')); window.scrollTo(0, 0); }
    });
    function rosterChange() { S.roster.shown = 50; renderRoster(); }
    $('rq').addEventListener('input', function () { S.roster.q = this.value; rosterChange(); });
    $('rCat').addEventListener('change', function () { S.roster.cat = this.value; rosterChange(); });
    $('rState').addEventListener('change', function () { S.roster.state = this.value; rosterChange(); });
    $('rSort').addEventListener('change', function () { S.roster.sort = this.value; rosterChange(); });
    $('rClear').addEventListener('click', function () {
      S.roster.q = ''; S.roster.cat = ''; S.roster.state = ''; S.roster.sort = 'name';
      $('rq').value = ''; $('rCat').value = ''; $('rState').value = ''; $('rSort').value = 'name';
      rosterChange();
    });
    $('homeLink').addEventListener('click', function (e) {
      e.preventDefault();
      try { history.replaceState(null, '', location.pathname + location.search); } catch (x) { /* ignore */ }
      setTab('home'); window.scrollTo(0, 0);
    });
    $('rMore').addEventListener('click', function () { S.roster.shown += 100; renderRoster(); });
    function browseChange(which) {
      var d = $('bDate').value, b = +$('bBlock').value, s = +$('bSec').value, i;
      if (which === 'date') { i = -1; for (var k = 0; k < S.idx.slots.length; k++) if (S.idx.slots[k].date === d) { i = k; break; } }
      else if (which === 'block') { i = findSlot(d, b, s); if (i < 0) i = findSlot(d, b, 1); }   // keep the chosen batch number under the new slot
      else i = findSlot(d, b, s);
      if (i >= 0) { S.browse.i = i; renderBrowse(); }
    }
    $('bDate').addEventListener('change', function () { browseChange('date'); });
    $('bBlock').addEventListener('change', function () { browseChange('block'); });
    $('bSec').addEventListener('change', function () { browseChange('sec'); });
    $('bNow').addEventListener('click', function () { S.browse.i = null; renderBrowse(); });
    $('bRefresh').addEventListener('click', function () {      // ask the server now instead of waiting for the next 20-second check
      var b = this; if (b.disabled) return; b.disabled = true; b.textContent = 'Refreshing…';
      poll().then(function () { if (S.tab === 'browse' && S.idx) renderBrowse(); })
        .then(function () { b.textContent = '\u21BB Updated ' + T.istClock(Date.now() + S.offset, true); setTimeout(function () { b.textContent = '\u21BB Refresh'; }, 2500); })
        .catch(function () { b.textContent = '\u21BB Refresh'; })
        .then(function () { b.disabled = false; });
    });
    $('pPrev').addEventListener('click', function () { S.proj.i = stepSlot(S.proj.i, -1); S.proj.page = 0; renderProj(); });
    $('pNext').addEventListener('click', function () { S.proj.i = stepSlot(S.proj.i, 1); S.proj.page = 0; renderProj(); });
    $('pLive').addEventListener('click', function () { S.proj.i = null; S.proj.page = 0; renderProj(); });
    $('proj').addEventListener('dblclick', function () { S.proj.paused = !S.proj.paused; });
    document.addEventListener('keydown', function (e) {
      if (!PROJECTOR || !S.snap || !S.idx) return;
      if (e.key === 'ArrowRight') $('pNext').click(); else if (e.key === 'ArrowLeft') $('pPrev').click();
      else if (e.key === 'l' || e.key === 'L') $('pLive').click(); else if (e.key === ' ') { S.proj.paused = !S.proj.paused; e.preventDefault(); }
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    window.addEventListener('online', poll);
  }

  function boot() {
    var fake = params.get('now');                       // testing aid: ?now=2026-10-21T15:55 (IST)
    if (fake) { var ms = Date.parse(fake + (fake.length <= 16 ? ':00' : '') + '+05:30'); if (!isNaN(ms)) { S.fixedNow = ms; S.offset = ms - Date.now(); } }
    if (PROJECTOR) { document.body.className = 'proj'; $('foot').hidden = true; }
    wire();
    try { S.deep = decodeURIComponent((location.hash || '').slice(1)); } catch (e) { S.deep = null; }
    var bm = /^rooms\/(\d{4}-\d{2}-\d{2})\/(\d+)\/(\d+)$/.exec(S.deep || '');
    if (!PROJECTOR && bm) { S.pendingBrowse = { date: bm[1], s: Number(bm[2]), sec: Number(bm[3]) }; S.deep = 'rooms'; }
    if (!PROJECTOR && S.deep && HASH_TAB[S.deep]) { S.tab = HASH_TAB[S.deep]; S.tabChosen = true; S.deep = null; applyTab(); render(); }   // refresh on a tab: reopen it
    loop();
    setInterval(function () { if (S.tab !== 'motions') render(); staleCheck(); }, 15000);
    setInterval(function () {
      if (PROJECTOR && S.idx && !S.proj.paused) { S.proj.page += 1; renderProj(); }
    }, ROTATE_S * 1000);
  }
  boot();
})();
