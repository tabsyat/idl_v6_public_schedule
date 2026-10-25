/**
 * snapshot.js - builds the ONE object the public site receives. This is the privacy boundary.
 *
 * Whitelist (nothing else is ever copied in):
 *   students : id, name, category, [state if SHOW_STATE], 3 planned slots
 *   debates  : date, block, section, room, round, walkover flag, absent student id, two student ids, sides flag
 * Never present: debate_id, token, adjudicator, key, time_made, ballot links.
 *
 * SIDES RULE: when sides_visible is false the two ids are written in alphabetical order of the students' names
 * (ties by id) and the sides flag is 0 - there is no other field, so nothing can hint who is Prop/Opp.
 * When visible, the order is [Prop, Opp] and the flag is 1.
 *
 * JUNIOR SIDES come from two places, both kept INTERNAL here and published only through exportStudents / exportDebates,
 * which ask a reveal(round, isoDate) rule (see sides.js) for every single side:
 *   student.sd  = pre-assigned sides from the Roster (side_R1..R3), student.sdd = the date used for the 3-day rule
 *   debate.jr/hm = the real [Prop, Opp] order of a Junior debate
 */
var T = require('../../shared/time');
var byNameThenId = require('../../shared/text').byNameThenId;

function build(input) {
  var cfg = input.config || { rooms: 30, blocks: [], dates: [] };
  var students = input.students, debates = input.debates, showState = !!input.showState;
  var warnings = [];

  // ---- blocks and dates actually in play (Config first, then anything seen in the data)
  var blockMap = {};
  function addBlock(b) { if (b && !blockMap[b.label]) blockMap[b.label] = { l: b.label, s: b.start, e: b.end, n: b.sections }; }
  cfg.blocks.forEach(addBlock);
  var datesSeen = {};
  cfg.dates.forEach(function (d) { datesSeen[d] = 1; });
  students.forEach(function (s) { s.plan.forEach(function (p) { if (p) { addBlock(p.block); datesSeen[p.date] = 1; } }); });
  debates.forEach(function (d) { addBlock(d.block); datesSeen[d.date] = 1; });
  var blocks = Object.keys(blockMap).map(function (k) { return blockMap[k]; }).sort(function (a, b) { return a.s - b.s || a.e - b.e; });
  var blockIdx = {};
  blocks.forEach(function (b, i) { blockIdx[b.l] = i; });
  var dates = Object.keys(datesSeen).sort();

  // ---- students (+ anyone who appears in a debate but not in the plan)
  var byId = {};
  var schools = [], schoolIdx = new Map(), noSchool = [];
  var badBatch = [];
  var outStudents = students.map(function (s) {
    byId[s.id] = s;
    // planned round = [date, blockIndex] or [date, blockIndex, batch] when the Roster gives a valid batch
    var o = { i: s.id, n: s.name, c: s.category, p: s.plan.map(function (p, k) {
      if (!p) return null;
      var bi = blockIdx[p.block.label], e = [p.date, bi];
      if (p.batch) {
        if (p.batch <= blocks[bi].n) e.push(p.batch);
        else badBatch.push(s.id + ' R' + (k + 1) + ' (batch ' + p.batch + ', ' + p.block.label + ' has ' + blocks[bi].n + ')');
      }
      return e;
    }) };
    if (showState && s.state) o.st = s.state;
    if (s.school) {                               // each school name is stored once; students point to it (scx is internal, see exportStudents)
      if (!schoolIdx.has(s.school)) { schoolIdx.set(s.school, schools.length); schools.push(s.school); }
      o.scx = schoolIdx.get(s.school);
    } else noSchool.push(s.id);
    return o;
  });
  if (badBatch.length) warnings.push(badBatch.length + ' Roster batch(es) are higher than the sections of their slot and were ignored (e.g. ' + badBatch.slice(0, 3).join('; ') + ').');
  if (schools.length && noSchool.length) warnings.push(noSchool.length + ' student(s) have no school in the Roster (e.g. ' + noSchool.slice(0, 3).join(', ') + ').');
  var unknown = 0;
  function ensure(id, name, cat) {
    if (byId[id]) return;
    unknown++;
    byId[id] = { id: id, name: name || id, category: cat || '' };
    outStudents.push({ i: id, n: name || id, c: cat || '', p: [null, null, null] });
  }

  // ---- debates
  var sorted = debates.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.block.start - b.block.start) || (a.section - b.section) || (a.room - b.room);
  });
  var hidden = 0, walkovers = 0, slotRoom = {}, studentSlot = {};
  function rosterRound(id, d) {            // which of the student's rounds (1-3) is planned on this debate's date and slot; 0 if none
    var st = id && byId[id]; if (!st || !st.plan) return 0;
    for (var k = 0; k < 3; k++) if (st.plan[k] && st.plan[k].date === d.date && st.plan[k].block.label === d.block.label) return k + 1;
    return 0;
  }
  var outDebates = sorted.map(function (d) {
    var solo = !d.propId || !d.oppId;          // solo speech: one student, no opponent (Juniors)
    if (d.propId) ensure(d.propId, d.propName, d.category); if (d.oppId) ensure(d.oppId, d.oppName, d.category);
    var A = d.propId ? { id: d.propId, name: byId[d.propId].name } : null, B = d.oppId ? { id: d.oppId, name: byId[d.oppId].name } : null;
    var m, hm = null;
    if (solo) m = [(A || B).id];
    else if (d.sidesVisible) { m = [A.id, B.id]; if (/^junior/i.test(d.category || '')) hm = [A, B].sort(byNameThenId).map(function (x) { return x.id; }); }
    else { m = [A, B].sort(byNameThenId).map(function (x) { return x.id; }); hidden++; }
    var rn = rosterRound(d.propId, d) || rosterRound(d.oppId, d) || (d.round >= 1 && d.round <= 3 ? d.round : 0);   // round of this debate: from the students' Roster plan (same date and slot), else the Debates column if it has one
    var o = { d: d.date, b: blockIdx[d.block.label], s: d.section, r: d.room, n: rn, m: m, sv: d.sidesVisible ? 1 : 0 };
    if (solo) {
      o.so = 1;
      if (d.sidesVisible) {      // the solo speaker's side: the Roster side for that round (Juniors), else the column the Desk used; revealed by exportDebates like any Junior side
        var rs = byId[m[0]] && byId[m[0]].sides ? byId[m[0]].sides[rn - 1] : '';
        o.ss = rs || (d.propId ? 'Prop' : 'Opp'); o.jr = 1; o.hm = m.slice();
      }
    }
    if (hm) { o.jr = 1; o.hm = hm; }          // internal only: exportDebates() removes these
    if (d.walkover) { o.w = 1; o.ab = d.absentId; walkovers++; }

    // data-quality warnings for the host (not sent to the public)
    var slot = d.date + '|' + d.block.label + '|' + d.section;
    var rk = slot + '|' + d.room;
    if (slotRoom[rk]) warnings.push('Room ' + d.room + ' is used twice in ' + T.dayLabel(d.date) + ', ' + d.block.label + ', section ' + d.section + ' (Debates rows ' + slotRoom[rk] + ' and ' + d.row + ').');
    slotRoom[rk] = d.row;
    [d.propId, d.oppId].forEach(function (id) {
      if (!id || (d.walkover && d.absentId === id)) return;
      var k = id + '|' + slot;
      if (studentSlot[k]) warnings.push(byId[id].name + ' (' + id + ') is in two debates in the same section (Debates rows ' + studentSlot[k] + ' and ' + d.row + ').');
      studentSlot[k] = d.row;
    });
    if (d.room > cfg.rooms) warnings.push('Debates row ' + d.row + ' uses room ' + d.room + ' but Config has ' + cfg.rooms + ' rooms.');
    if (d.section > d.block.sections) warnings.push('Debates row ' + d.row + ' uses section ' + d.section + ' but ' + d.block.label + ' only has ' + d.block.sections + '.');
    return o;
  });

  // ---- Junior sides from the Roster (internal; never exported as-is)
  var outById = {};
  outStudents.forEach(function (o) { outById[o.i] = o; });
  var sideDates = { 1: {}, 2: {}, 3: {}, nodate: {} }, sideHolders = 0, noSide = [], mismatch = [];
  students.forEach(function (s) {
    if (!s.sides) return;
    sideHolders++;
    var o = outById[s.id], dd = [null, null, null];
    o.sd = s.sides.slice();
    [1, 2, 3].forEach(function (n) {
      if (!s.sides[n - 1]) return;
      var iso = (s.plan[n - 1] && s.plan[n - 1].date) || null;       // the 3-day rule follows the Roster date only, never the Debates
      dd[n - 1] = iso;
      if (iso) sideDates[n][iso] = (sideDates[n][iso] || 0) + 1; else sideDates.nodate[n] = (sideDates.nodate[n] || 0) + 1;
    });
    o.sdd = dd;
  });
  if (sideHolders) {
    students.forEach(function (s) { if (/^junior/i.test(s.category || '') && !s.sides) noSide.push(s.id); });
    // rounds a Junior is planned in but has no side for
    var missing = [];
    students.forEach(function (s) { if (s.sides) [1, 2, 3].forEach(function (n) { if (s.plan[n - 1] && !s.sides[n - 1]) missing.push(s.id + ' R' + n); }); });
    if (noSide.length) warnings.push(noSide.length + ' Junior student(s) have no side in the Roster (e.g. ' + noSide.slice(0, 3).join(', ') + '); they will not see one.');
    if (missing.length) warnings.push(missing.length + ' Junior round(s) have a slot but no side in side_R1..R3 (e.g. ' + missing.slice(0, 3).join(', ') + ').');
  }
  // Roster side vs the actual Debates row
  var rosterSide = {};
  students.forEach(function (s) { if (s.sides) rosterSide[s.id] = s.sides; });
  sorted.forEach(function (d) {
    if (!/^junior/i.test(d.category || '') || !d.propId || !d.oppId) return;
    var a = rosterSide[d.propId], b = rosterSide[d.oppId];
    var ra = rosterRound(d.propId, d), rb = rosterRound(d.oppId, d);
    if ((a && ra && a[ra - 1] && a[ra - 1] !== 'Prop') || (b && rb && b[rb - 1] && b[rb - 1] !== 'Opp'))
      mismatch.push(d.propName + ' (' + d.propId + ') / ' + d.oppName + ' (' + d.oppId + ')');
  });
  if (mismatch.length) warnings.unshift(mismatch.length + ' Junior debate(s) do not match the Roster sides (Debates has Prop/Opp the other way round), e.g. ' + mismatch.slice(0, 3).join('; ') + '. Students are shown the Debates version once paired.');

  // ---- plan warnings
  var unplaced = 0, outOfOrder = [];
  students.forEach(function (s) {
    unplaced += s.plan.filter(function (p) { return !p; }).length;
    var ds = s.plan.filter(Boolean).map(function (p) { return p.date; });
    for (var i = 1; i < ds.length; i++) if (ds[i] < ds[i - 1]) { outOfOrder.push(s.id); break; }
  });
  if (unplaced) warnings.unshift(unplaced + ' planned round(s) have no slot yet; those students see "Slot to be confirmed".');
  if (outOfOrder.length) warnings.unshift(outOfOrder.length + ' student(s) have rounds planned out of date order (e.g. ' + outOfOrder.slice(0, 3).join(', ') + '). The page shows them as planned.');
  if (unknown) warnings.push(unknown + ' student(s) in Debates are not in the slot plan; they were added from the Debates names.');

  // dates whose release time can change what is published (Junior debates + roster side dates)
  var rel = {};
  [1, 2, 3].forEach(function (n) { Object.keys(sideDates[n]).forEach(function (iso) { rel[iso] = 1; }); });
  outDebates.forEach(function (o) { if (o.jr) rel[o.d] = 1; });
  var snapshot = {
    cfg: { rooms: cfg.rooms, blocks: blocks, dates: dates },
    students: outStudents,
    debates: outDebates,
    sideDates: sideDates,                     // internal (host summary)
    releaseDates: Object.keys(rel).sort(),    // internal (when the public data can change by itself)
    schools: schools                          // internal; published only while the host's School switch is on
  };
  var stats = { students: students.length, debates: outDebates.length, walkovers: walkovers, hiddenSides: hidden, unplacedRounds: unplaced, outOfOrder: outOfOrder.length };
  return { snapshot: snapshot, warnings: warnings, stats: stats };
}

