#!/usr/bin/env node
/**
 * build-sample.js - makes SAMPLE Debates.csv and Adj_Grid.csv from sample/data/Roster.csv + Config.csv.
 * Pairings come from the REAL Pairing.gs (sample/vendor/Pairing.gs) so the data behaves like the host's script.
 * Everything here is fake test data: names in Adj_Grid are "Sample Adjudicator NN", tokens are made up.
 *
 * Scenario (so every screen has something to show):
 *   21 Oct  Junior R1   3:30, 4:30, 5:30 blocks fully paired (sides shown); 6:30 block: sections 1-2 only; 7:30 block: none
 *           2 walkovers + 1 dissolved debate in the 3:30 block
 *   22 Oct  Middle R1   3:30 block fully paired, sides HIDDEN; 4:30 block fully paired, sides REVEALED
 *   23 Oct  Senior R1   3:30 block, section 1 only, sides hidden
 *   24 Oct  Junior R2   10:30 block, section 1 only (shows a student with R1 + R2 paired and R3 still planned)
 *   everything else is still "planned slot only".
 */
var fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
var root = path.join(__dirname, '..');
var T = require(path.join(root, 'shared/time'));
var M = require(path.join(root, 'shared/model'));
var S = require(path.join(root, 'shared/source'));
var toCsv = require(path.join(root, 'shared/csv')).toCsv;

var code = fs.readFileSync(path.join(__dirname, 'vendor/Pairing.gs'), 'utf8');
var P = vm.runInNewContext(code + '\n({pairGroup_: pairGroup_, buildHistory_: buildHistory_, mulberry_: mulberry_})', {});
var rng = P.mulberry_(2026);

var dir = path.join(__dirname, 'data');
var src = S.createSource({ SOURCE: 'csv', SAMPLE_DIR: dir });
var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function dateText(iso) { var p = iso.split('-'); return Number(p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }

(async function () {
  var cfg = M.parseConfig(await src.raw('Config'), 2026);
  var students = M.parseStudents(await src.table('Roster'), { year: 2026 }).students;
  var ROOMS = cfg.rooms;

  // ---- Adj_Grid (sample names; a different rotation each day)
  var gridRows = [['Room'].concat(cfg.dates.map(dateText))];
  for (var r = 1; r <= ROOMS; r++) {
    gridRows.push([r].concat(cfg.dates.map(function (d, k) { return 'Sample Adjudicator ' + String(((r - 1 + 7 * k) % ROOMS) + 1).padStart(2, '0'); })));
  }
  fs.writeFileSync(path.join(dir, 'Adj_Grid.csv'), toCsv(gridRows));
  var adjOf = function (iso, room) { var k = cfg.dates.indexOf(iso); return 'Sample Adjudicator ' + String(((room - 1 + 7 * k) % ROOMS) + 1).padStart(2, '0'); };

  // ---- pairings
  var rows = [], num = 1, made = Date.UTC(2026, 9, 14, 9, 30);   // 14 Oct 2026 15:00 IST
  function token(id) { return crypto.createHmac('sha256', 'sample-secret').update('debate:' + id).digest('hex').slice(0, 12); }
  function pairBlock(iso, blockLabel, round, category, sectionsToPair, visible) {
    var group = students.filter(function (s) { var p = s.plan[round - 1]; return p && p.date === iso && p.block.label === blockLabel && s.category === category; })
      .map(function (s) { return { id: s.id, name: s.name, state: s.state }; });
    var hist = P.buildHistory_(rows.map(function (x) { return { prop: x.prop_id, opp: x.opp_id, round: Number(x.round.slice(1)), status: x.status, absent: x.absent_id }; }));
    var res = P.pairGroup_(group, hist, rng);
    var pairs = res.pairs.slice(0, sectionsToPair * ROOMS), block = T.parseBlock(blockLabel);
    pairs.forEach(function (pr, i) {
      var section = Math.floor(i / ROOMS) + 1, room = (i % ROOMS) + 1, id = 'D-' + String(num++).padStart(4, '0');
      rows.push({ debate_id: id, category: category, date: dateText(iso), block: blockLabel, section: section, room: room,
        prop_id: pr.prop.id, prop_name: pr.prop.name, opp_id: pr.opp.id, opp_name: pr.opp.name, round: 'R' + round, token: token(id),
        adjudicator: adjOf(iso, room), status: 'ACTIVE', sides_visible: visible ? 'TRUE' : 'FALSE',
        key: dateText(iso) + '|' + blockLabel + '|' + section + '|' + room, absent_id: '',
        time_made: new Date(made + num * 20000).toISOString().replace('T', ' ').slice(0, 19) });
    });
    return pairs.length;
  }
  var n = 0;
  ['3:30 PM - 4:30 PM', '4:30 PM - 5:30 PM', '5:30 PM - 6:00 PM'].forEach(function (b) { n += pairBlock('2026-10-21', b, 1, 'Junior', 3, true); });
  n += pairBlock('2026-10-21', '6:30 PM - 7:30 PM', 1, 'Junior', 2, true);
  n += pairBlock('2026-10-22', '3:30 PM - 4:30 PM', 1, 'Middle', 3, false);
  n += pairBlock('2026-10-22', '4:30 PM - 5:30 PM', 1, 'Middle', 3, true);
  n += pairBlock('2026-10-23', '3:30 PM - 4:30 PM', 1, 'Senior', 1, false);
  n += pairBlock('2026-10-24', '10:30 AM - 11:30 AM', 2, 'Junior', 1, true);

  // ---- two walkovers and one dissolved debate on 21 Oct, 3:30 block
  var first = rows.filter(function (x) { return x.date === '21 Oct 2026' && x.block === '3:30 PM - 4:30 PM' && x.round === 'R1'; });
  first[3].status = 'WALKOVER'; first[3].absent_id = first[3].opp_id;
  first[8].status = 'WALKOVER'; first[8].absent_id = first[8].prop_id;
  first[12].status = 'DISSOLVED'; first[12].key = '';

  var cols = ['debate_id','category','date','block','section','room','prop_id','prop_name','opp_id','opp_name','round','token','adjudicator','status','sides_visible','key','absent_id','time_made'];
  fs.writeFileSync(path.join(dir, 'Debates.csv'), toCsv([cols].concat(rows.map(function (x) { return cols.map(function (c) { return x[c]; }); }))));
  console.log('Sample written: ' + rows.length + ' debate rows (' + n + ' pairings), Adj_Grid for ' + cfg.dates.length + ' days.');
})().catch(function (e) { console.error(e); process.exit(1); });
