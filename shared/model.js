/**
 * model.js - turns raw tab data into clean objects. No secrets are touched here:
 * `parseDebates` only keeps token/adjudicator when the caller asked for them.
 */
var T = require('./time');
var SPLIT = /[,;\n]+/;

function truthy(v) { return String(v).trim().toUpperCase() === 'TRUE'; }

/** Config tab (irregular layout): B1 = rooms; col A = blocks, B = sections; col D = dates. */
function parseConfig(rows, defaultYear) {
  var rooms = Number(String((rows[0] || [])[1] || '').replace(/\D/g, '')) || 30;
  var blocks = [], dates = [];
  rows.forEach(function (r) {
    var b = T.parseBlock(r[0]);
    if (b) { var s = Number(r[1]); if (s >= 1 && s <= 6) b.sections = s; blocks.push(b); }
    var d = T.parseDate(r[3], defaultYear);
    if (d && dates.indexOf(d) < 0) dates.push(d);
  });
  return { rooms: rooms, blocks: blocks, dates: dates.sort() };
}

var DEBATE_PUBLIC_COLUMNS = ['category', 'date', 'block', 'section', 'room', 'prop_id', 'prop_name', 'opp_id', 'opp_name', 'round', 'status', 'sides_visible'];
var DEBATE_PUBLIC_OPTIONAL = ['absent_id'];                       // NOTE: no debate_id, token, adjudicator, key, time_made
var DEBATE_PRIVATE_EXTRA = ['debate_id', 'token', 'adjudicator'];

/** Debates rows (objects) -> clean debates. DISSOLVED and unknown statuses are dropped (like Desk.gs). */
function parseDebates(rows, opt) {
  opt = opt || {};
  var out = [], warnings = [], dropped = 0, bad = 0;
  rows.forEach(function (r, i) {
    var status = String(r.status || '').toUpperCase();
    if (status !== 'ACTIVE' && status !== 'WALKOVER') { dropped++; return; }
    var date = T.parseDate(r.date, opt.year), block = T.parseBlock(r.block);
    var section = Number(r.section), room = Number(r.room), round = Number(String(r.round).replace(/\D/g, ''));
    if (!date || !block || !(section >= 1) || !(room >= 1) || !(round >= 1 && round <= 3) || (!r.prop_id && !r.opp_id)) { bad++; warnings.push('Debates row ' + (i + 2) + ' skipped (unreadable date/block/section/room/round/ids)'); return; }
    var d = {
      row: i + 2, date: date, block: block, section: section, room: room, round: round,
      walkover: status === 'WALKOVER', sidesVisible: truthy(r.sides_visible),
      category: r.category, absentId: r.absent_id || '',
      propId: r.prop_id || '', propName: r.prop_name, oppId: r.opp_id || '', oppName: r.opp_name
    };
    if (opt.private) { d.id = r.debate_id; d.token = r.token || ''; d.adjudicator = r.adjudicator || ''; }
    out.push(d);
  });
  return { debates: out, warnings: warnings, dropped: dropped, bad: bad };
}

/** 'Prop' | 'Opp' | '' from whatever the sheet holds (Prop, prop, P, Proposition, Opp, O, Opposition ...) */
function normSide(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return !s ? '' : s[0] === 'p' ? 'Prop' : s[0] === 'o' ? 'Opp' : '';
}

/**
 * Slot plan / Roster -> students with 3 planned slots (null = not placed yet).
 * Optional columns side_R1..side_R3 hold each JUNIOR's pre-assigned side. Sides on any other category are ignored
 * (Middle/Senior sides follow Debates.sides_visible only) and counted in `ignoredSides` so the host can be warned.
 */
function parseStudents(rows, opt) {
  opt = opt || {};
  var unplaced = 0, students = [], ignoredSides = 0, juniors = 0, juniorsWithSides = 0;
  rows.forEach(function (r) {
    if (!r.student_id) return;
    var plan = [1, 2, 3].map(function (n) {
      var d = T.parseDate(r['R' + n + ' date'], opt.year), b = T.parseBlock(r['R' + n + ' slot']);
      if (!(d && b)) return null;
      // optional "R<n> batch" (1, 1.0, "Batch 2"); blank / UNPLACED / anything unreadable = no batch
      var raw = String(r['R' + n + ' batch'] == null ? '' : r['R' + n + ' batch']).trim(), m = /^(?:batch\s*)?(\d+)(?:\.0+)?$/i.exec(raw);
      return { date: d, block: b, batch: m && Number(m[1]) >= 1 ? Number(m[1]) : 0 };
    });
    unplaced += plan.filter(function (p) { return !p; }).length;
    var raw = [1, 2, 3].map(function (n) { return normSide(r['side_R' + n]); });
    var isJunior = /^junior/i.test(r.category || ''), sides = null;
    if (isJunior) { juniors++; if (raw.some(Boolean)) { sides = raw; juniorsWithSides++; } }
    else if (raw.some(Boolean)) ignoredSides++;
    students.push({ id: r.student_id, name: r.name, category: r.category, state: r.state || '', school: String(r.school || '').replace(/\s+/g, ' ').trim(), plan: plan, sides: sides });
  });
  return { students: students, unplaced: unplaced, ignoredSides: ignoredSides, juniors: juniors, juniorsWithSides: juniorsWithSides };
}

/** Adj_Grid: row 1 = 'Room', dates...; one row per room. Cells may hold several names (comma/semicolon/newline). */
function parseAdjGrid(rows, defaultYear) {
  var head = rows[0] || [], dates = [], cols = [];
  for (var c = 1; c < head.length; c++) { var d = T.parseDate(head[c], defaultYear); if (d) { dates.push(d); cols.push(c); } }
  var grid = {}, rooms = [];
  dates.forEach(function (d) { grid[d] = {}; });
  for (var r = 1; r < rows.length; r++) {
    var room = Number(String((rows[r] || [])[0]).replace(/\D/g, ''));
    if (!room) continue;
    rooms.push(room);
    dates.forEach(function (d, k) {
      var cell = String((rows[r] || [])[cols[k]] || '').trim();
      var names = cell ? cell.split(SPLIT).map(function (s) { return s.trim(); }).filter(Boolean) : [];
      if (names.length) grid[d][room] = names;
    });
  }
  return { dates: dates.sort(), rooms: rooms.sort(function (a, b) { return a - b; }), grid: grid };
}

module.exports = {
  normSide: normSide, parseConfig: parseConfig, parseDebates: parseDebates, parseStudents: parseStudents, parseAdjGrid: parseAdjGrid,
  DEBATE_PUBLIC_COLUMNS: DEBATE_PUBLIC_COLUMNS, DEBATE_PUBLIC_OPTIONAL: DEBATE_PUBLIC_OPTIONAL, DEBATE_PRIVATE_EXTRA: DEBATE_PRIVATE_EXTRA,
  SPLIT: SPLIT, truthy: truthy
};
