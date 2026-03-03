#!/usr/bin/env python3
"""Wire blog images into posts based on manifest.json placement hints.

Reads image metadata from docs/blog/images/manifest.json and inserts
markdown image embeds into blog posts at specified positions within
the Developer Journal section.

Usage:
    python3 scripts/wire-blog-images.py --date 2026-03-05     # single date
    python3 scripts/wire-blog-images.py --all                  # all dates
    python3 scripts/wire-blog-images.py --all --dry-run        # preview only
"""

import argparse
import json
import re
import sys
from pathlib import Path

BLOG_DIR = Path(__file__).resolve().parent.parent / "docs" / "blog"
POSTS_DIR = BLOG_DIR / "posts"
IMAGES_DIR = BLOG_DIR / "images"
MANIFEST_PATH = BLOG_DIR / "images" / "manifest.json"

# Alt text fallback heuristics — used when manifest entry has no alt_text
ALT_TEXT_HEURISTICS = [
    (re.compile(r"jwst-composite-"), "JWST composite output"),
    (re.compile(r"jwst-mosaic-"), "JWST mosaic output"),
    (re.compile(r"IMG_.*\.jpe?g", re.IGNORECASE), "Photo shared in discussion"),
    (re.compile(r"^File\.png$"), "File shared in Slack"),
    (re.compile(r"^image(-\d+)?\.png$"), "Screenshot from development session"),
]


def derive_alt_text(filename: str) -> str:
    """Derive alt text from filename using pattern heuristics."""
    for pattern, alt in ALT_TEXT_HEURISTICS:
        if pattern.search(filename):
            return alt
    return f"Image: {filename}"


def find_embedded_filenames(content: str, date: str) -> set:
    """Find filenames already embedded as images for this date anywhere in the post."""
    pattern = re.compile(r"!\[.*?\]\(\.\./images/" + re.escape(date) + r"/(.+?)\)")
    return set(pattern.findall(content))


def find_journal_bounds(lines: list) -> tuple:
    """Find Developer Journal section line boundaries.

    Returns (heading_line, end_line) where end_line is the next ## heading
    or EOF. Returns (None, None) if no journal section found.
    """
    start = None
    for i, line in enumerate(lines):
        if line.strip() == "## Developer Journal":
            start = i
        elif start is not None and line.startswith("## ") and i > start:
            return start, i
    if start is not None:
        return start, len(lines)
    return None, None


def parse_blocks(lines: list) -> list:
    """Parse lines into content blocks (groups of consecutive non-empty lines).

    Returns list of (first_idx, last_idx) tuples, 0-based relative to input.
    """
    blocks = []
    i = 0
    while i < len(lines):
        if not lines[i].strip():
            i += 1
            continue
        start = i
        while i < len(lines) and lines[i].strip():
            i += 1
        blocks.append((start, i - 1))
    return blocks


