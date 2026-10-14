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
  var outStudents = students.map(function (s) {
    byId[s.id] = s;
    var o = { i: s.id, n: s.name, c: s.category, p: s.plan.map(function (p) { return p ? [p.date, blockIdx[p.block.label]] : null; }) };
    if (showState && s.state) o.st = s.state;
    return o;
  });
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
    var m;
    if (d.sidesVisible) m = [A.id, B.id];
    else { m = [A, B].sort(byNameThenId).map(function (x) { return x.id; }); hidden++; }
    var o = { d: d.date, b: blockIdx[d.block.label], s: d.section, r: d.room, n: d.round, m: m, sv: d.sidesVisible ? 1 : 0 };
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

  var snapshot = {
    cfg: { rooms: cfg.rooms, blocks: blocks, dates: dates },
    students: outStudents,
    debates: outDebates
  };
  var stats = { students: students.length, debates: outDebates.length, walkovers: walkovers, hiddenSides: hidden, unplacedRounds: unplaced, outOfOrder: outOfOrder.length };
  return { snapshot: snapshot, warnings: warnings, stats: stats };
}

module.exports = { build: build };
