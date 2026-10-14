(function () {
  'use strict';
  var base = location.pathname.replace(/\/$/, '');
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  $('csv').href = base + '/links.csv';
  function copy(text, btn) {
    function done() { var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() { var t = el('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ } document.body.removeChild(t); }
  }
  fetch(base + '/data', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
    var w = $('warnings'); (d.warnings || []).forEach(function (t) { w.appendChild(el('li', null, t)); });
    var list = $('list'); list.textContent = '';
    if (!d.links.length) { list.appendChild(el('p', 'msg', 'No adjudicators found. Fill the Adj_Grid tab first.')); return; }
    d.links.forEach(function (l) {
      var row = el('div', 'lk'), b = el('button', null, 'Copy link'), o = el('a', 'btn', 'Open');
      b.type = 'button'; b.addEventListener('click', function () { copy(l.url, b); });
      o.href = l.url; o.target = '_blank'; o.rel = 'noopener';
      row.appendChild(el('span', 'nm', l.name)); row.appendChild(b); row.appendChild(o); row.appendChild(el('span', 'url', l.url));
      list.appendChild(row);
    });
  }).catch(function () { $('list').textContent = 'Could not load the links.'; });
})();
