# Wedding invitation site — ring exchange + wedding

Content lives in `wedding.json`. Photos live in folders. `build.py` glues them together.

```
wedding/
├── index.html          the site — you shouldn't need to edit this
├── wedding.json        ← all your wording, dates, venues, colours
├── build.py            ← run this after any change
├── originals/          ← photos go here
│   ├── 01-portrait.jpg     loose files → the big left-hand panel
│   ├── ring/               → the ring exchange card
│   └── wedding/            → the wedding card
├── photos/             generated: resized .jpg + .webp, share.jpg
├── photos.json         generated: the photo manifest
└── qr.png              generated: QR code for printed cards
```

## Setup

```bash
pip install pillow "qrcode[pil]"
mkdir -p originals/ring originals/wedding
python build.py --serve --watch     # open http://localhost:8000
```

With `--watch` running, drop in a photo or save `wedding.json` and it rebuilds
on its own. Just refresh.

> **You can't open `index.html` by double-clicking.** It reads JSON over `fetch`,
> which browsers block on `file://`. The page says so if you try. Use `--serve`.

## Layout

| Screen | Behaviour |
|---|---|
| Desktop (≥960px) | Photos pinned to the left half, details scroll on the right |
| Mobile | Photo panel becomes a 62%-height hero, details scroll beneath |

The names and both dates sit on the photo panel, so on desktop they stay in
view the entire time someone scrolls the details.

## The two events

Both live in the `functions` array. Add a third (sangeet, mehndi, brunch) by
copying a block — the nav, the cards, and the RSVP all grow to match.

| Field | What it does |
|---|---|
| `id` | Short key. Becomes the anchor `#ring`, the photo subfolder, and the RSVP field names |
| `accent` | `sage`, `rose`, `tan`, or `terracotta` — colours the card's left edge, heading and buttons |
| `date` | `YYYY-MM-DDTHH:MM`. Only feeds the countdown, which tracks the **next** upcoming event |
| `dateLabel` | The date as you want it written. Free text |
| `shortDate` | The compact form shown on the photo panel and in the RSVP |
| `tags` | Small pills — dress code, parking, whether food is provided |
| `photoTag` | Which `originals/` subfolder feeds this card's slideshow |

The two events are told apart by colour: sage for the ring exchange, dusty rose
for the wedding. Change `accent` to swap them.

### Sending a different link per guest group

Some people are invited to one event, not both. Add `?for=` to the link:

| Link | Shows |
|---|---|
| `yoursite.com` | Both events |
| `yoursite.com/?for=ring` | Ring exchange only, and the RSVP asks about it only |
| `yoursite.com/?for=wedding` | Wedding only |

Nothing is hidden from anyone who edits the URL — it's for convenience, not privacy.

## Photos

| Thing | How it works |
|---|---|
| Adding | Any image under `originals/` is picked up, including subfolders |
| Which event | The subfolder name must match that event's `photoTag` |
| Order | Alphabetical by filename — name them `01-`, `02-`, `03-` |
| Removing | Delete from `originals/`; the next build sweeps the generated copies |
| Processing | Resized to 1600px, saved as JPEG + WebP, EXIF stripped (**including GPS**) |
| Speed | Only changed photos are reprocessed. `--force` redoes everything |
| Alt text | Type it into `photos.json`; it survives rebuilds |

Loose files directly in `originals/` feed the big left panel. If you put
everything in subfolders and leave none loose, the panel uses all of them.
`build.py` warns you if a subfolder doesn't match any event's `photoTag`.

## RSVP

Each event gets its own yes/no and headcount, submitted as one form. Field names
follow the event `id`: `ring_attending`, `ring_guests`, `wedding_attending`,
`wedding_guests`. Choosing "sadly no" zeroes and disables that event's headcount.

| Mode | Host | Setup |
|---|---|---|
| `gsheet` ← **current** | Anywhere | Apps Script on a Google Sheet. Paste its `/exec` URL into `rsvp.sheetEndpoint`. See `DEPLOY.md` part A |
| `netlify` | Netlify only | Nothing. Replies appear under **Forms** |
| `formspree` | Anywhere | Sign up at formspree.io, paste the endpoint into `rsvp.formspreeEndpoint` |
| `none` | Anywhere | Section hidden; link a Google Form from `details` instead |

## Colours

From the palette you sent. Three of the five are too light to put text on
(sage 2.5:1, tan 2.2:1, beige 1.4:1 against paper), so each has a darkened
sibling used for headings and links, while the original stays for fills, edges
and bands. Everything reads at 5:1 or better.

| Role | Hex |
|---|---|
| Sage Green | `#98A086` fill · `#5F6B52` text |
| Dusty Rose | `#A76D5E` fill · `#7E4E42` text |
| Golden Tan | `#C4A071` fill · `#8A6B41` text |
| Warm Beige | `#DFCCB1` fill only |
| Terracotta Brown | `#846044` fill and text · `#5E4430` hover |
| Paper / ink | `#FAF5EC` · `#3A2C22` |

All of it lives in `theme` in `wedding.json`. Change a value there and the whole
site follows.

## Deploy

**Full step-by-step: [`DEPLOY.md`](DEPLOY.md).** Short version:

```bash
python build.py --package      # stages upload-to-github/
```

Then drag the *contents* of `upload-to-github/` onto a public GitHub repo and
switch on Settings → Pages. RSVP goes to a Google Sheet, so it works on any
host. Never upload `originals/` — it's full-size photos and stays local.

| Host | How | RSVP |
|---|---|---|
| **GitHub Pages** ← current | Upload, then Settings → Pages | Google Sheet |
| **Netlify** | Drag the folder onto app.netlify.com/drop | Built in, or Google Sheet |
| **Cloudflare Pages** | Connect a Git repo, or drag-drop | Google Sheet |
| **Vercel** | `vercel deploy` | Google Sheet |

Buy a domain (~$12–20/yr from Porkbun or Namecheap), point it at your host, put
it in `site.url`, and rerun `build.py` so the meta tags and QR code match.

## Two things people get wrong

- **The WhatsApp preview.** `og:image` must be an absolute URL. `build.py`
  writes it from `site.url`, so set that before you share the link.
- **Testing.** Send the link to yourself first. WhatsApp caches previews hard,
  so fix the meta tags *before* it goes out to 200 people.

## Design notes

Nature-inspired palette on warm paper. Gilda Display for headings, Karla for
text. The photo panel is the constant; the details scroll past it. Each event
is identified by its accent colour rather than by a label, so the two are
distinguishable at a glance while scrolling.
