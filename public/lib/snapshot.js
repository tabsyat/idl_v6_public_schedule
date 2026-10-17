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
  var outStudents = students.map(function (s) {
    byId[s.id] = s;
    var o = { i: s.id, n: s.name, c: s.category, p: s.plan.map(function (p) { return p ? [p.date, blockIdx[p.block.label]] : null; }) };
    if (showState && s.state) o.st = s.state;
    if (s.school) {                               // each school name is stored once; students point to it (scx is internal, see exportStudents)
      if (!schoolIdx.has(s.school)) { schoolIdx.set(s.school, schools.length); schools.push(s.school); }
      o.scx = schoolIdx.get(s.school);
    } else noSchool.push(s.id);
    return o;
  });
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
  var hidden = 0, walkovers = 0, slotRoom = {}, studentSlot = {}, studentRound = {};
  var outDebates = sorted.map(function (d) {
    ensure(d.propId, d.propName, d.category); ensure(d.oppId, d.oppName, d.category);
    var A = { id: d.propId, name: byId[d.propId].name }, B = { id: d.oppId, name: byId[d.oppId].name };
    var m, hm = null;
    if (d.sidesVisible) { m = [A.id, B.id]; if (/^junior/i.test(d.category || '')) hm = [A, B].sort(byNameThenId).map(function (x) { return x.id; }); }
    else { m = [A, B].sort(byNameThenId).map(function (x) { return x.id; }); hidden++; }
    var o = { d: d.date, b: blockIdx[d.block.label], s: d.section, r: d.room, n: d.round, m: m, sv: d.sidesVisible ? 1 : 0 };
    if (hm) { o.jr = 1; o.hm = hm; }          // internal only: exportDebates() removes these
    if (d.walkover) { o.w = 1; o.ab = d.absentId; walkovers++; }

    // data-quality warnings for the host (not sent to the public)
    var slot = d.date + '|' + d.block.label + '|' + d.section;
    var rk = slot + '|' + d.room;
    if (slotRoom[rk]) warnings.push('Room ' + d.room + ' is used twice in ' + T.dayLabel(d.date) + ', ' + d.block.label + ', section ' + d.section + ' (Debates rows ' + slotRoom[rk] + ' and ' + d.row + ').');
    slotRoom[rk] = d.row;
    [d.propId, d.oppId].forEach(function (id) {
      if (d.walkover && d.absentId === id) return;
      var k = id + '|' + slot, rr = id + '|R' + d.round;
      if (studentSlot[k]) warnings.push(byId[id].name + ' (' + id + ') is in two debates in the same section (Debates rows ' + studentSlot[k] + ' and ' + d.row + ').');
      studentSlot[k] = d.row;
      if (studentRound[rr]) warnings.push(byId[id].name + ' (' + id + ') has two active debates for R' + d.round + ' (Debates rows ' + studentRound[rr] + ' and ' + d.row + ').');
      studentRound[rr] = d.row;
    });
    if (d.room > cfg.rooms) warnings.push('Debates row ' + d.row + ' uses room ' + d.room + ' but Config has ' + cfg.rooms + ' rooms.');
    if (d.section > d.block.sections) warnings.push('Debates row ' + d.row + ' uses section ' + d.section + ' but ' + d.block.label + ' only has ' + d.block.sections + '.');
    return o;
  });

  // ---- Junior sides from the Roster (internal; never exported as-is)
  var debDate = {}, outById = {};
  outStudents.forEach(function (o) { outById[o.i] = o; });
  sorted.forEach(function (d) {
    [d.propId, d.oppId].forEach(function (id) { if (!(d.walkover && d.absentId === id)) debDate[id + '|' + d.round] = d.date; });
  });
  var sideDates = { 1: {}, 2: {}, 3: {}, nodate: {} }, sideHolders = 0, noSide = [], mismatch = [];
  students.forEach(function (s) {
    if (!s.sides) return;
    sideHolders++;
    var o = outById[s.id], dd = [null, null, null];
    o.sd = s.sides.slice();
    [1, 2, 3].forEach(function (n) {
      if (!s.sides[n - 1]) return;
      var iso = debDate[s.id + '|' + n] || (s.plan[n - 1] && s.plan[n - 1].date) || null;
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
    if (!/^junior/i.test(d.category || '')) return;
    var a = rosterSide[d.propId], b = rosterSide[d.oppId];
    if ((a && a[d.round - 1] && a[d.round - 1] !== 'Prop') || (b && b[d.round - 1] && b[d.round - 1] !== 'Opp'))
      mismatch.push(d.propName + ' (' + d.propId + ') / ' + d.oppName + ' (' + d.oppId + ') R' + d.round);
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
    Object.keys(d).forEach(function (k) { if (k !== 'jr' && k !== 'hm') o[k] = d[k]; });
    if (d.jr && !rule(d.n, d.d)) { o.m = d.hm.slice(); o.sv = 0; }
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
