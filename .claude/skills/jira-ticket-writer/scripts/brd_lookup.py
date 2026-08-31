#!/usr/bin/env python3
"""Look up requirement codes in the BRD .docx so ticket text quotes the real rule.

The BRD is a Word file, so grep does not work on it directly. This unpacks it once
into a cached .txt next to the source and then searches that.

Usage:
    python brd_lookup.py BR-CTZ-10 RULE-05 NFR-09       # look up specific codes
    python brd_lookup.py --toc                          # list the BRD's own section list
    python brd_lookup.py --section "Khung giờ"          # dump the section whose heading matches
    python brd_lookup.py --grep "giữ chỗ"               # free-text search

Default BRD path: docs/BRD-Multi-Tenant-Booking-Platform.docx (override with --brd).
Exit code is 0 when every requested code was found, 1 when any was missing.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import sys
import zipfile

# Windows consoles default to a legacy codepage that cannot encode Vietnamese, which
# turns every print into a crash. Force UTF-8 so callers do not need PYTHONIOENCODING.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

DEFAULT_BRD = os.path.join("docs", "BRD-Multi-Tenant-Booking-Platform.docx")
CODE_RE = re.compile(r"^(BR-[A-Z]{3}|RULE|NFR|OBJ|KPI|DEC|RSK|ASM|DEP|CON|UC-[A-Z]{3})-\d+$")


def docx_to_text(docx_path: str) -> str:
    """Extract paragraph/table text from a .docx, preserving row and cell breaks."""
    with zipfile.ZipFile(docx_path) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    xml = xml.replace("</w:p>", "\n").replace("</w:tc>", "\t").replace("</w:tr>", "\n")
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    text = html.unescape(re.sub(r"<[^>]+>", "", xml))
    return re.sub(r"\n{3,}", "\n\n", text)


def load_text(brd_path: str, refresh: bool = False) -> str:
    """Return BRD plain text, caching alongside the .docx so repeat lookups are instant."""
    cache = os.path.splitext(brd_path)[0] + ".extracted.txt"
    fresh = (
        not refresh
        and os.path.exists(cache)
        and os.path.getmtime(cache) >= os.path.getmtime(brd_path)
    )
    if fresh:
        with open(cache, encoding="utf-8") as fh:
            return fh.read()

    text = docx_to_text(brd_path)
    try:
        with open(cache, "w", encoding="utf-8") as fh:
            fh.write(text)
    except OSError:
        pass  # read-only checkout is fine; we just lose the cache
    return text


def show_code(text: str, code: str, context: int) -> bool:
    """Print every paragraph mentioning `code`. Returns False if the code is absent.

    A code that is absent matters: it means the ticket must not cite it. Inventing
    requirement codes is the single most damaging mistake in a ticket, because
    reviewers trust them as traceable to the signed BRD.
    """
    lines = text.split("\n")
    hits = [i for i, line in enumerate(lines) if code in line]
    if not hits:
        print(f"  !! {code} NOT FOUND in the BRD — do not cite it.")
        return False

    print(f"  == {code} — {len(hits)} mention(s)")
    for i in hits:
        for j in range(max(0, i - context), min(len(lines), i + context + 1)):
            body = lines[j].strip()
            if body:
                print(("  >  " if j == i else "     ") + body)
        print()
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("codes", nargs="*", help="requirement codes, e.g. BR-CTZ-10 RULE-05")
    ap.add_argument("--brd", default=DEFAULT_BRD, help="path to the BRD .docx")
    ap.add_argument("--grep", help="free-text search instead of a code lookup")
    ap.add_argument("--section", help='heading text to dump, e.g. "Khung giờ" or "Thanh toán"')
    ap.add_argument("--toc", action="store_true", help="list the BRD's own table of contents")
    ap.add_argument("--context", type=int, default=1, help="paragraphs of context per hit (default 1)")
    ap.add_argument("--refresh", action="store_true", help="re-extract even if the cache is current")
    args = ap.parse_args()

    if not os.path.exists(args.brd):
        print(f"BRD not found: {args.brd}", file=sys.stderr)
        return 2

    text = load_text(args.brd, refresh=args.refresh)
    lines = text.split("\n")

    # Word stores its table of contents as PAGEREF fields; those lines are the real
    # section list, and they are also the lines a body search must ignore.
    def is_toc_line(line: str) -> bool:
        return "PAGEREF" in line

    if args.toc:
        for line in lines:
            if is_toc_line(line):
                cleaned = re.sub(r"\s*PAGEREF.*$", "", line).strip()
                if cleaned:
                    print(cleaned)
        return 0

    if args.section:
        needle = args.section.lower()

        # Anchor on the document's own table of contents. Searching the body directly
        # matches table cells that merely mention the words, which lands nowhere useful.
        titles = []
        for line in lines:
            if is_toc_line(line):
                cleaned = re.sub(r"\s*PAGEREF.*$", "", line).strip()
                cleaned = re.sub(r"^[\d.]+\s*", "", cleaned)  # drop "9. " style numbering
                if cleaned:
                    titles.append(cleaned)

        matches = [t for t in titles if needle in t.lower()]
        if not matches:
            print(f'No section matching "{args.section}". Run --toc to see the list.', file=sys.stderr)
            return 1
        if len(matches) > 1:
            print("Nhiều mục khớp, chọn cụ thể hơn:", file=sys.stderr)
            for t in matches:
                print(f"  - {t}", file=sys.stderr)
            return 1

        title = matches[0]
        body = [i for i, line in enumerate(lines) if not is_toc_line(line) and line.strip() == title]
        if not body:
            print(f'Found "{title}" in the contents but not in the body.', file=sys.stderr)
            return 1

        start = body[0]
        print(f"  == {title}  (dòng {start})\n")
        for line in lines[start + 1 : start + 140]:
            if line.strip():
                print(line.rstrip())
        return 0

    if args.grep:
        needle = args.grep.lower()
        for i, line in enumerate(lines):
            if needle in line.lower():
                print(f"{i:5d}  {line.strip()}")
        return 0

    if not args.codes:
        ap.print_help()
        return 2

    missing = 0
    for code in args.codes:
        if not CODE_RE.match(code):
            print(f"  ?? {code} does not look like a BRD code (expected e.g. BR-CTZ-10, RULE-05, NFR-09)")
        if not show_code(text, code, args.context):
            missing += 1
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
