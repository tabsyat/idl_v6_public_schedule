/** store.js - the two host switches, kept in a small JSON file (use a Render persistent disk so restarts keep them). */
var fs = require('fs');
var path = require('path');

function createStore(dir, defaults) {
  var file = path.join(dir, 'state.json');
  var state = { slots: !!defaults.slots, pairings: !!defaults.pairings, roster: !!defaults.roster, school: !!defaults.school, motionsAuto: defaults.motionsAuto !== false,
    sidesAuto: defaults.sidesAuto !== false, sidesAll: { r1: !!defaults.sidesAll, r2: !!defaults.sidesAll, r3: !!defaults.sidesAll } };
  state.motions = {}; state.release = {};          // Motions tab: typed text + per-date release overrides
  try {
    var saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.slots === 'boolean') state.slots = saved.slots;
    if (typeof saved.pairings === 'boolean') state.pairings = saved.pairings;
    if (typeof saved.roster === 'boolean') state.roster = saved.roster;
    if (typeof saved.school === 'boolean') state.school = saved.school;
    if (typeof saved.sidesAuto === 'boolean') state.sidesAuto = saved.sidesAuto;
    if (saved.sidesAll && typeof saved.sidesAll === 'object') ['r1', 'r2', 'r3'].forEach(function (k) { if (typeof saved.sidesAll[k] === 'boolean') state.sidesAll[k] = saved.sidesAll[k]; });
    else if (typeof saved.sides === 'boolean') state.sidesAll = { r1: saved.sides, r2: saved.sides, r3: saved.sides };   // older single "Reveal Junior sides" switch
    if (typeof saved.motionsAuto === 'boolean') state.motionsAuto = saved.motionsAuto;
    if (saved.motions && typeof saved.motions === 'object') state.motions = saved.motions;
    if (saved.release && typeof saved.release === 'object') state.release = saved.release;
  } catch (e) { /* first run: use defaults */ }
  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(state));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { console.error('Could not save ' + file + ' (' + e.message + '). Switches will reset on restart.'); }
  }
  return {
    get: function () { return { slots: state.slots, pairings: state.pairings, roster: state.roster, school: state.school, motionsAuto: state.motionsAuto, sidesAuto: state.sidesAuto, sidesAll: { r1: state.sidesAll.r1, r2: state.sidesAll.r2, r3: state.sidesAll.r3 } }; },
    set: function (patch) {
      if (typeof patch.slots === 'boolean') state.slots = patch.slots;
      if (typeof patch.pairings === 'boolean') state.pairings = patch.pairings;
      if (typeof patch.roster === 'boolean') state.roster = patch.roster;
      if (typeof patch.school === 'boolean') state.school = patch.school;
      if (typeof patch.sidesAuto === 'boolean') state.sidesAuto = patch.sidesAuto;
      if (patch.sidesAll && typeof patch.sidesAll === 'object') ['r1', 'r2', 'r3'].forEach(function (k) { if (typeof patch.sidesAll[k] === 'boolean') state.sidesAll[k] = patch.sidesAll[k]; });
      if (typeof patch.motionsAuto === 'boolean') state.motionsAuto = patch.motionsAuto;
      save();
    },
    /** live objects: read only, do not mutate */
    getData: function () { return { motions: state.motions, release: state.release }; },
    setMotions: function (iso, value) {
      if (value && Object.keys(value).length) state.motions[iso] = value; else delete state.motions[iso];
      save();
    },
    setRelease: function (iso, patch) {
      var r = state.release[iso] || {};
      if ('at' in patch) { if (patch.at == null) delete r.at; else r.at = patch.at; }
      if ('hold' in patch) { if (patch.hold) r.hold = true; else delete r.hold; }
      if (Object.keys(r).length) state.release[iso] = r; else delete state.release[iso];
      save();
    },
    replaceData: function (data) { state.motions = data.motions; state.release = data.release; save(); }
  };
}
module.exports = { createStore: createStore };
