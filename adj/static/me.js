(function () {
  'use strict';
  var T = window.IDLTime, POLL = 30000, STALE = 120000;
  var P = new URLSearchParams(location.search), adj = P.get('adj') || '', code = P.get('t') || '';
  var S = { d: null, date: P.get('date') || null, offset: 0, lastOk: 0, fixed: false };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) { var c = arguments[i]; if (c == null) continue; p.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); } return p; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function now() { return Date.now() + S.offset; }
  function inMin(ms) { var m = Math.round(ms / 60000); return m < 1 ? 'less than a minute' : m === 1 ? '1 minute' : m < 90 ? m + ' minutes' : Math.round(m / 60) + ' hours'; }
  function msg(t) { $('app').hidden = true; $('loading').hidden = false; $('loading').textContent = t; }

  function classify(debs) {
    var t = now(), nextStart = null;
    debs.forEach(function (d) { if (d.startMs > t && (nextStart === null || d.startMs < nextStart)) nextStart = d.startMs; });
    return debs.map(function (d) { return d.startMs <= t && t < d.endMs ? 'live' : d.startMs === nextStart ? 'next' : d.endMs <= t ? 'past' : ''; });
  }

  function renderBand(debs, cls) {
    var box = clear($('band')), live = null, next = null, t = now();
    debs.forEach(function (d, i) { if (cls[i] === 'live' && !live) live = d; if (cls[i] === 'next' && !next) next = d; });
    var b;
    if (live) { b = el('div', 'band live'); add(b, add(el('div', 'txt'), el('b', null, 'Now: Round ' + live.round), live.time), el('div', 'big', 'Room ' + live.room)); }
    else if (next) { b = el('div', 'band next'); add(b, add(el('div', 'txt'), el('b', null, 'Next: starts in ' + inMin(next.startMs - t)), next.time + (next.round ? ', Round ' + next.round : '')), el('div', 'big', 'Room ' + next.room)); }
    else if (debs.length) { b = el('div', 'band done'); add(b, el('div', 'txt', 'Your debates for this day are finished.')); }
    if (b) box.appendChild(b);
  }

  function renderDebate(d, cls) {
    var a = el('article', 'deb ' + cls), tm = el('div', 'dtime');
    add(tm, el('b', null, d.time), el('span', null, 'Round ' + d.round + ', section ' + d.section));
    if (cls === 'live') add(tm.firstChild, el('span', 'tag', 'Now')); else if (cls === 'next') add(tm.firstChild, el('span', 'tag n', 'Next'));
    add(a, tm, el('div', 'droom', 'Room ' + d.room));
    var who = el('div', 'dwho');
    d.students.forEach(function (s) {
      var row = el('div'), n = el('span', s.absent ? 'absent' : null, s.name);
      add(row, n, s.side ? el('span', 'badge ' + (s.side === 'Prop' ? 'p' : 'o'), s.side === 'Prop' ? 'Prop (for)' : 'Opp (Against)') : null, s.absent ? el('span', 'badge x', 'absent') : null);
      who.appendChild(row);
    });
    add(a, who);
    add(a, el('div', 'dmeta', d.sidesVisible ? 'Block ' + d.block : 'Block ' + d.block + '. Sides are announced on the call.'));
    if (d.ballotUrl) {
      var l = el('a', 'ballot', 'Open ballot'); l.href = d.ballotUrl; l.target = '_blank'; l.rel = 'noopener noreferrer'; a.appendChild(l);
    } else {
      var why = d.ballotNote === 'walkover' ? 'Walkover: ' + d.students.filter(function (s) { return s.absent; }).map(function (s) { return s.name; }).join(', ') + ' was marked absent. No ballot button for a walkover.'
        : d.ballotNote === 'no-url' ? 'The ballot link is not set up yet. The organisers will share it.'
        : 'Ballot not ready. The host has not generated the ballot link for this debate yet.';
      a.appendChild(el('p', 'dnote', why));
    }
    return a;
  }

  function render() {
    var d = S.d;
    $('loading').hidden = true; $('app').hidden = false;
    $('hello').textContent = d.name;
    var days = clear($('days'));
    if (d.dates.length > 1) d.dates.forEach(function (x) {
      var p = x.label.split(' '), b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', x.iso === d.date ? 'true' : 'false');
      add(b, p[0], el('small', null, p[1] + ' ' + p[2]));
      b.addEventListener('click', function () { S.date = x.iso; load(); });
      days.appendChild(b);
    });
    $('rooms').textContent = d.date ? (d.rooms.length ? 'Your room' + (d.rooms.length > 1 ? 's' : '') + ' on ' + T.dayLabel(d.date) + ': ' + d.rooms.join(', ') : 'No room allocated to you on ' + T.dayLabel(d.date) + '.') : 'You have no rooms in the allocation yet.';
    var cls = classify(d.debates);
    renderBand(d.debates, cls);
    var list = clear($('list'));
    if (!d.debates.length && d.date) add(list, el('p', 'msg', 'No pairings for your rooms yet. They appear here as soon as the host makes them.'));
    d.debates.forEach(function (x, i) { list.appendChild(renderDebate(x, cls[i])); });
    var notes = $('notes'); clear(notes); notes.hidden = !d.notes.length;
    d.notes.forEach(function (n) { notes.appendChild(el('li', null, n)); });
    $('foot').textContent = 'Updated ' + T.istClock(S.lastOk + S.offset, true) + ' IST. This page refreshes by itself.';
  }

  function load() {
    var u = 'api/me?adj=' + encodeURIComponent(adj) + '&t=' + encodeURIComponent(code) + (S.date ? '&date=' + encodeURIComponent(S.date) : '');
    var t0 = Date.now();
    return fetch(u, { cache: 'no-store' }).then(function (r) {
      if (r.status === 403 || r.status === 404) { var e = new Error('invalid'); e.invalid = true; throw e; }
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      S.lastOk = Date.now(); if (!S.fixed) S.offset = d.now - (t0 + S.lastOk) / 2;
      if (!S.date) {            // first load: today if she/he judges today, else the next day, else the first
        var today = T.istIso(now()), ds = d.dates.map(function (x) { return x.iso; });
        var pick = ds.indexOf(today) >= 0 ? today : (ds.filter(function (x) { return x > today; })[0] || ds[0]);
        if (pick && pick !== d.date) { S.date = pick; return load(); }
      }
      S.d = d; $('warn').hidden = !d.stale; $('warn').textContent = d.stale ? 'The sheet could not be read just now. Showing the last copy.' : ''; render();
    }).catch(function (e) {
      if (e.invalid) msg('This link is not valid. Ask the organisers for your personal link.');
      else if (!S.d) msg('Cannot load your debates. Check your connection; this page will retry.');
    });
  }
  function tick() { if (S.d) render(); if (S.lastOk && Date.now() - S.lastOk > STALE) { $('warn').hidden = false; $('warn').textContent = 'Cannot reach the server. Showing the last copy from ' + T.istClock(S.lastOk + S.offset) + ' IST.'; } }

  var fake = P.get('now');           // testing aid: ?now=2026-10-21T15:45 (IST)
  if (fake) { var ms = Date.parse(fake + (fake.length <= 16 ? ':00' : '') + '+05:30'); if (!isNaN(ms)) { S.fixed = true; S.offset = ms - Date.now(); } }
  load(); setInterval(load, POLL); setInterval(tick, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
})();
