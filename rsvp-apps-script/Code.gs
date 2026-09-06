/**
 * RSVP receiver — paste this into a Google Sheet's Apps Script editor.
 *
 * Setup (full walkthrough in DEPLOY.md):
 *   1. Create a Google Sheet.
 *   2. Extensions -> Apps Script. Delete everything, paste this in, Save.
 *   3. Deploy -> New deployment -> type "Web app"
 *        Execute as:        Me
 *        Who has access:    Anyone
 *      Copy the /exec URL it gives you.
 *   4. Put that URL into wedding.json  ->  rsvp.sheetEndpoint
 *
 * Both tabs are created for you on the first submission. You don't need to
 * make them by hand.
 *
 * TWO TABS
 * --------
 *   "RSVP"    every submission ever, in order, nothing overwritten.
 *             This is your audit trail. Don't edit it.
 *   "Latest"  one row per guest, always their current answer.
 *             This is the one you read, count, and export for the caterer.
 *
 * A guest who replies twice gets a second row in RSVP and their existing row
 * in Latest is updated in place. The "replies" column shows how many times
 * they've submitted, so you can see at a glance who changed their mind.
 *
 * Guests are matched by email address. If someone replies a second time from
 * a different email, they'll appear twice in Latest — merge those by hand.
 *
 * PRIVACY
 * -------
 * "Who has access: Anyone" applies to THE SCRIPT, not to your spreadsheet.
 * The sheet stays private to your Google account; nobody can open it.
 * The script runs as you, and this code only ever WRITES. It has no path
 * that reads a row back out, so the only thing a stranger can do with the
 * /exec URL is add a row — never see one.
 */

var LOG_SHEET = 'RSVP';        // append-only, every submission
var LATEST_SHEET = 'Latest';   // one current row per guest

// Bookkeeping columns on the Latest tab. '_key' is how a guest is matched;
// hide column A once you've seen it working.
var META_COLUMNS = ['_key', 'replies', 'firstReplied'];

// Anything not in this list is rejected, so a stranger poking at the URL can't
// invent columns. Add a name here if you add a field to the form.
var ALLOWED_FIELDS = [
  'submittedAt', 'name', 'email', 'dietary', 'song', 'message'
];
// ...plus anything matching these, so new events in wedding.json just work.
var ALLOWED_PATTERNS = [/^[a-z0-9-]{1,24}_attending$/, /^[a-z0-9-]{1,24}_guests$/];

// Fields appear in this order; anything else is appended after.
var PREFERRED_ORDER = [
  'submittedAt', 'name', 'email',
  'ring_attending', 'ring_guests',
  'wedding_attending', 'wedding_guests',
  'reception_attending', 'reception_guests',
  'dietary', 'song', 'message'
];

var MAX_FIELD_LENGTH = 2000;   // truncate anything longer
var MAX_FIELDS = 40;           // reject absurd payloads outright


/* ── the endpoint ─────────────────────────────────────────────── */

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);           // serialise writes so two guests can't collide
  try {
    var data = (e && e.parameter) ? e.parameter : {};

    // ignore honeypot hits — bots fill hidden fields, humans don't.
    // Answer 'ok' so a bot has no signal that it was caught.
    if (data['bot-field']) return reply({ ok: true });
    if (Object.keys(data).length > MAX_FIELDS) return reply({ ok: false });

    data = sanitise_(data);

    // a reply with no name is junk, not a guest
    if (!String(data.name || '').trim()) return reply({ ok: false });

    // always stamp server-side; never trust the browser's clock
    data.submittedAt = timestamp_();

    appendToLog_(data);
    upsertLatest_(data);

    // deliberately returns nothing about the sheet — not the row number, not
    // the guest count. The caller only needs to know it landed.
    return reply({ ok: true });
  } catch (err) {
    Logger.log(err);              // visible to you under Executions, not to the caller
    return reply({ ok: false });  // no stack traces leaked to the browser
  } finally {
    lock.releaseLock();
  }
}

// Lets you sanity-check the deployment by opening the /exec URL in a browser.
function doGet() {
  return reply({ ok: true, service: 'wedding-rsvp', message: 'Endpoint is live. POST to submit.' });
}


/* ── the two tabs ─────────────────────────────────────────────── */

function appendToLog_(data) {
  var sheet = getSheet_(LOG_SHEET);
  var headers = ensureHeaders_(sheet, orderHeaders(Object.keys(data)));
  sheet.appendRow(rowFor_(headers, data));
}

/**
 * One row per guest, replaced wholesale each time they reply. The form always
 * submits every field, so a straight replacement is the correct "latest wins"
 * behaviour — a blank means they cleared it, not that we lost it.
 */
function upsertLatest_(data) {
  var sheet = getSheet_(LATEST_SHEET);
  var key = keyFor_(data);
  var headers = ensureHeaders_(sheet, META_COLUMNS.concat(orderHeaders(Object.keys(data))));

  var rowNum = findRowByKey_(sheet, headers, key);
  var record = {};
  Object.keys(data).forEach(function (k) { record[k] = data[k]; });
  record._key = key;

  if (rowNum) {
    var existing = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
    var prev = {};
    headers.forEach(function (h, i) { prev[h] = existing[i]; });
    record.replies = (Number(prev.replies) || 1) + 1;
    record.firstReplied = prev.firstReplied || data.submittedAt;
    sheet.getRange(rowNum, 1, 1, headers.length).setValues([rowFor_(headers, record)]);
  } else {
    record.replies = 1;
    record.firstReplied = data.submittedAt;
    sheet.appendRow(rowFor_(headers, record));
  }
}