def wire_date(date: str, images: list, dry_run: bool = False) -> dict:
    """Wire images for a single date into its blog post.

    Returns a stats dict with counts for reporting.
    """
    result = {
        "date": date,
        "total": len(images),
        "already_embedded": 0,
        "wired": 0,
        "missing_file": 0,
        "skipped_reason": None,
    }

    post_path = POSTS_DIR / f"{date}.md"
    if not post_path.exists():
        result["skipped_reason"] = "no post file"
        return result

    content = post_path.read_text()
    embedded = find_embedded_filenames(content, date)

    # Partition images: already embedded vs needs wiring
    to_wire = []
    for img in images:
        fn = img["filename"]
        if fn in embedded:
            result["already_embedded"] += 1
            continue

        img_path = IMAGES_DIR / date / fn
        if not img_path.exists():
            result["missing_file"] += 1
            if not dry_run:
                print(f"  WARNING: {date}/{fn} not on disk, skipping")
            continue

        alt = img.get("alt_text") or derive_alt_text(fn)
        placement = img.get("placement_hint") or "end"
        ts = img.get("timestamp") or "0"
        to_wire.append({
            "filename": fn,
            "alt_text": alt,
            "placement": placement,
            "timestamp": ts,
        })

    if not to_wire:
        return result

    # Need a Developer Journal section to know where to insert
    lines = content.split("\n")
    j_start, j_end = find_journal_bounds(lines)

    if j_start is None:
        result["skipped_reason"] = "no Developer Journal section"
        return result

    # Find first non-blank content line after the heading
    content_start = j_start + 1
    while content_start < j_end and not lines[content_start].strip():
        content_start += 1

    journal_lines = lines[content_start:j_end]
    blocks = parse_blocks(journal_lines)

    # Resolve placement hints to absolute line numbers, group images per insertion point
    insertions = {}  # absolute_line_number -> [image_dicts]

    for img in to_wire:
        p = img["placement"]
        if p == "end":
            insert_line = j_end
        elif p.startswith("after:"):
            try:
                n = int(p.split(":")[1])
            except (ValueError, IndexError):
                insert_line = j_end
            else:
                if n < 1 or n > len(blocks):
                    # Paragraph doesn't exist — fall back to end
                    if not dry_run:
                        print(f"  WARNING: {date}/{img['filename']} — "
                              f"placement after:{n} out of range "
                              f"(journal has {len(blocks)} blocks), using end")
                    insert_line = j_end
                else:
                    _, block_last_rel = blocks[n - 1]
                    insert_line = content_start + block_last_rel + 1
        else:
            insert_line = j_end

        insertions.setdefault(insert_line, []).append(img)

    # Sort images within each insertion group by timestamp
    for group in insertions.values():
        group.sort(key=lambda x: x["timestamp"])

    if dry_run:
        result["wired"] = sum(len(g) for g in insertions.values())
        for line_num in sorted(insertions):
            for img in insertions[line_num]:
                print(f"  WOULD INSERT: {date}/{img['filename']} "
                      f"(alt: \"{img['alt_text']}\") at line {line_num}")
        return result

    # Insert bottom-to-top so earlier line numbers stay valid
    for line_num in sorted(insertions, reverse=True):
        new_lines = []
        for img in insertions[line_num]:
            new_lines.append("")
            new_lines.append(
                f"![{img['alt_text']}](../images/{date}/{img['filename']})"
            )
        new_lines.append("")

        for j, nl in enumerate(new_lines):
            lines.insert(line_num + j, nl)

    # Normalize: collapse 3+ consecutive newlines to 2 (one blank line)
    result_text = "\n".join(lines)
    result_text = re.sub(r"\n{3,}", "\n\n", result_text)
    post_path.write_text(result_text)

    result["wired"] = sum(len(g) for g in insertions.values())
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Wire blog images into posts based on manifest.json placement hints"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--date", help="Single date to process (YYYY-MM-DD)")
    group.add_argument("--all", action="store_true", help="Process all dates in manifest")
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without writing files"
    )
    args = parser.parse_args()

    if not MANIFEST_PATH.exists():
        print(f"ERROR: Manifest not found at {MANIFEST_PATH}")
        sys.exit(1)

    manifest = json.loads(MANIFEST_PATH.read_text())

    if args.date:
        if args.date not in manifest:
            print(f"WARNING: No manifest entries for {args.date}")
            return
        dates = [args.date]
    else:
        dates = sorted(manifest.keys())

    totals = {
        "processed": 0,
        "already_embedded": 0,
        "wired": 0,
        "missing_file": 0,
        "skipped": 0,
    }

    for date in dates:
        images = manifest.get(date, [])
        if not images:
            continue

        r = wire_date(date, images, dry_run=args.dry_run)

        if r["skipped_reason"]:
            print(f"  {date}: skipped — {r['skipped_reason']}")
            totals["skipped"] += 1
        elif r["wired"] == 0 and r["already_embedded"] == r["total"]:
            print(f"  {date}: all {r['total']} images already embedded")
        elif r["wired"] == 0:
            parts = []
            if r["already_embedded"]:
                parts.append(f"{r['already_embedded']} already embedded")
            if r["missing_file"]:
                parts.append(f"{r['missing_file']} missing files")
            print(f"  {date}: {', '.join(parts)}")
        else:
            verb = "would wire" if args.dry_run else "wired"
            print(f"  {date}: {verb} {r['wired']}, "
                  f"already embedded {r['already_embedded']}, "
                  f"missing {r['missing_file']}")

        totals["processed"] += 1
        totals["already_embedded"] += r["already_embedded"]
        totals["wired"] += r["wired"]
        totals["missing_file"] += r["missing_file"]

    verb = "would be wired" if args.dry_run else "wired"
    print(f"\nSummary: {totals['processed']} dates processed, "
          f"{totals['wired']} {verb}, "
          f"{totals['already_embedded']} already embedded, "
          f"{totals['skipped']} skipped, "
          f"{totals['missing_file']} missing files")


if __name__ == "__main__":
    main()
