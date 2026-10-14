/**
 * source.js - where sheet data comes from. Two interchangeable sources:
 *   SOURCE=google  Google Sheets API, read-only service account (production)
 *   SOURCE=csv     a folder of CSV files named after the tabs (sample data / local testing)
 *
 *   source.raw(tab)                    -> array of arrays (every cell, as shown in the sheet)
 *   source.table(tab, {columns, optional}) -> array of row objects keyed by header name.
 *        When `columns` is given ONLY those columns are fetched/returned. With the Google source the
 *        other columns (e.g. token, adjudicator) are never requested from Google at all.
 */
var fs = require('fs');
var path = require('path');
var parseCsv = require('./csv').parseCsv;

function toObjects(rows, columns, optional) {
  var header = (rows[0] || []).map(function (h) { return String(h).trim(); });
  var want = columns ? columns.concat(optional || []) : header;
  var idx = {};
  want.forEach(function (name) { idx[name] = header.indexOf(name); });
  (columns || []).forEach(function (name) {
    if (idx[name] < 0) throw new Error('Missing column "' + name + '" (header row: ' + header.join(', ') + ')');
  });
  var out = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r] || [], o = {}, any = false;
    want.forEach(function (name) {
      var v = idx[name] >= 0 && row[idx[name]] != null ? String(row[idx[name]]).trim() : '';
      if (v !== '') any = true;
      o[name] = v;
    });
    if (any) out.push(o);
  }
  return out;
}

function csvSource(dir) {
  function read(tab) {
    var file = path.join(dir, tab + '.csv');
    if (!fs.existsSync(file)) throw new Error('Sample file not found: ' + file);
    return parseCsv(fs.readFileSync(file, 'utf8'));
  }
  return {
    kind: 'csv',
    raw: async function (tab) { return read(tab); },
    table: async function (tab, opt) { opt = opt || {}; return toObjects(read(tab), opt.columns, opt.optional); }
  };
}

function colLetter(i) { var s = ''; for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; }

function parseCredentials(text) {
  if (!text) throw new Error('GOOGLE_CREDENTIALS is not set');
  var t = String(text).trim();
  if (t[0] !== '{') t = Buffer.from(t, 'base64').toString('utf8');   // allow base64-encoded JSON too
  var c = JSON.parse(t);
  if (!c.client_email || !c.private_key) throw new Error('GOOGLE_CREDENTIALS must contain client_email and private_key');
  c.private_key = String(c.private_key).replace(/\\n/g, '\n');
  return c;
}

function googleSource(env, deps) {
  deps = deps || {};
  var sheetId = env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID is not set');
  var creds = parseCredentials(env.GOOGLE_CREDENTIALS);
  var getToken = deps.getToken, doFetch = deps.fetch || fetch;
  if (!getToken) {
    var JWT = require('google-auth-library').JWT;
    var jwt = new JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    getToken = async function () { return (await jwt.getAccessToken()).token; };
  }
  var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId);

  async function api(urlPath, query) {
    var url = base + urlPath + (query ? (urlPath.indexOf('?') < 0 ? '?' : '&') + query : '');
    var lastErr;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var tok = await getToken();
        var res = await doFetch(url, { headers: { Authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(20000) });
        if (res.ok) return await res.json();
        var body = await res.text();
        lastErr = new Error('Google Sheets API ' + res.status + ': ' + body.slice(0, 300));
        if (res.status < 500 && res.status !== 429) throw lastErr;          // 4xx (except 429): retrying will not help
      } catch (e) { lastErr = e; if (/Google Sheets API 4/.test(e.message) && !/ 429:/.test(e.message)) throw e; }
      await new Promise(function (r) { setTimeout(r, 400 * (attempt + 1)); });
    }
    throw lastErr;
  }
  function a1(tab, range) { return encodeURIComponent("'" + tab.replace(/'/g, "''") + "'" + (range ? '!' + range : '')); }

  async function raw(tab) {
    var j = await api('/values/' + a1(tab), 'valueRenderOption=FORMATTED_VALUE');
    return j.values || [];
  }
  async function table(tab, opt) {
    opt = opt || {};
    if (!opt.columns) return toObjects(await raw(tab), null, null);
    var head = ((await api('/values/' + a1(tab, '1:1'), 'valueRenderOption=FORMATTED_VALUE')).values || [[]])[0] || [];
    head = head.map(function (h) { return String(h).trim(); });
    var names = opt.columns.concat(opt.optional || []).filter(function (n) { return head.indexOf(n) >= 0; });
    opt.columns.forEach(function (n) { if (head.indexOf(n) < 0) throw new Error('Missing column "' + n + '" in tab ' + tab + ' (header row: ' + head.join(', ') + ')'); });
    var q = names.map(function (n) { var L = colLetter(head.indexOf(n)); return 'ranges=' + a1(tab, L + ':' + L); }).join('&');
    var j = await api('/values:batchGet', q + '&majorDimension=COLUMNS&valueRenderOption=FORMATTED_VALUE');
    var cols = {}, len = 0;
    (j.valueRanges || []).forEach(function (vr, i) { var c = (vr.values && vr.values[0]) || []; cols[names[i]] = c; if (c.length > len) len = c.length; });
    var rows = [names];
    for (var r = 1; r < len; r++) rows.push(names.map(function (n) { return cols[n][r] == null ? '' : cols[n][r]; }));
    return toObjects(rows, opt.columns, opt.optional);
  }
  return { kind: 'google', raw: raw, table: table };
}

function createSource(env) {
  env = env || process.env;
  var kind = (env.SOURCE || 'google').toLowerCase();
  if (kind === 'csv') return csvSource(path.resolve(env.SAMPLE_DIR || 'sample/data'));
  if (kind === 'google') return googleSource(env);
  throw new Error('SOURCE must be "google" or "csv"');
}

module.exports = { createSource: createSource, googleSource: googleSource, toObjects: toObjects, colLetter: colLetter, parseCredentials: parseCredentials };
