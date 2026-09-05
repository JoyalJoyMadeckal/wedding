#!/usr/bin/env python3
"""
build.py — turns a folder of photos + wedding.json into a deployable site.

Install once:
    pip install pillow "qrcode[pil]"

Everyday use:
    python build.py                 # process photos, write photos.json, patch meta
    python build.py --serve         # ...then serve on http://localhost:8000
    python build.py --serve --watch # ...and rebuild whenever you add/remove a photo

What it does
------------
originals/*.jpg          ->  the big left-hand panel  (untagged)
originals/ring/*.jpg     ->  the ring-exchange card   (tag "ring")
originals/wedding/*.jpg  ->  the wedding card         (tag "wedding")

Each one becomes photos/<name>.jpg + .webp, resized with EXIF stripped, and is
listed in photos.json. The subfolder name must match the event's "photoTag" in
wedding.json. Order follows filename, so prefix them 01-, 02-, 03-.

Also written: photos/share.jpg (social preview), the <!-- meta:start --> block
in index.html, and qr.png for printed cards.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# ── settings ────────────────────────────────────────────────────
ROOT = Path(__file__).parent
SRC = ROOT / "originals"          # you drop photos in here
OUT = ROOT / "photos"             # generated, safe to delete
CONTENT = ROOT / "wedding.json"
MANIFEST = ROOT / "photos.json"
PAGE = ROOT / "index.html"

MAX_WIDTH = 1600
JPEG_QUALITY = 82
WEBP_QUALITY = 78
SHARE_SIZE = (1200, 630)
EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff", ".bmp"}
# ────────────────────────────────────────────────────────────────


def load_content() -> dict:
    if not CONTENT.exists():
        sys.exit(f"Missing {CONTENT.name}. It holds all the wording for the site.")
    try:
        return json.loads(CONTENT.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"{CONTENT.name} is not valid JSON — line {e.lineno}, column {e.colno}: {e.msg}")


# ── photos ──────────────────────────────────────────────────────
def source_photos() -> list[Path]:
    """Every image under originals/, including subfolders.

    A subfolder name becomes the photo's tag, which is how a photo gets
    attached to one event:
        originals/ring/*.jpg     -> tag "ring"    -> shows on the ring-exchange card
        originals/wedding/*.jpg  -> tag "wedding" -> shows on the wedding card
        originals/*.jpg          -> no tag        -> shows in the big left-hand panel
    """
    if not SRC.is_dir():
        SRC.mkdir()
        return []
    return sorted(
        (p for p in SRC.rglob("*")
         if p.is_file() and p.suffix.lower() in EXTS and not p.name.startswith(".")),
        key=lambda p: (tag_of(p), p.name),
    )


def tag_of(path: Path) -> str:
    """Folder name directly under originals/, or '' for loose files."""
    rel = path.relative_to(SRC).parts
    return rel[0] if len(rel) > 1 else ""


def stem_of(path: Path) -> str:
    """Flat, unique output name — 'ring/02 party.jpg' becomes 'ring-02-party'."""
    rel = path.relative_to(SRC).with_suffix("")
    return re.sub(r"[^a-z0-9]+", "-", str(rel).lower()).strip("-") or "photo"


def previous_entries() -> dict[str, dict]:
    """Keep captions/alt the user typed into photos.json across rebuilds."""
    if not MANIFEST.exists():
        return {}
    try:
        old = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return {Path(p.get("jpg", "")).stem: p for p in old.get("photos", [])}


def process_photos(force: bool = False) -> list[dict]:
    from PIL import Image, ImageOps

    files = source_photos()
    if not files:
        return []

    OUT.mkdir(exist_ok=True)
    kept = previous_entries()
    entries: list[dict] = []
    live_stems = set()

    for path in files:
        stem = stem_of(path)
        live_stems.add(stem)
        jpg, webp = OUT / f"{stem}.jpg", OUT / f"{stem}.webp"

        fresh = jpg.exists() and jpg.stat().st_mtime >= path.stat().st_mtime
        if force or not fresh:
            try:
                img = Image.open(path)
            except Exception as e:                      # noqa: BLE001
                print(f"  skipped {path.name}: {e}")
                continue
            img = ImageOps.exif_transpose(img).convert("RGB")   # honour phone rotation
            if img.width > MAX_WIDTH:
                h = round(img.height * MAX_WIDTH / img.width)
                img = img.resize((MAX_WIDTH, h), Image.LANCZOS)
            # re-saving without the original info dict drops EXIF, including GPS
            img.save(jpg, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            img.save(webp, "WEBP", quality=WEBP_QUALITY, method=6)
            label = str(path.relative_to(SRC))
            print(f"  {label:<32} -> {stem}  ({img.width}px, {jpg.stat().st_size // 1024} KB)")

        prev = kept.get(stem, {})
        entries.append({
            "jpg": f"photos/{stem}.jpg",
            "webp": f"photos/{stem}.webp",
            "tag": tag_of(path),
            "alt": prev.get("alt", ""),
        })

    # sweep generated files whose original was removed
    for old in OUT.glob("*"):
        if old.stem not in live_stems and old.name != "share.jpg":
            old.unlink()
            print(f"  removed {old.name} (original gone)")

    if entries:
        make_share_image(ROOT / entries[0]["jpg"])
    return entries


def make_share_image(source: Path) -> None:
    from PIL import Image, ImageOps
    img = ImageOps.fit(Image.open(source), SHARE_SIZE, Image.LANCZOS, centering=(0.5, 0.38))
    img.save(OUT / "share.jpg", "JPEG", quality=88, optimize=True)


def write_manifest(entries: list[dict]) -> None:
    MANIFEST.write_text(json.dumps({
        "_readme": "Generated by build.py. 'tag' comes from the subfolder under originals/ and decides which event a photo belongs to. Order follows filename — prefix with 01-, 02- to reorder. Alt text you add here survives rebuilds.",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "photos": entries,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ── meta tags ───────────────────────────────────────────────────
def patch_meta(data: dict) -> None:
    if not PAGE.exists():
        return
    site = data.get("site", {})
    couple = data.get("couple", {})

    base = (site.get("url") or "").rstrip("/")
    names = f"{couple.get('partnerOne', '')} & {couple.get('partnerTwo', '')}".strip(" &")
    dates = " · ".join(
        f.get("shortDate") or f.get("dateLabel", "")
        for f in data.get("functions", []) if f.get("shortDate") or f.get("dateLabel")
    )
    title = names + (f" — {dates}" if dates else "")
    desc = site.get("description") or f"{names} are getting married. Details and RSVP."
    share = site.get("shareImage", "photos/share.jpg")
    image = share if share.startswith("http") else f"{base}/{share.lstrip('/')}"
    theme = data.get("theme", {}).get("inkDeep", "#171522")

    e = html.escape
    block = "\n".join([
        "<!-- meta:start -->",
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{e(names)} are getting married">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:image" content="{e(image)}">',
        f'<meta property="og:url" content="{e(base)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="theme-color" content="{e(theme)}">',
        "<!-- meta:end -->",
    ])

    src = PAGE.read_text(encoding="utf-8")
    new, n = re.subn(r"<!-- meta:start -->.*?<!-- meta:end -->", block, src, flags=re.S)
    if n and new != src:
        PAGE.write_text(new, encoding="utf-8")
        print("  index.html meta tags updated")
    if base.startswith("https://example.com") or not base:
        print("  note: set site.url in wedding.json — WhatsApp previews need a real domain")


# ── qr ──────────────────────────────────────────────────────────
def make_qr(url: str, ink: str) -> None:
    if not url or "example.com" in url:
        print("  qr.png skipped — set a real site.url first")
        return
    try:
        import qrcode
        from qrcode.constants import ERROR_CORRECT_H
    except ImportError:
        print('  qr.png skipped — pip install "qrcode[pil]"')
        return
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=14, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image(fill_color=ink, back_color="white").save(ROOT / "qr.png")
    print(f"  qr.png -> {url}")


# ── orchestration ───────────────────────────────────────────────
def build(force: bool = False) -> None:
    print(f"[{datetime.now():%H:%M:%S}] building")
    data = load_content()
    try:
        entries = process_photos(force)
    except ImportError:
        sys.exit("Pillow is not installed. Run: pip install pillow")
    write_manifest(entries)
    patch_meta(data)
    make_qr((data.get("site", {}).get("url") or "").rstrip("/"),
            data.get("theme", {}).get("ink", "#22202B"))
    if entries:
        counts: dict[str, int] = {}
        for e in entries:
            counts[e["tag"]] = counts.get(e["tag"], 0) + 1
        for tag in sorted(counts, key=lambda t: (t == "", t)):
            where = f'{tag}/' if tag else 'main panel'
            print(f"  {counts[tag]:>3} photo(s) -> {where}")
        unknown = set(counts) - {""} - known_tags(data)
        if unknown:
            print(f"  warning: no event uses photoTag {sorted(unknown)} — check wedding.json")
    else:
        print(f"  no photos yet — drop some in {SRC.name}/")


def package() -> None:
    """Copy exactly what GitHub Pages needs into upload-to-github/.

    Everything in that folder can be dragged straight onto github.com. The
    full-size originals/ and local-only files are deliberately left out.
    """
    import shutil

    dest = ROOT / "upload-to-github"
    if dest.exists():
        # clear it out, but don't die on a file the OS won't let us delete
        # (OneDrive and synced folders sometimes hold a lock)
        for p in sorted(dest.rglob("*"), key=lambda q: len(q.parts), reverse=True):
            try:
                p.unlink() if p.is_file() else p.rmdir()
            except OSError:
                pass
    dest.mkdir(exist_ok=True)

    files = ["index.html", "wedding.json", "photos.json", "README.md",
             "DEPLOY.md", "build.py", ".nojekyll"]
    for name in files:
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, dest / name)

    if OUT.is_dir():
        shutil.copytree(OUT, dest / "photos", dirs_exist_ok=True)

    script_dir = ROOT / "rsvp-apps-script"
    if script_dir.is_dir():
        shutil.copytree(script_dir, dest / "rsvp-apps-script", dirs_exist_ok=True)

    total = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file())
    count = sum(1 for p in dest.rglob("*") if p.is_file())
    print(f"  upload-to-github/ ready — {count} files, {total // 1024} KB")
    print("  drag everything INSIDE that folder onto github.com (not the folder itself)")


def known_tags(data: dict) -> set[str]:
    """photoTag values declared by the events in wedding.json."""
    out = set()
    for fn in data.get("functions", []):
        out.add(fn.get("photoTag", fn.get("id", "")))
    return {t for t in out if t}


def fingerprint() -> tuple:
    files = tuple((p.name, p.stat().st_mtime) for p in source_photos())
    content = CONTENT.stat().st_mtime if CONTENT.exists() else 0
    return files, content


def free_port(start: int, tries: int = 20) -> int:
    """First open port at or after `start`, so a second copy doesn't collide."""
    import socket
    for port in range(start, start + tries):
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("", port))
                return port
            except OSError:
                continue
    return start


def open_chrome(url: str) -> None:
    """New Chrome window if Chrome is installed, otherwise the default browser."""
    import shutil
    import subprocess
    import webbrowser

    candidates = []
    if sys.platform == "win32":
        import os
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
            base = os.environ.get(var)
            if base:
                candidates.append(Path(base) / "Google/Chrome/Application/chrome.exe")
    elif sys.platform == "darwin":
        candidates.append(Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))
    else:
        for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
            found = shutil.which(name)
            if found:
                candidates.append(Path(found))

    for exe in candidates:
        if exe.exists():
            try:
                subprocess.Popen([str(exe), "--new-window", url],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except OSError:
                break

    webbrowser.open(url)


def serve(port: int, watch: bool, open_browser: bool = False) -> None:
    import functools
    import http.server
    import socketserver
    import threading

    port = free_port(port)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), handler) as httpd:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = f"http://localhost:{port}"
        print(f"\nServing {url}  (Ctrl+C, or just close this window, to stop)")
        if watch:
            print(f"Watching {SRC.name}/ and {CONTENT.name} — add a photo, then refresh.\n")
        if open_browser:
            threading.Timer(1.0, open_chrome, args=(url,)).start()
        try:
            last = fingerprint()
            while True:
                time.sleep(1.5)
                if watch:
                    now = fingerprint()
                    if now != last:
                        last = now
                        build()
        except KeyboardInterrupt:
            print("\nStopped.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the wedding site.")
    ap.add_argument("--serve", action="store_true", help="serve the folder over http")
    ap.add_argument("--watch", action="store_true", help="rebuild when photos or wedding.json change")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--open", action="store_true",
                    help="open a new Chrome window on the port actually used")
    ap.add_argument("--force", action="store_true", help="reprocess every photo from scratch")
    ap.add_argument("--package", action="store_true",
                    help="stage a clean upload-to-github/ folder for browser upload")
    args = ap.parse_args()

    build(force=args.force)
    if args.package:
        package()
    if args.serve or args.watch:
        serve(args.port, args.watch, open_browser=args.open)


if __name__ == "__main__":
    main()