/** reveal: function (round, isoDate) => bool (see sides.js). A plain boolean means "all or none". */
function asRule(reveal) { return typeof reveal === 'function' ? reveal : function () { return !!reveal; }; }

/**
 * Public view of the debates. Junior debates carry their real [Prop, Opp] order internally (jr, hm); a Junior debate is
 * published as revealed only when reveal(round, date) says so. Otherwise it goes out exactly like a hidden-side debate:
 * alphabetical order, sv 0. jr/hm are never exported.
 */
function exportDebates(list, reveal) {
  var rule = asRule(reveal);
  return list.map(function (d) {
    var o = {};
    Object.keys(d).forEach(function (k) { if (k !== 'jr' && k !== 'hm' && k !== 'ss') o[k] = d[k]; });
    if (d.jr && !rule(d.n, d.d)) { o.m = d.hm.slice(); o.sv = 0; }
    else if (d.ss) o.ss = d.ss;                // solo speaker's side, only once it is revealed
    return o;
  });
}

/**
 * Public view of the students. Pre-assigned Junior sides (sd) are published, per round, only when reveal(round, date)
 * says so; sd/sdd are never exported as stored. A student with nothing revealed carries no sd at all.
 * School (scx -> sc) is published only when opts.school is true (the host switch); otherwise no trace of it goes out.
 */
function exportStudents(list, reveal, opts) {
  var rule = asRule(reveal), school = !!(opts && opts.school);
  return list.map(function (s) {
    if (!s.sd && s.scx === undefined) return s;
    var o = {};
    Object.keys(s).forEach(function (k) { if (k !== 'sd' && k !== 'sdd' && k !== 'scx') o[k] = s[k]; });
    if (school && s.scx !== undefined) o.sc = s.scx;          // index into the published schools list
    if (!s.sd) return o;
    var out = [null, null, null], any = false;
    for (var n = 0; n < 3; n++) if (s.sd[n] && rule(n + 1, s.sdd ? s.sdd[n] : null)) { out[n] = s.sd[n]; any = true; }
    if (any) o.sd = out;
    return o;
  });
}

module.exports = { build: build, exportDebates: exportDebates, exportStudents: exportStudents };
