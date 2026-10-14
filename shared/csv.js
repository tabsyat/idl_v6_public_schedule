/** csv.js - small RFC-4180 parser (quotes, CRLF, BOM). Returns array of arrays of strings. */
function parseCsv(text) {
  var rows = [], row = [], cell = '', q = false, i = 0, c;
  text = String(text).replace(/^\uFEFF/, '');
  for (; i < text.length; i++) {
    c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = ''; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function toCsv(rows) {
  return rows.map(function (r) {
    return r.map(function (v) {
      v = v == null ? '' : String(v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(',');
  }).join('\n') + '\n';
}
module.exports = { parseCsv: parseCsv, toCsv: toCsv };
