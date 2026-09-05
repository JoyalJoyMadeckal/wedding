/**
 * RSVP receiver — paste this into a Google Sheet's Apps Script editor.
 *
 * Setup (full walkthrough in DEPLOY.md):
 *   1. Create a Google Sheet. Name the first tab "RSVP".
 *   2. Extensions -> Apps Script. Delete everything, paste this in, Save.
 *   3. Deploy -> New deployment -> type "Web app"
 *        Execute as:        Me
 *        Who has access:    Anyone
 *      Copy the /exec URL it gives you.
 *   4. Put that URL into wedding.json  ->  rsvp.sheetEndpoint
 *
 * Every submission appends one row. Columns are created automatically the
 * first time a new field name appears, so adding an event to wedding.json
 * needs no change here.
 *
 * PRIVACY — read this once
 * ------------------------
 * "Who has access: Anyone" applies to THE SCRIPT, not to your spreadsheet.
 * The sheet stays private to your Google account; nobody can open it.
 * The script runs as you, and this code only ever WRITES. It has no path
 * that reads a row back out, so the only thing a stranger can do with the
 * /exec URL is add a row — never see one.
 */

var SHEET_NAME = 'RSVP';

// Anything not in this list is rejected, so a stranger poking at the URL can't
// invent columns. Add a name here if you add a field to the form.
var ALLOWED_FIELDS = [
  'submittedAt', 'name', 'email', 'dietary', 'song', 'message'
];
// ...plus anything matching these, so new events in wedding.json just work.
var ALLOWED_PATTERNS = [/^[a-z0-9-]{1,24}_attending$/, /^[a-z0-9-]{1,24}_guests$/];

var MAX_FIELD_LENGTH = 2000;   // truncate anything longer
var MAX_FIELDS = 40;           // reject absurd payloads outright

// Fields listed here appear in this order; anything else is appended after.
var PREFERRED_ORDER = [
  'submittedAt', 'name', 'email',
  'ring_attending', 'ring_guests',
  'wedding_attending', 'wedding_guests',
  'dietary', 'song', 'message'
];

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
    data.submittedAt = Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    var sheet = getSheet();
    var headers = readHeaders(sheet);

    // add a column for any field we haven't seen before
    var incoming = Object.keys(data);
    var added = incoming.filter(function (k) { return headers.indexOf(k) === -1; });
    if (added.length) {
      headers = orderHeaders(headers.concat(added));
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var row = headers.map(function (h) {
      return data[h] === undefined ? '' : data[h];
    });
    sheet.appendRow(row);

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

// Lets you sanity-check the deployment by opening the /exec URL in a browser.
function doGet() {
  return reply({ ok: true, service: 'wedding-rsvp', message: 'Endpoint is live. POST to submit.' });
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function readHeaders(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn())
              .getValues()[0]
              .filter(String);
}

function orderHeaders(list) {
  var known = PREFERRED_ORDER.filter(function (h) { return list.indexOf(h) !== -1; });
  var rest = list.filter(function (h) { return PREFERRED_ORDER.indexOf(h) === -1; });
  return known.concat(rest);
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Optional: run this once, by hand, from the Apps Script editor to get an
 * email whenever someone RSVPs. Set YOUR_EMAIL first.
 */
var YOUR_EMAIL = '';   // e.g. 'you@gmail.com' — leave blank to disable

function notify_(data) {
  if (!YOUR_EMAIL) return;
  var lines = Object.keys(data).map(function (k) { return k + ': ' + data[k]; });
  MailApp.sendEmail(YOUR_EMAIL, 'Wedding RSVP — ' + (data.name || 'someone'), lines.join('\n'));
}
