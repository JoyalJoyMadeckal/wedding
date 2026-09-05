# Going live — free, no card, no expiry

Two independent pieces. Do them in this order.

| Piece | What it is | Cost |
|---|---|---|
| **A. RSVP → Google Sheet** | An Apps Script attached to your sheet, receiving form posts | Free, unlimited |
| **B. The site → GitHub Pages** | Static files served from a public repo | Free, 100 GB/month |

Nothing here bills you or lapses. GitHub Pages has no trial period.

---

## A. RSVP into a Google Sheet

### A1 — Make the sheet

1. Go to <https://sheets.new>.
2. Rename it something like **Wedding RSVPs**.
3. Bottom-left, rename the tab from `Sheet1` to exactly **`RSVP`** (capitals matter).

Leave it empty. The script writes the header row itself.

### A2 — Attach the script

1. In that sheet: **Extensions → Apps Script**.
2. Delete the `function myFunction() {}` stub that's there.
3. Open `rsvp-apps-script/Code.gs` from this folder, copy **all** of it, paste it in.
4. Click the save icon (or Ctrl+S).

### A3 — Deploy it as a web app

1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Fill in:

   | Field | Set to |
   |---|---|
   | Description | `RSVP v1` |
   | Execute as | **Me (your@gmail.com)** |
   | Who has access | **Anyone** |

   > **"Anyone" applies to the script, not to your spreadsheet.** It has to,
   > because your guests aren't signed into your Google account. It lets a
   > stranger *run* the script; the sheet itself stays private. See
   > "Is my sheet public?" below.

4. **Deploy**. Google will ask you to authorise:
   - *Authorize access* → pick your account
   - You'll hit **"Google hasn't verified this app"** — this is normal for your own scripts.
     Click **Advanced** → **Go to Untitled project (unsafe)** → **Allow**.
