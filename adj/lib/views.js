/** views.js - turns cached data into the three JSON shapes the adjudicator site uses. */
var T = require('../../shared/time');
var M = require('../../shared/model');
var norm = require('../../shared/text').norm;
var byNameThenId = require('../../shared/text').byNameThenId;
var tokenLib = require('./token');

function adjNames(d) { return d.adjudicator ? d.adjudicator.split(M.SPLIT).map(function (s) { return s.trim(); }).filter(Boolean) : []; }

/** who judges this debate: names in Debates.adjudicator, else the Adj_Grid cell for that date and room */
function effectiveAdjs(data, d) {
  var n = adjNames(d);
  return n.length ? n : ((data.grid.grid[d.date] || {})[d.room] || []);
}

/** Open allocation table: no tokens, no students. */
function allocation(data) {
  var dates = data.grid.dates;
  return {
    dates: dates.map(function (d) { return { iso: d, label: T.dayLabel(d) }; }),
    rooms: data.grid.rooms,
    grid: data.grid.grid,
    names: Object.keys(data.names).map(function (k) { return data.names[k]; }).sort(function (a, b) { return norm(a) < norm(b) ? -1 : 1; })
  };
}

/** One adjudicator's day. Only this person's debates, and only their own ballot links. */
function myDay(data, name, wantedDate, ballotBase) {
  var key = norm(name), notes = [];
  var mineByDate = {}, roomsByDate = {};
  data.grid.dates.forEach(function (date) {
    Object.keys(data.grid.grid[date]).forEach(function (room) {
      if (data.grid.grid[date][room].some(function (n) { return norm(n) === key; })) (roomsByDate[date] = roomsByDate[date] || []).push(Number(room));
    });
  });
  data.debates.forEach(function (d) {
    var adjs = effectiveAdjs(data, d);
    if (adjs.some(function (n) { return norm(n) === key; })) (mineByDate[d.date] = mineByDate[d.date] || []).push(d);
    // grid says it is mine but Debates says someone else
    var g = (data.grid.grid[d.date] || {})[d.room] || [];
    if (d.adjudicator && g.some(function (n) { return norm(n) === key; }) && !adjNames(d).some(function (n) { return norm(n) === key; }))
      notes.push(T.dayLabel(d.date) + ', Room ' + d.room + ': the Adj_Grid lists you, but the pairing was made with ' + adjNames(d).join(', ') + '. Check with the host.');
  });
  var dates = Object.keys(roomsByDate).concat(Object.keys(mineByDate)).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
  var date = dates.indexOf(wantedDate) >= 0 ? wantedDate : (dates[0] || null);

  var debates = (mineByDate[date] || []).slice().sort(function (a, b) {
    return (a.block.start + (a.section - 1) * T.SECTION_MIN) - (b.block.start + (b.section - 1) * T.SECTION_MIN) || a.room - b.room;
  }).map(function (d) {
    var startMin = T.sectionStartMin(d.block.start, d.section);
    var students;
    if (d.sidesVisible) students = [{ id: d.propId, name: d.propName, side: 'Prop' }, { id: d.oppId, name: d.oppName, side: 'Opp' }];
    else students = [{ id: d.propId, name: d.propName }, { id: d.oppId, name: d.oppName }].sort(byNameThenId).map(function (s) { return { id: s.id, name: s.name, side: null }; });
    students.forEach(function (s) { s.absent = d.walkover && d.absentId === s.id; });
    var ballot = null, ballotNote = null;
    if (d.walkover) ballotNote = 'walkover';
    else if (!ballotBase) ballotNote = 'no-url';
    else if (!d.token) ballotNote = 'no-token';
    else ballot = tokenLib.ballotUrl(ballotBase, d.id, d.token);
    return {
      room: d.room, round: d.round, section: d.section, block: d.block.label, time: T.range(startMin, startMin + T.SECTION_MIN),
      startMs: T.sectionStartMs(d.date, d.block.start, d.section), endMs: T.sectionEndMs(d.date, d.block.start, d.section),
      walkover: d.walkover, sidesVisible: d.sidesVisible, students: students, ballotUrl: ballot, ballotNote: ballotNote
    };
  });
  return {
    name: data.names[key] || name, date: date, dates: dates.map(function (d) { return { iso: d, label: T.dayLabel(d) }; }),
    rooms: (roomsByDate[date] || []).sort(function (a, b) { return a - b; }), debates: debates, notes: notes
  };
}

/** Host list: every adjudicator with a personal link. */
function links(data, secret, base) {
  var out = Object.keys(data.names).map(function (k) { return data.names[k]; }).sort(function (a, b) { return norm(a) < norm(b) ? -1 : 1; })
    .map(function (n) { return { name: n, url: base + '/?adj=' + encodeURIComponent(n) + '&t=' + tokenLib.make(secret, n) }; });
  return out;
}

module.exports = { allocation: allocation, myDay: myDay, links: links, effectiveAdjs: effectiveAdjs };
