/** token.js - personal adjudicator links. Code = HMAC-SHA256(ADJ_SECRET, "adj:" + normalised name), first 20 hex chars. */
var crypto = require('crypto');
var norm = require('../../shared/text').norm;

function make(secret, name) {
  return crypto.createHmac('sha256', secret).update('adj:' + norm(name)).digest('hex').slice(0, 20);
}
function verify(secret, name, code) {
  var a = Buffer.from(make(secret, name)), b = Buffer.from(String(code || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
/** BALLOT_APP_URL?debate=<id>&t=<token>. Returns null when the URL setting or the token is missing. */
function ballotUrl(base, debateId, token) {
  if (!base || !token || !debateId) return null;
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'debate=' + encodeURIComponent(debateId) + '&t=' + encodeURIComponent(token);
}
module.exports = { make: make, verify: verify, ballotUrl: ballotUrl };