5. Copy the **Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfycbx...long.../exec
   ```

### A4 — Test it before wiring it up

Paste that URL into a browser tab. You should see:

```json
{"ok":true,"service":"wedding-rsvp","message":"Endpoint is live. POST to submit."}
```

If you get an error page instead, the deployment settings in A3 are wrong — most
often "Who has access" isn't set to Anyone.

### A5 — Put the URL in the site

Open `wedding.json`, find:

```json
"sheetEndpoint": "https://script.google.com/macros/s/PLACEHOLDER/exec",
```

Replace the whole string with your `/exec` URL. Save.

### Is my sheet public?

**No.** This trips people up, so in detail:

| Question | Answer |
|---|---|
| Can someone open my Google Sheet? | No. Its sharing setting is untouched — private to your account. The `/exec` URL is not the sheet's URL and gives no route to it. |
| What does "Anyone" actually grant? | Permission to *invoke the script*. Nothing else. |
| Whose permissions does it run with? | Yours ("Execute as: Me") — which is why it can write to your private sheet. But it only does what this code says. |
| Could someone read the replies through it? | No. There is no code path that reads a row and returns it. `doPost` writes and returns `{"ok":true}`; `doGet` returns a fixed status message. |
| Can they see how many people RSVP'd? | No — the response deliberately omits the row count. |
| Can Google see my replies? | Same as any Google Sheet you own. If that's a concern, the whole Google option is. |

**The one genuine exposure:** the `/exec` URL sits in `wedding.json`, which is
in a public repo. Anyone who finds it can *add* a junk row. They still can't
read anything. `Code.gs` limits the damage:

| Guard | Effect |
|---|---|
| Field allowlist | Unknown field names are dropped — nobody can invent columns |
| Name required | Blank submissions are rejected |
| Honeypot | Bots that fill the hidden field are silently discarded |
| 2000-char cap, 40-field cap | No one can bloat the sheet |
| Formula escaping | A value starting with `=` is stored as text, not executed |
| Server-side timestamp | The browser's clock is ignored |
| Errors return bare `{"ok":false}` | No stack traces leak out |

If junk ever does appear: delete the rows, then **Deploy → New deployment** to
get a fresh URL, and update `sheetEndpoint`. Realistically this won't happen —
nobody is crawling wedding repos.

**Want zero exposure?** Set `rsvp.mode` to `"none"` in `wedding.json` and put a
Google Form link in the `details` section instead. Google Forms handles spam on
its own. You lose the RSVP form being part of the page design.

### Want an email on each RSVP?

In `Code.gs`, set `YOUR_EMAIL = 'you@gmail.com'` near the bottom, then add
`notify_(data);` on the line just before `return reply({ ok: true, row: ... });`.
Redeploy (**Deploy → Manage deployments → pencil icon → Version: New version → Deploy**).

> ⚠️ **Every time you change `Code.gs` you must deploy a NEW VERSION.** Saving
> alone does nothing to the live URL. Use *Manage deployments → edit → New version*
> so the URL stays the same. Creating a *New deployment* gives you a different
> URL and you'd have to update `wedding.json` again.

---

## B. The site on GitHub Pages

### B1 — Account

If you don't have one: <https://github.com/signup>. Free tier is all you need.

### B2 — Create the repo

1. <https://github.com/new>
2. Fill in:

   | Field | Value |
   |---|---|
   | Repository name | **`wedding`** — exactly this. `site.url` is already set to match. |
   | Description | optional |
   | Visibility | **Public** — required for free GitHub Pages |
   | Add a README | **leave unticked** |
   | .gitignore / licence | **None** |

3. **Create repository.**

### B3 — Stage the files

Don't upload this folder as-is — `originals/` is 6 MB of full-size photos with
GPS data still in them, and it doesn't belong on a public repo.

Run this once (double-click `start-site.bat` won't do it; use PowerShell in this folder):

```powershell
python build.py --package
```

That creates **`upload-to-github/`** containing exactly what should go up.
Rerun it any time you change content, and re-upload.

### B4 — Upload

1. On your new empty repo page, click **uploading an existing file**.
2. Open `upload-to-github/` in Explorer.
3. Select **everything inside it** (Ctrl+A) and drag onto the browser.
   - Drag the *contents*, not the folder itself — otherwise the site ends up
     one level too deep and Pages serves a 404.
   - The `photos` and `rsvp-apps-script` folders come along with the drag.
4. Commit message: `initial site`. Click **Commit changes**.

> Windows Explorer may not include `.nojekyll` in a drag. It's optional here —
> skip it, or add it later with **Add file → Create new file**, name it
> `.nojekyll`, leave it empty, commit.

### B5 — Turn Pages on

1. Repo → **Settings** → **Pages** (left sidebar).
2. Under *Build and deployment*:
   - Source: **Deploy from a branch**
   - Branch: **main** · folder: **/ (root)**
3. **Save.**

Wait 1–3 minutes, refresh the page, and your site is live at:

```
https://joyaljoymadeckal.github.io/wedding/
```

### B6 — Already done

`site.url` is set, the `<meta>` tags are written, and `qr.png` is generated for
printed invitations. Nothing to do here — **as long as you name the repo
`wedding`**. If you name it something else, change `site.url` in `wedding.json`
to match, rerun `python build.py --package`, and re-upload `index.html`.

Before mass-sending the link: paste it into a WhatsApp chat with yourself and
check the preview card. WhatsApp caches previews aggressively, so a wrong one is
painful to fix after 200 people have it.

---

## Editing content after launch

Two routes:

| Route | How | Good for |
|---|---|---|
| **Straight on GitHub** | Open `wedding.json` in the repo → pencil icon → edit → Commit | Fixing a typo, changing a venue, updating the RSVP date. Live in ~1 min. |
| **Locally, then re-upload** | Edit → `python build.py --package` → re-upload changed files | Adding photos, or anything that changes the meta tags |

The site reads `wedding.json` in the browser at page load, so editing it
directly on GitHub genuinely updates the live site — no rebuild needed. The one
exception is the `<title>` and social-preview tags, which only `build.py` writes.

**Adding photos:** drop them into `originals/ring/` or `originals/wedding/`
(create those folders), run `python build.py --package`, re-upload the `photos`
folder and `photos.json`.

---

## "Public repo — can anyone change it?"

No.

| Who | Can do |
|---|---|
| You | Everything |
| Collaborators you explicitly invite | Everything you grant |
| Everyone else | Read the code. Open a Pull Request, which sits there until *you* approve it. Nothing more. |

Public means readable, not writable. There's no action needed to lock it down.

Optional hardening once things are live — **Settings → Branches → Add branch
ruleset** on `main` to require a PR even from yourself. Useful if you'd rather
not fat-finger a change at 1am; unnecessary otherwise.

### What *is* worth knowing

| Thing | Reality |
|---|---|
| Photos in `photos/` | Publicly downloadable by URL. `build.py` strips EXIF including GPS, so no location leaks — but the images themselves are open. |
| `originals/` | Gitignored and excluded from `--package`. Keep it that way. |
| Guest addresses / phone numbers | Anything you type into `wedding.json` is public. Put personal contact numbers in there only if you're happy with that. |
| RSVP replies | Live in your private Google Sheet. Never touch the repo. |
| The Apps Script URL | Visible in `wedding.json`. Worst case a spammer posts junk rows into your sheet. If that ever happens, redeploy the script (new URL) and update `wedding.json`. |

---

## Later: a real domain

Optional, ~$10–15/year — the only thing on this page that costs money.

1. Buy from Porkbun, Namecheap or Cloudflare Registrar.
2. Repo → **Settings → Pages → Custom domain** → enter it → Save.
3. At your registrar, add the DNS records GitHub shows you (four `A` records
   for the apex, or a `CNAME` to `YOUR-USERNAME.github.io` for `www`).
4. Tick **Enforce HTTPS** once the certificate provisions (up to an hour).
5. Update `site.url` in `wedding.json`, rerun `build.py --package`, re-upload.

A custom domain also makes the QR code on printed invitations much shorter and
less ugly.

---

## Quick troubleshooting

| Symptom | Cause |
|---|---|
| Page loads but is blank / "can't load content" | Files went up one folder deep. Repo root must contain `index.html` directly. |
| Photos missing | `photos/` folder wasn't uploaded, or `photos.json` is stale — rerun `--package`. |
| RSVP says "that didn't send" | `sheetEndpoint` still says PLACEHOLDER, or the deployment isn't set to "Anyone". Test the `/exec` URL in a browser (A4). |
| RSVP silently succeeds, no row appears | Sheet tab isn't named `RSVP`, or you edited `Code.gs` without deploying a new version. |
| WhatsApp preview shows no image | `site.url` still `example.com`, or you changed it and didn't rerun `build.py`. |
| Changes not showing | Pages takes ~1 min to redeploy. Then hard-refresh (Ctrl+Shift+R). |
