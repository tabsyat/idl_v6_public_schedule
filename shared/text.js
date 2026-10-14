/** text.js - name helpers used by both services. */
function norm(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\u0900-\u097f ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Alphabetical, case-insensitive, ties broken by ID: used wherever sides must NOT be hinted. */
function byNameThenId(a, b) {
  var x = norm(a.name), y = norm(b.name);
  if (x < y) return -1; if (x > y) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
module.exports = { norm: norm, byNameThenId: byNameThenId };
