/** store.js - the two host switches, kept in a small JSON file (use a Render persistent disk so restarts keep them). */
var fs = require('fs');
var path = require('path');

function createStore(dir, defaults) {
  var file = path.join(dir, 'state.json');
  var state = { slots: !!defaults.slots, pairings: !!defaults.pairings, roster: !!defaults.roster, sides: !!defaults.sides };
  try {
    var saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.slots === 'boolean') state.slots = saved.slots;
    if (typeof saved.pairings === 'boolean') state.pairings = saved.pairings;
    if (typeof saved.roster === 'boolean') state.roster = saved.roster;
    if (typeof saved.sides === 'boolean') state.sides = saved.sides;
  } catch (e) { /* first run: use defaults */ }
  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(state));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { console.error('Could not save ' + file + ' (' + e.message + '). Switches will reset on restart.'); }
  }
  return {
    get: function () { return { slots: state.slots, pairings: state.pairings, roster: state.roster, sides: state.sides }; },
    set: function (patch) {
      if (typeof patch.slots === 'boolean') state.slots = patch.slots;
      if (typeof patch.pairings === 'boolean') state.pairings = patch.pairings;
      if (typeof patch.roster === 'boolean') state.roster = patch.roster;
      if (typeof patch.sides === 'boolean') state.sides = patch.sides;
      save();
    }
  };
}
module.exports = { createStore: createStore };
