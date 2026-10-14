/**
 * Pairing.gs - pure pairing logic (no Sheets calls). Works in Apps Script and in Node tests.
 *
 * A "history" for a student is { opp: {id:true}, sides: ['P','O',...], rounds: {1:true,...} }
 * Side rule ("second-debate lock"): after exactly one debate the next side is forced to the opposite;
 * after two debates on the same side the third is forced to the opposite; otherwise free.
 */
function forcedSide_(h) {
  var s = (h && h.sides) || [];
  if (s.length === 1) return s[0] === 'P' ? 'O' : 'P';
  if (s.length === 2 && s[0] === s[1]) return s[0] === 'P' ? 'O' : 'P';
  return null;
}

function validPair_(a, b, hist) {
  var ha = hist[a.id] || { opp: {}, sides: [] }, hb = hist[b.id] || { opp: {}, sides: [] };
  if (ha.opp[b.id] || hb.opp[a.id]) return false;          // already met
  var fa = forcedSide_(ha), fb = forcedSide_(hb);
  if (fa && fb && fa === fb) return false;                  // both need the same side
  return true;
}

function mulberry_(seed) {
  var a = seed >>> 0;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Max-cardinality matching (Edmonds blossom), starting from a given partial matching. */
function augmentMatching_(n, g, match) {
  var p, base, used, blossom, q;
  function lca(a, b) {
    var seen = [], i;
    for (i = 0; i < n; i++) seen[i] = false;
    for (;;) { a = base[a]; seen[a] = true; if (match[a] === -1) break; a = p[match[a]]; }
    for (;;) { b = base[b]; if (seen[b]) return b; b = p[match[b]]; }
  }
  function markPath(v, b, child) {
    while (base[v] !== b) {
      blossom[base[v]] = blossom[base[match[v]]] = true;
      p[v] = child; child = match[v]; v = p[match[v]];
    }
  }
  function findPath(root) {
    var i;
    used = []; p = []; base = [];
    for (i = 0; i < n; i++) { used[i] = false; p[i] = -1; base[i] = i; }
    used[root] = true; q = [root];
    var qh = 0;
    while (qh < q.length) {
      var v = q[qh++];
      for (var k = 0; k < g[v].length; k++) {
        var to = g[v][k];
        if (base[v] === base[to] || match[v] === to) continue;
        if (to === root || (match[to] !== -1 && p[match[to]] !== -1)) {
          var cb = lca(v, to);
          blossom = [];
          for (i = 0; i < n; i++) blossom[i] = false;
          markPath(v, cb, to); markPath(to, cb, v);
          for (i = 0; i < n; i++) if (blossom[base[i]]) { base[i] = cb; if (!used[i]) { used[i] = true; q.push(i); } }
        } else if (p[to] === -1) {
          p[to] = v;
          if (match[to] === -1) return to;
          used[match[to]] = true; q.push(match[to]);
        }
      }
    }
    return -1;
  }
  for (var i = 0; i < n; i++) {
    if (match[i] !== -1) continue;
    var v = findPath(i);
    while (v !== -1) { var pv = p[v], ppv = match[pv]; match[v] = pv; match[pv] = v; v = ppv; }
  }
}

/**
 * Pair one group (same category, same owed round).
 * students: [{id,name,state}]; hist: {id: history}. rng: function returning [0,1).
 * Returns { pairs:[{prop,opp}], waiting:[{id,reason}], stats:{n,forcedP,forcedO,free,pairs} }
 */
function pairGroup_(students, hist, rng) {
  rng = rng || Math.random;
  var n = students.length, i, j;
  var g = [], same = [];
  for (i = 0; i < n; i++) { g[i] = []; same[i] = {}; }
  for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
    if (validPair_(students[i], students[j], hist)) {
      g[i].push(j); g[j].push(i);
      if (students[i].state && students[i].state === students[j].state) { same[i][j] = true; same[j][i] = true; }
    }
  }
  var match = []; for (i = 0; i < n; i++) match[i] = -1;
  // 1) greedy, same state first, scarcest students first
  var order = []; for (i = 0; i < n; i++) order.push(i);
  order.sort(function (a, b) { return (g[a].length - g[b].length) || (rng() - 0.5); });
  order.forEach(function (a) {
    if (match[a] !== -1) return;
    var best = -1, bs = -1;
    g[a].forEach(function (b) {
      if (match[b] !== -1) return;
      var s = (same[a][b] ? 1000 : 0) - g[b].length + rng() * 0.5;
      if (s > bs) { bs = s; best = b; }
    });
    if (best !== -1) { match[a] = best; match[best] = a; }
  });
  // 2) make the matching as large as possible (never lowers the pair count)
  augmentMatching_(n, g, match);
  // 3) local swaps to raise same-state pairs without losing any pair
  var improved = true, guard = 0;
  function isEdge(a, b) { return g[a].indexOf(b) !== -1; }
  while (improved && guard++ < 20) {
    improved = false;
    var ps = [];
    for (i = 0; i < n; i++) if (match[i] > i) ps.push([i, match[i]]);
    for (var x = 0; x < ps.length; x++) for (var y = x + 1; y < ps.length; y++) {
      var a = ps[x][0], b = ps[x][1], c = ps[y][0], d = ps[y][1];
      var cur = (same[a][b] ? 1 : 0) + (same[c][d] ? 1 : 0);
      var opts = [[a, c, b, d], [a, d, b, c]];
      for (var o = 0; o < 2; o++) {
        var p1 = opts[o][0], p2 = opts[o][1], q1 = opts[o][2], q2 = opts[o][3];
        if (isEdge(p1, p2) && isEdge(q1, q2)) {
          var sc = (same[p1][p2] ? 1 : 0) + (same[q1][q2] ? 1 : 0);
          if (sc > cur) { match[p1] = p2; match[p2] = p1; match[q1] = q2; match[q2] = q1; improved = true; break; }
        }
      }
      if (improved) break;
    }
  }
  // 4) assign sides
  function propCount(s) { var h = hist[s.id]; return h ? h.sides.filter(function (z) { return z === 'P'; }).length : 0; }
  var pairs = [], waiting = [], forcedP = 0, forcedO = 0;
  for (i = 0; i < n; i++) {
    var f = forcedSide_(hist[students[i].id]); if (f === 'P') forcedP++; else if (f === 'O') forcedO++;
    if (match[i] === -1) {
      var why = g[i].length === 0 ? 'no valid opponent present' : 'odd head-count / no free valid opponent';
      if (f) why += ' (needs ' + (f === 'P' ? 'Prop' : 'Opp') + ')';
      waiting.push({ id: students[i].id, reason: why });
    } else if (match[i] > i) {
      var A = students[i], B = students[match[i]], fa = forcedSide_(hist[A.id]), fb = forcedSide_(hist[B.id]), propFirst;
      if (fa === 'P' || fb === 'O') propFirst = true;
      else if (fa === 'O' || fb === 'P') propFirst = false;
      else { var pa = propCount(A), pb = propCount(B); propFirst = pa < pb ? true : pa > pb ? false : rng() < 0.5; }
      pairs.push(propFirst ? { prop: A, opp: B } : { prop: B, opp: A });
    }
  }
  return { pairs: pairs, waiting: waiting, stats: { n: n, forcedP: forcedP, forcedO: forcedO, free: n - forcedP - forcedO, pairs: pairs.length } };
}

/** Build histories from Debates rows. rows: [{prop,opp,round,status,absent}] (status ACTIVE|WALKOVER|DISSOLVED) */
function buildHistory_(rows) {
  var hist = {};
  function get(id) { return hist[id] || (hist[id] = { opp: {}, sides: [], rounds: {} }); }
  rows.forEach(function (r) {
    if (r.status !== 'ACTIVE' && r.status !== 'WALKOVER') return;
    var pa = get(r.prop), oa = get(r.opp);
    var propPlayed = !(r.status === 'WALKOVER' && r.absent === r.prop);
    var oppPlayed = !(r.status === 'WALKOVER' && r.absent === r.opp);
    if (propPlayed) { pa.sides.push('P'); pa.rounds[r.round] = true; pa.opp[r.opp] = true; }
    if (oppPlayed) { oa.sides.push('O'); oa.rounds[r.round] = true; oa.opp[r.prop] = true; }
    // an absent student still counts as having been drawn against this opponent
    if (!propPlayed) pa.opp[r.opp] = true;
    if (!oppPlayed) oa.opp[r.prop] = true;
  });
  return hist;
}
