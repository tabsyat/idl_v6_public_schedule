/**
 * data.js - reads Debates (all columns, incl. token) and Adj_Grid, cached for CACHE_SECONDS so that
 * 30+ adjudicators polling never hit the Google limits. On a read failure the last good copy is kept.
 */
var M = require('../../shared/model');
var norm = require('../../shared/text').norm;

function create(source, opt) {
  var ttl = (opt.cacheSeconds == null ? 15 : opt.cacheSeconds) * 1000, year = opt.year, cur = null, inflight = null, lastError = null;

  async function load() {
    var res = await Promise.all([
      source.table('Debates', { columns: M.DEBATE_PUBLIC_COLUMNS.concat(M.DEBATE_PRIVATE_EXTRA), optional: M.DEBATE_PUBLIC_OPTIONAL }),
      source.raw('Adj_Grid')
    ]);
    var pd = M.parseDebates(res[0], { year: year, private: true });
    var grid = M.parseAdjGrid(res[1], year);
    // canonical display name per normalised key (grid spelling wins)
    var names = {};
    function note(n) { var k = norm(n); if (k && !names[k]) names[k] = n; }
    grid.dates.forEach(function (d) { Object.keys(grid.grid[d]).forEach(function (r) { grid.grid[d][r].forEach(note); }); });
    pd.debates.forEach(function (d) { (d.adjudicator ? d.adjudicator.split(M.SPLIT) : []).forEach(function (n) { note(n.trim()); }); });
    return { at: Date.now(), debates: pd.debates, grid: grid, names: names, warnings: pd.warnings };
  }
  async function get() {
    if (cur && Date.now() - cur.at < ttl) return { data: cur, stale: false };
    if (!inflight) inflight = load().then(function (d) { cur = d; lastError = null; return d; })
      .catch(function (e) { lastError = { at: Date.now(), message: String(e.message || e) }; console.error('Read failed:', lastError.message); if (!cur) throw e; return cur; })
      .finally(function () { inflight = null; });
    var d = await inflight;
    return { data: d, stale: !!lastError, error: lastError };
  }
  return { get: get };
}
module.exports = { create: create };
