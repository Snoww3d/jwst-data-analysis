---
name: enrich-blog
description: Write the Blog — find the gap since the last post, create posts for every working day, sort inbox images, enrich with Slack journal content, and wire images into posts. Triggers on "write the blog", "update blog", "blog posts", "enrich blog", "/enrich-blog".
---

# Write the Blog

The complete blog workflow: find the gap since the last post, create posts for every working day in that gap, sort inbox images to the correct dates, enrich everything with Slack journal content, and wire images into posts.

This is the single entry point for "write the blog." It replaces the old multi-step process of generate → enrich → wire.

## Arguments

- `--date YYYY-MM-DD` — write/update a single date
- `--from YYYY-MM-DD --to YYYY-MM-DD` — write a date range
- `--refresh` — re-enrich already-enriched posts (fetches fresh Slack data, regenerates journal)
- *(no arguments)* — **default behavior**: find the last existing post in `docs/blog/posts/`, then create and enrich all posts from the day after that post through today (from `currentDate` context). If today's post already exists and is enriched, enter refresh mode for today only.

## Process Overview

```
1. Determine date range (gap detection)
2. Gather data for each date (git log, Slack, inbox images)
3. Sort inbox images to correct date folders
4. Create or update blog posts
5. Wire images into posts
6. Update manifest
7. Clean inbox
```

## Step 1: Determine Date Range

