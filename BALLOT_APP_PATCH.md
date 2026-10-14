# Ballot app changes (do these when you debug the ballot links)

The adjudicator site only builds `BALLOT_APP_URL?debate=<id>&t=<token>`, using the token already in `Debates!L`. The ballot web app itself still has to understand the new `Debates` layout. Today it does not, in these places:

## What breaks and why

1. **`loadDebate_()` reads a `Debate_Board` tab** (date, time, adjudicator by row). The new workbook has no such tab, so every ballot link would fail with an error. The date is now text in `Debates!C`, the adjudicator is `Debates!M`, and the time is computed from block + section.
2. **It does not check `status`.** A DISSOLVED debate's link would still open a ballot.
3. **Two `onOpen()` functions** (Desk.gs and Code.gs) in one Apps Script project: only one runs, so one menu disappears.
4. **`dayPage_()` and `generateAdjudicatorLinks()`** depend on `Debate_Board` and an `Adjudicators` tab. The new adjudicator site replaces them.
5. **Token order matters.** `Desk.gs` signs with the ballot app's `sign_()` only if it exists. Run *Create secret* first; if debates were made before it, run *Generate debate tokens* once more (it is deterministic, so rerunning is safe).

## Patch

Replace `loadDebate_` in `Code.gs` with:

```js
function blockStartMin_(text) {                      // "3:30 PM - 4:30 PM" -> 930
  var m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/.exec(String(text));
  if (!m) return null;
  var h = Number(m[1]) % 12; if (/p/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}
function clock12_(min) {
  var h = Math.floor(min / 60) % 24, mi = min % 60;
  return ((h % 12) || 12) + ':' + ('0' + mi).slice(-2) + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function adjFromGrid_(dateText, room) {              // fallback when Debates!M is blank
  var g = SpreadsheetApp.getActive().getSheetByName('Adj_Grid');
  if (!g) return '';
  var v = g.getDataRange().getDisplayValues(), col = v[0].indexOf(String(dateText).trim());
  for (var r = 1; r < v.length; r++) if (Number(v[r][0]) === Number(room)) return col > 0 ? String(v[r][col]) : '';
  return '';
}
function loadDebate_(id) {
  var dsh = SpreadsheetApp.getActive().getSheetByName('Debates');
  var row = findRow_(dsh, id); if (!row) return null;
  var v = dsh.getRange(row, 1, 1, 14).getDisplayValues()[0];            // A..N as text
  if (String(v[13]).toUpperCase() === 'DISSOLVED') return null;
  var start = blockStartMin_(v[3]), section = Number(v[4]), room = Number(v[5]);
  return { id: v[0], category: v[1], block: v[3], section: section, room: room,
           propId: v[6], propName: v[7], oppId: v[8], oppName: v[9],
           date: v[2], time: start === null ? '' : clock12_(start + (section - 1) * 20),
           adjudicator: v[12] || adjFromGrid_(v[2], room) };
}
```

In `doGet`, replace `if (p.adj) return dayPage_(p);` with:

```js
if (p.adj) return text_('Please use the new personal link from the organisers.');
```

Rename `onOpen` in `Code.gs` to `ballotMenu_`, and add `try { ballotMenu_(); } catch (e) {}` as the first line of `onOpen` in `Desk.gs`. Remove "4. Generate adjudicator links" from that menu (the links now come from the adjudicator site's host page).

## Optional later

- **Back link.** `ballotPage_` only accepts a `back` URL that starts with the ballot app's own URL, so the "back to my debates" link is hidden when coming from the adjudicator site. Add a Script Property `ADJ_SITE_URL`, accept URLs starting with it, and the adjudicator site can append `&back=<its own page>` to the ballot URL.
- **Walkovers.** The adjudicator site shows no ballot button for a walkover. If you want one, remove the `walkover` branch in `adj/lib/views.js`.
