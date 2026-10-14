(function () {
  'use strict';
  var T = window.IDLTime, S = { d: null, date: null, offset: 0, q: '' };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) { var c = arguments[i]; if (c == null) continue; p.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); } return p; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }
  function norm(s) { s = String(s == null ? '' : s); if (s.normalize) s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }

  function renderDays() {
    var box = clear($('days'));
    S.d.dates.forEach(function (d) {
      var p = d.label.split(' '), b = el('button');
      b.type = 'button'; b.setAttribute('aria-pressed', d.iso === S.date ? 'true' : 'false');
      add(b, p[0], el('small', null, p[1] + ' ' + p[2]));
      b.addEventListener('click', function () { S.date = d.iso; render(); });
      box.appendChild(b);
    });
  }
  function renderSearch(out) {
    var toks = norm(S.q).split(' ').filter(Boolean), hits = [];
    S.d.names.forEach(function (n) {
      var k = norm(n); if (!toks.every(function (t) { return k.indexOf(t) >= 0; })) return;
      var days = [];
      S.d.dates.forEach(function (d) {
        var rooms = S.d.rooms.filter(function (r) { return (S.d.grid[d.iso][r] || []).some(function (x) { return norm(x) === k; }); });
        if (rooms.length) days.push(d.label + ': Room ' + rooms.join(', Room '));
      });
      hits.push({ n: n, days: days });
    });
    if (!hits.length) { add(out, el('p', 'msg', 'No adjudicator found with that name.')); return; }
    var ul = el('ul', 'hit');
    hits.slice(0, 20).forEach(function (h) { add(ul, add(el('li'), el('b', null, h.n), el('span', null, h.days.length ? h.days.join('. ') : 'No rooms in the grid yet.'))); });
    add(out, ul);
  }
  function render() {
    var out = clear($('out'));
    renderDays();
    if (norm(S.q).length >= 2) { renderSearch(out); return; }
    var g = S.d.grid[S.date] || {}, filled = 0;
    S.d.rooms.forEach(function (r) { if (g[r]) filled++; });
    add(out, el('p', 'sum', filled + ' of ' + S.d.rooms.length + ' rooms have an adjudicator on this day.'));
    var tb = el('table', 'tbl'), hr = el('tr');
    add(hr, el('th', null, 'Room'), el('th', null, 'Adjudicator'));
    add(tb, add(el('thead'), hr));
    var body = el('tbody');
    S.d.rooms.forEach(function (r) {
      var tr = el('tr', g[r] ? null : 'blank');
      add(tr, el('td', 'rm', String(r)), el('td', null, g[r] ? g[r].join(', ') : 'Not allocated yet'));
      body.appendChild(tr);
    });
    add(tb, body); out.appendChild(tb);
    $('foot').textContent = 'Allocation read from the sheet at ' + T.istClock(S.d.builtAt, true) + ' IST.';
  }
  function load() {
    return fetch('api/allocation', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('x'); return r.json(); }).then(function (d) {
      S.d = d; S.offset = d.now - Date.now();
      if (!S.date || !d.dates.some(function (x) { return x.iso === S.date; })) {
        var today = T.istIso(Date.now() + S.offset), pick = d.dates.filter(function (x) { return x.iso === today; })[0] || d.dates.filter(function (x) { return x.iso > today; })[0] || d.dates[0];
        S.date = pick && pick.iso;
      }
      $('loading').hidden = true; $('warn').hidden = !d.stale; $('warn').textContent = d.stale ? 'The sheet could not be read just now. Showing the last copy.' : '';
      if (!d.dates.length) { $('loading').hidden = false; $('loading').textContent = 'The Adj_Grid has no dates yet.'; return; }
      $('app').hidden = false; render();
    }).catch(function () { if (!S.d) { $('loading').hidden = false; $('loading').textContent = 'Cannot load the allocation. Check your connection and reload.'; } else { $('warn').hidden = false; $('warn').textContent = 'Cannot reach the server. Showing the last copy.'; } });
  }
  $('q').addEventListener('input', function () { S.q = this.value; if (S.d) render(); });
  load(); setInterval(load, 60000);
})();