Find the most recent `.md` file in `docs/blog/posts/` by filename (they're named `YYYY-MM-DD.md`). The target range is **the day after that file's date** through **today**.

- If no arguments are given and there's no gap (last post is today), enter refresh mode for today.
- If `--date` or `--from/--to` is given, use those dates instead of gap detection.
- Skip dates with zero git commits AND zero Slack messages — don't create empty posts.

## Step 2: Gather Data Per Date

For each date in the range, gather three data sources in parallel where possible:

### 2a. Git Log

**IMPORTANT**: Use fully expanded ISO date strings. Never use shell arithmetic like `$((d-1))` or command substitution — these trigger security prompts.

```bash
git log --format="%h %s" --since="2026-03-16T00:00:00" --until="2026-03-16T23:59:59"
```

Run one git log command per date with the full date string. Extract PR numbers, titles, and commit types. Group by category (Feature, Bug Fix, Performance, etc.).

### 2b. Slack Journal

Read messages from both channels for the target date:

- **Primary**: `C0AHUQKEYB1` (#devblog) — project updates, debugging stories, screenshots
- **Secondary**: `C064NSLUK19` (#artificial-intelligence) — AI tool discussions, Claude Code usage

Use `mcp__claude_ai_Slack__slack_read_channel` with `oldest`/`latest` Unix timestamps for the target date (midnight to midnight PDT).

Also use `mcp__claude_ai_Slack__slack_search_public_and_private` with `content_types="files"` and `type:images on:YYYY-MM-DD in:#devblog` to get the file list for the date. This is essential for matching images to messages.

### 2c. Inbox Images

Check `docs/blog/images/jwst-inbox/` for any files. These need to be sorted into date folders (Step 3).

## Step 3: Sort Inbox Images

This is the step that requires the most care. Images in the inbox are generic (`image (N).png`) with no date information in the filename. The process:

### 3a. Count and categorize

- **Timestamped files** (e.g., `jwst-composite-2026-03-10T15-57-55.png`) → date is embedded in the filename.
- **Generic files** (`image (N).png`, `image.png`) → date must be determined from Slack.

### 3b. Match generic images to Slack messages

The numbered `image (N).png` files from the inbox correspond to the chronologically-ordered generic `image.png` file attachments across ALL dates in the range. To match them:

1. Collect all Slack file search results for the date range, filtered to `type:images`
2. Separate named files (composites, mosaics) from generic `image.png` files
3. Sort the generic files chronologically by their Slack `Created` timestamp
4. The inbox `image (7).png` through `image (N).png` map to this chronological list — image (7) is the 1st generic file, image (8) is the 2nd, etc. (The starting number depends on what's already been processed; check what's NOT already in a date folder.)
5. Each generic file inherits its date from the Slack message it was attached to

### 3c. Verify with content

After the timestamp-based mapping, verify each image by reading it and confirming the visual content matches the Slack message context. For example:
- Message says "feathering worked but not perfect" → image should show a composite with feathered edges
- Message says "nasas version when you separate the two" → image should show a NASA reference comparison

If any mapping looks wrong, flag it rather than silently placing the image in the wrong folder.

### 3d. Copy to date folders and capture metadata

For each image:

1. Create `docs/blog/images/YYYY-MM-DD/` if it doesn't exist
2. Copy with a descriptive filename (not `image (7).png` — use content-derived names like `cartwheel-composite.png`, `pillars-mobile-export.png`)
3. Capture metadata using `sips -g pixelWidth -g pixelHeight`:
   - `width` and `height` in pixels
   - `message_context` from the Slack message text
   - `timestamp` from the Slack message `ts` value
   - `alt_text` — 10-20 word description based on visual content + message context

### 3e. Remove sorted images from inbox

**ONLY delete inbox images after the commit containing them has been pushed and merged to main.** Not after copying. Not after committing locally. After merge. The inbox is the only source of truth until images are safely in the remote repo — deleting before merge risks permanent data loss if a branch conflict requires re-checkout.

## Step 4: Create or Update Blog Posts

For each date in the range:

### Post structure

```markdown
---
date:
  created: YYYY-MM-DD
categories:
  - [derived from PR types: Feature, Bug Fix, Performance, Compositing, etc.]
tags:
  - [derived from PR content: composite-processing, edge-feathering, etc.]
authors:
  - shanon
---

# Month DD: [Creative Title]

[1-2 sentence summary of the day — what shipped, what broke, what was learned]

<!-- more -->

## Developer Journal

### [Topic heading]

[Narrative paragraphs with technical depth. Include code references where relevant.
Wire in images at natural points in the narrative.]

![Alt text](../images/YYYY-MM-DD/filename.png)

### [Next topic]

...

## What shipped

| PR | Title |
|-----|-------|
| #NNN | prefix: description |
```

### Writing the Developer Journal

Synthesize from Slack messages + git history into a narrative. The style is:

- **First person**, technically detailed, honest about failures
- **Show the debugging journey** — not just "X was broken, fixed it" but "noticed X, tried Y (didn't work because Z), the real problem was W"
- **Use Slack quotes as energy/tone reference** but paraphrase — don't dump raw quotes
- **Technical specifics** — name the functions, the coordinate spaces, the pixel values. Readers are developers.
- **Subsections** (`###`) for each distinct topic, not one giant blob
- **Images inline** at the point in the narrative where they're most relevant, not grouped at the end
- **"What shipped" table** at the end with PR numbers and titles

### Creative titles

The title should capture the session's character, not just list what happened. Examples from recent posts:
- "Ghost Tests and Coordinate Lies"
- "Blending Boundaries and the 13-Channel Cartwheel"
- "Auto-Crop, Color Theory Humility, and Killing Dead Weight"

### If post already exists

- If `<!-- enriched -->` and refresh mode → regenerate the Developer Journal from fresh data, preserve structure
- If `<!-- generated -->` → replace with full enriched content
- If post was written manually (no marker) → update if needed (add missing PRs to table, etc.) but preserve existing narrative

## Step 5: Update Manifest

Write `docs/blog/images/manifest.json` with entries for each date. Each image entry includes:

```json
{
  "filename": "descriptive-name.png",
  "alt_text": "10-20 word description of visual content",
  "message_context": "Slack message text that accompanied this image",
  "timestamp": "1773158776.221009",
  "width": 1678,
  "height": 934,
  "source": "inbox",
  "downloaded": true
}
```

- Preserve all existing entries for dates not being processed
- Sort entries within each date by timestamp
- Sort date keys chronologically

## Step 6: Verification

After all dates are processed, verify:

1. No images remain in `jwst-inbox/` that belong to dates in the range
2. Every image referenced in a blog post exists on disk
3. Manifest entries have `width`, `height`, `message_context`, and `timestamp` (not just filename/alt_text)
4. No friend names/usernames leaked (see Privacy Rules)
5. "What shipped" tables match `git log` for each date

## Privacy Rules (CRITICAL)

- **NEVER quote friends directly** — summarize: "A friend tested the staging URL and gave feedback..."
- **NEVER include friends' names or usernames** — use "a friend", "friends", "someone in the channel"
- **Shanon's messages**: paraphrase in narrative voice. Capture intent and energy, not verbatim text.
- **No timestamps** in output — narrative flow only
- **No Slack links** in output
- **Bot messages**: ignore completely
- **Reactions/emoji**: can mention general sentiment but don't list specific emoji

## Bash Safety Rules

These patterns trigger security prompts and MUST be avoided:

- **No `$()`** — never use command substitution in Bash commands
- **No shell arithmetic** like `$((d-1))` — expand all dates to full strings before running
- **No heredocs with `#` headers** — use the Write tool for markdown content, then reference the file
- **No `/tmp` paths in Bash** — write temp files via the Write tool instead
- **No for-loops with `$var` in paths** — `for f in ...; do head $path/$f.md; done` triggers permission prompts. Use individual Read tool calls or `ls` with a glob instead
- **Run git log per-date** with full ISO strings: `--since="2026-03-16T00:00:00" --until="2026-03-16T23:59:59"`
- **Use the Write tool** for blog post content, not Bash echo/cat
- **Verify posts** with `ls -la docs/blog/posts/2026-03-1*.md` or individual Read calls, not for-loops

## Edge Cases

- **No git commits AND no Slack messages for a date** → skip that date entirely, don't create an empty post
- **Git commits but no Slack messages** → create post with "What shipped" table only, no Developer Journal
- **Slack messages but no git commits** → create post with Developer Journal only (rare — usually means planning/research day)
- **Inbox images span dates outside the target range** → sort them to correct folders anyway, but only create posts for dates in the range
- **Image already exists in a date folder** → skip copy, don't overwrite
- **Slack MCP unavailable** → report error, proceed with git-only data, flag that images couldn't be sorted
- **Ambiguous image-to-date mapping** → flag to user rather than guessing wrong