/** Match guests on email; fall back to name if they left it blank. */
function keyFor_(data) {
  var email = String(data.email || '').trim().toLowerCase();
  if (email) return email;
  return 'name:' + String(data.name || '').trim().toLowerCase();
}

function findRowByKey_(sheet, headers, key) {
  var col = headers.indexOf('_key') + 1;
  if (!col || sheet.getLastRow() < 2) return 0;
  var values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === key) return i + 2;
  }
  return 0;
}


/* ── sheet plumbing ───────────────────────────────────────────── */

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn())
              .getValues()[0]
              .filter(String);
}

/** Make sure every wanted column exists. New ones are appended on the right. */
function ensureHeaders_(sheet, wanted) {
  var headers = readHeaders_(sheet);
  var missing = wanted.filter(function (h) { return headers.indexOf(h) === -1; });
  if (!headers.length || missing.length) {
    headers = headers.length ? headers.concat(missing) : wanted.slice();
    sheet.getRange(1, 1, 1, headers.length)
         .setValues([headers])
         .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return headers;
}

function rowFor_(headers, record) {
  return headers.map(function (h) {
    return record[h] === undefined ? '' : record[h];
  });
}

function orderHeaders(list) {
  var known = PREFERRED_ORDER.filter(function (h) { return list.indexOf(h) !== -1; });
  var rest = list.filter(function (h) {
    return PREFERRED_ORDER.indexOf(h) === -1 && META_COLUMNS.indexOf(h) === -1;
  });
  return known.concat(rest);
}


/* ── validation ───────────────────────────────────────────────── */

/**
 * Drop unexpected fields, trim whitespace, cap length. Everything that reaches
 * the sheet has passed through here.
 */
function sanitise_(data) {
  var clean = {};
  Object.keys(data).forEach(function (key) {
    var ok = ALLOWED_FIELDS.indexOf(key) !== -1 ||
             ALLOWED_PATTERNS.some(function (re) { return re.test(key); });
    if (!ok) return;
    var v = String(data[key] === undefined ? '' : data[key]).trim();
    if (v.length > MAX_FIELD_LENGTH) v = v.slice(0, MAX_FIELD_LENGTH) + '…';
    // a leading =, +, - or @ makes Sheets treat the text as a formula
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    clean[key] = v;
  });
  return clean;
}

function timestamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ── menu ─────────────────────────────────────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Wedding RSVP')
    .addItem('Rebuild Latest tab', 'rebuildLatest')
    .addItem('Show headcount', 'showHeadcount')
    .addToUi();
}

/**
 * Wipes Latest and replays the whole RSVP log into it. Safe to run any time —
 * the log is the source of truth, so nothing can be lost. Use it if you've
 * accidentally edited Latest, or after deleting spam rows from the log.
 */
function rebuildLatest() {
  var log = getSheet_(LOG_SHEET);
  var headers = readHeaders_(log);
  if (!headers.length || log.getLastRow() < 2) {
    SpreadsheetApp.getActive().toast('Nothing in the log yet.');
    return;
  }

  var latest = getSheet_(LATEST_SHEET);
  latest.clear();

  var rows = log.getRange(2, 1, log.getLastRow() - 1, headers.length).getValues();
  rows.forEach(function (row) {
    var data = {};
    headers.forEach(function (h, i) {
      if (row[i] !== '' && row[i] !== null) data[h] = row[i];
    });
    if (data.name) upsertLatest_(data);
  });

  SpreadsheetApp.getActive().toast('Latest rebuilt from ' + rows.length + ' submissions.');
}

/** Quick count off the Latest tab, so you're never counting rows by hand. */
function showHeadcount() {
  var sheet = getSheet_(LATEST_SHEET);
  var headers = readHeaders_(sheet);
  if (sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('No replies yet.');
    return;
  }
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  var lines = ['Households replied: ' + rows.length, ''];
  headers.forEach(function (h, i) {
    if (!/_attending$/.test(h)) return;
    var event = h.replace(/_attending$/, '');
    var guestCol = headers.indexOf(event + '_guests');
    var yes = 0, no = 0, heads = 0;
    rows.forEach(function (r) {
      if (String(r[i]).toLowerCase() === 'yes') {
        yes++;
        if (guestCol > -1) heads += Number(r[guestCol]) || 0;
      } else if (String(r[i]).toLowerCase() === 'no') {
        no++;
      }
    });
    lines.push(event + ':  ' + heads + ' guests  (' + yes + ' yes, ' + no + ' no)');
  });

  SpreadsheetApp.getUi().alert('Headcount', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}


/* ── optional: email yourself on each RSVP ────────────────────── */

/**
 * Set YOUR_EMAIL, then add   notify_(data);   inside doPost, just before the
 * 'return reply({ ok: true })' line. Redeploy afterwards (Deploy -> Manage
 * deployments -> pencil -> Version: New version) or nothing changes.
 *
 * Consumer Gmail allows 100 script-sent emails per day.
 */
var YOUR_EMAIL = '';   // e.g. 'you@gmail.com' — leave blank to disable

function notify_(data) {
  if (!YOUR_EMAIL) return;
  var lines = Object.keys(data).map(function (k) { return k + ': ' + data[k]; });
  MailApp.sendEmail(YOUR_EMAIL, 'Wedding RSVP — ' + (data.name || 'someone'), lines.join('\n'));
}
