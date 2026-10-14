(function () {
  'use strict';
  var base = location.pathname.replace(/\/$/, '');
  function $(id) { return document.getElementById(id); }
  function api(path, body) {
    return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { j.httpOk = r.ok; return j; }); });
  }
  function clock(ms) { var d = new Date(ms + 330 * 60000); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ':' + ('0' + d.getUTCSeconds()).slice(-2) + ' IST'; }
  function show(s) {
    $('swSlots').checked = s.slots; $('swPairings').checked = s.pairings; $('swRoster').checked = !!s.roster; $('swSides').checked = !!s.sides;
    var f = $('facts'); f.textContent = '';
    function row(k, v) { var a = document.createElement('dt'), b = document.createElement('dd'); a.textContent = k; b.textContent = v; f.appendChild(a); f.appendChild(b); }
    row('Last refreshed', s.builtAt ? clock(s.builtAt) : 'never');
    if (s.stats) { row('Students', s.stats.students); row('Debates published', s.stats.debates); row('Walkovers', s.stats.walkovers); row('Middle/Senior debates, sides hidden', s.stats.hiddenSides); }
    row('Data source', s.source + ' (slot tab: ' + s.slotTab + ')');
    var w = $('warnings'); w.textContent = '';
    var items = (s.warnings || []);
    if (!items.length) { var ok = document.createElement('li'); ok.className = 'ok'; ok.textContent = s.builtAt ? 'Nothing to flag.' : 'Refresh to run the checks.'; w.appendChild(ok); }
    items.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; w.appendChild(li); });
    if (s.lastError) { $('rmsg').className = 'status err'; $('rmsg').textContent = 'Last refresh failed at ' + clock(s.lastError.at) + ': ' + s.lastError.message + '. The public page still shows the previous data.'; }
  }
  $('refresh').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Refreshing…'; $('rmsg').className = 'status'; $('rmsg').textContent = '';
    api('/refresh', {}).then(function (s) {
      show(s);
      if (!s.httpOk) { $('rmsg').className = 'status err'; $('rmsg').textContent = 'Refresh failed: ' + (s.error || 'unknown error') + '. The public page still shows the previous data.'; }
      else $('rmsg').textContent = 'Published at ' + clock(Date.now()) + '. Students see it within a minute.';
    }).catch(function () { $('rmsg').className = 'status err'; $('rmsg').textContent = 'Could not reach the server.'; })
      .then(function () { b.disabled = false; b.textContent = 'Refresh from sheet'; });
  });
  function sw(id, key) {
    $(id).addEventListener('change', function () {
      var body = {}; body[key] = this.checked; $('smsg').className = 'status'; $('smsg').textContent = 'Saving…';
      api('/switch', body).then(function (s) { show(s); $('smsg').textContent = 'Saved. Students see it within a minute.'; })
        .catch(function () { $('smsg').className = 'status err'; $('smsg').textContent = 'Could not save. Try again.'; });
    });
  }
  sw('swSlots', 'slots'); sw('swPairings', 'pairings'); sw('swRoster', 'roster'); sw('swSides', 'sides');
  api('/status').then(show);
})();
