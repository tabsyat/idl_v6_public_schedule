(function () {
  'use strict';
  var base = location.pathname.replace(/\/$/, '');
  function $(id) { return document.getElementById(id); }
  function api(path, body) {
    return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { j.httpOk = r.ok; return j; }); });
  }
  function clock(ms) { var d = new Date(ms + 330 * 60000); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ':' + ('0' + d.getUTCSeconds()).slice(-2) + ' IST'; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function showSides(s) {
    var info = s.sidesInfo; if (!info) return;
    $('swSidesAuto').checked = !!s.sidesAuto;
    $('sAutoLabel').textContent = 'Reveal automatically, ' + plural(info.lead, 'day') + ' before each student\'s round day';
    info.rounds.forEach(function (r) {
      $('swSidesR' + r.n).checked = !!s.sidesAll['r' + r.n];
      var t;
      if (!r.total) t = 'No Junior has a side for this round in the Roster.';
      else if (r.override) t = 'Showing to all ' + r.total + ' Juniors (ignoring the automatic rule).';
      else {
        t = 'Visible to ' + r.revealed + ' of ' + r.total + ' Juniors now.';
        if (r.revealed < r.total) t += r.next ? ' Next: ' + plural(r.nextCount, 'student') + ' on ' + fmtIst(r.next) + '.' : (s.sidesAuto ? '' : ' Automatic reveal is off.');
      }
      $('sInfo' + r.n).textContent = t;
    });
  }
  function show(s) {
    $('swSlots').checked = s.slots; $('swPairings').checked = s.pairings; $('swRoster').checked = !!s.roster; $('swSchool').checked = !!s.school; $('swBatchOnly').checked = !!s.batchOnly; $('swMAuto').checked = s.motionsAuto !== false;
    showSides(s);
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
  sw('swSlots', 'slots'); sw('swPairings', 'pairings'); sw('swRoster', 'roster'); sw('swSchool', 'school'); sw('swBatchOnly', 'batchOnly');
  function sideSw(id, body) {
    $(id).addEventListener('change', function () {
      $('gmsg').className = 'status'; $('gmsg').textContent = 'Saving…';
      api('/switch', body(this.checked)).then(function (s) { show(s); $('gmsg').textContent = 'Saved. Students see it within a minute.'; })
        .catch(function () { $('gmsg').className = 'status err'; $('gmsg').textContent = 'Could not save. Try again.'; });
    });
  }
  sideSw('swSidesAuto', function (on) { return { sidesAuto: on }; });
  [1, 2, 3].forEach(function (n) { sideSw('swSidesR' + n, function (on) { var a = {}; a['r' + n] = on; return { sidesAll: a }; }); });
  $('swMAuto').addEventListener('change', function () {
    var on = this.checked; $('mmsg').className = 'status'; $('mmsg').textContent = 'Saving…';
    api('/switch', { motionsAuto: on }).then(function () { return api('/motions'); }).then(function (v) {
      v.dates.forEach(function (d) { if (days[d.d]) refreshDay(v, d, false); }); $('mmsg').textContent = on ? 'Automatic release is on.' : 'Automatic release is off. Release dates yourself.';
    }).catch(function () { $('mmsg').className = 'status err'; $('mmsg').textContent = 'Could not save. Try again.'; });
  });

  // ---------------------------------------------------------------- motions
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtIst(ms) {
    var d = new Date(ms + 330 * 60000), h = d.getUTCHours(), ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ', ' + h12 + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ' ' + ap + ' IST';
  }
  function toInput(ms) { return new Date(ms + 330 * 60000).toISOString().slice(0, 16); }
  function fromInput(v) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 330 * 60000 : null; }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var days = {};            // iso -> { sum, state, warn, ta: {cat: textarea}, input, msg, hint }
  var cats = [];

  function mpost(path, body) {
    return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not save.'); return j; }); });
  }
  function refreshDay(v, info, writeText) {
    var x = days[info.d];
    var label = info.state === 'released' ? 'Released' : info.state === 'held' ? 'On hold: students cannot see it' : info.state === 'manual' ? 'Not visible: tick "Visible to students" to show it' : 'Scheduled for ' + fmtIst(info.eff);
    if (info.state === 'released' && info.at != null && info.at !== info.def) label += ' (since ' + fmtIst(info.eff) + ')';
    x.state.textContent = label; x.state.className = 'mstate ' + info.state;
    var missing = cats.filter(function (c) { return !info.m[c]; });
    var soon = info.state === 'released' || (info.state === 'scheduled' && info.eff - v.now < 36 * 3600000);
    if (info.state === 'manual') soon = false;
    x.warn.textContent = missing.length && soon ? 'Missing: ' + missing.join(', ') : (missing.length ? info.filled + ' of ' + cats.length + ' entered' : '');
    x.hint.textContent = (v.auto === false && info.at == null ? 'Automatic time (if you turn it on): ' : 'Default: ') + fmtIst(info.def) + (info.at != null && info.at !== info.def ? '. You set a different time for this date.' : '.');
    x.input.value = toInput(info.eff != null ? info.eff : info.def);
    x.chk.checked = info.state === 'released';
    if (writeText) cats.forEach(function (c) { x.ta[c].value = info.m[c] || ''; });
  }
  function buildMotions(v) {
    var box = $('mdays'); box.textContent = ''; days = {}; cats = v.cats;
    v.dates.forEach(function (info) {
      var det = mk('details', 'mday'), sum = mk('summary');
      var x = { ta: {} };
      x.state = mk('span', 'mstate'); x.warn = mk('span', 'mwarn');
      sum.appendChild(mk('b', null, info.label)); sum.appendChild(x.state); sum.appendChild(x.warn); det.appendChild(sum);
      var body = mk('div', 'mbody');
      var vis = mk('label', 'mvis'); x.chk = mk('input'); x.chk.type = 'checkbox';
      vis.appendChild(x.chk); vis.appendChild(mk('span', null, 'Visible to students'));
      body.appendChild(vis);
      x.chk.addEventListener('change', function () {
        var want = x.chk.checked;
        if (want && !confirm('Show the ' + info.label + ' motions to students now?')) { x.chk.checked = false; return; }
        release({ action: want ? 'now' : 'hold' }, want ? 'Visible. Students see it within a minute.' : 'Hidden. Students cannot see these motions.');
      });
      v.cats.forEach(function (c) {
        var id = 'ta-' + info.d + '-' + c, lab = mk('label', null, c + ' motion'); lab.setAttribute('for', id);
        var ta = mk('textarea'); ta.id = id; ta.maxLength = 1500; ta.rows = 3; ta.value = info.m[c] || '';
        x.ta[c] = ta; body.appendChild(lab); body.appendChild(ta);
      });
      var row = mk('div', 'row'), save = mk('button', null, 'Save motions'); x.msg = mk('span', 'mmini');
      save.addEventListener('click', function () {
        var m = {}; cats.forEach(function (c) { m[c] = x.ta[c].value; });
        save.disabled = true; x.msg.textContent = 'Saving…';
        mpost('/motions', { date: info.d, motions: m }).then(function (nv) {
          nv.dates.forEach(function (d) { if (d.d === info.d) refreshDay(nv, d, true); });
          x.msg.textContent = 'Saved at ' + fmtIst(Date.now()).replace(/^\d+ \w+, /, '');
        }).catch(function (e) { x.msg.textContent = e.message; }).then(function () { save.disabled = false; });
      });
      row.appendChild(save); row.appendChild(x.msg); body.appendChild(row);
      var rel = mk('div', 'mrel'); rel.appendChild(mk('span', 'lab', 'Optional: release at a set time (IST)'));
      x.input = mk('input'); x.input.type = 'datetime-local';
      var r2 = mk('div', 'row'); r2.appendChild(x.input);
      function act(b, label, cls, fn) { var e = mk('button', cls, label); e.addEventListener('click', fn); r2.appendChild(e); return e; }
      function release(body2, okText) {
        return mpost('/motions/release', Object.assign({ date: info.d }, body2)).then(function (nv) {
          nv.dates.forEach(function (d) { if (d.d === info.d) refreshDay(nv, d, false); }); x.msg.textContent = okText;
        }).catch(function (e) { x.msg.textContent = e.message; api('/motions').then(function (nv) { nv.dates.forEach(function (d) { if (d.d === info.d) refreshDay(nv, d, false); }); }); });
      }
      act(null, 'Set time', 'alt', function () { var at = fromInput(x.input.value); if (at == null) { x.msg.textContent = 'Pick a date and time first.'; return; } release({ action: 'set', at: at }, 'Release time saved.'); });
      act(null, 'Use default', 'alt', function () { release({ action: 'default' }, 'Back to the automatic time.'); });
      rel.appendChild(r2); x.hint = mk('p', 'mmini'); rel.appendChild(x.hint); body.appendChild(rel);
      det.appendChild(body); box.appendChild(det);
      days[info.d] = x; refreshDay(v, info, true);
    });
  }
  function loadMotions() {
    return api('/motions').then(function (v) { if (!v.dates) throw new Error('bad'); buildMotions(v); })
      .catch(function () { $('mmsg').className = 'status err'; $('mmsg').textContent = 'Could not load the motions.'; });
  }
  setInterval(function () {                       // keep the status lines current (never touches typed text)
    api('/motions').then(function (v) { if (v.dates) v.dates.forEach(function (d) { if (days[d.d]) refreshDay(v, d, false); }); }).catch(function () {});
  }, 30000);

  // ---------------------------------------------------------------- backup / restore
  $('backup').setAttribute('href', base + '/backup');
  $('restoreFile').addEventListener('change', function () {
    var f = this.files && this.files[0], inp = this; if (!f) return;
    var msg = $('bmsg'); msg.className = 'status';
    f.text().then(function (txt) {
      var obj; try { obj = JSON.parse(txt); } catch (e) { throw new Error('That file is not a valid backup.'); }
      if (!confirm('Restore from "' + f.name + '"? This replaces the switches, all motions and release times with what is in the file.')) return null;
      msg.textContent = 'Restoring…';
      return mpost('/restore', obj).then(function (s) { show(s); buildMotions(s.motions); msg.textContent = 'Restored.'; });
    }).catch(function (e) { msg.className = 'status err'; msg.textContent = e.message; })
      .then(function () { inp.value = ''; });
  });
  loadMotions();
  api('/status').then(show);
})();
