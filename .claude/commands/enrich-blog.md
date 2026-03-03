# Enrich Blog Posts with Slack Journal

Enrich generated session blog posts with a "Developer Journal" section synthesized from Slack messages.

## Arguments

- `--date YYYY-MM-DD` — enrich a single date
- `--from YYYY-MM-DD --to YYYY-MM-DD` — enrich a date range
- `--all` — enrich all eligible posts
- `--refresh` — re-enrich already-enriched posts (fetches fresh Slack data, regenerates journal)
- *(no arguments)* — defaults to today's date. If today is already enriched, automatically enters refresh mode for today.

Parse `$ARGUMENTS` for these flags. If no arguments are provided, default to `--date` with today's date (from the `currentDate` context).

## Process

### 1. Identify Target Posts

Find blog posts in `docs/blog/posts/` matching the date range. A post is eligible if:
- It contains `<!-- generated -->` (not yet enriched), OR
- It contains `<!-- enriched -->` AND refresh mode is active

**Refresh mode** is active when:
- `--refresh` flag is passed explicitly, OR
- No arguments were given, today's date is the target, and the post is already `<!-- enriched -->`

In refresh mode, skip the Slack cache for the target date (fetch fresh data). The existing Developer Journal will be replaced with a regenerated version covering the full day's activity.

If the target post doesn't exist yet, remind the user to generate it first:
`./scripts/generate-session-blog.sh --date YYYY-MM-DD`

### 2. Fetch Slack Data

For each target date, use the Slack MCP tools to read messages from both channels:

- **Primary channel**: `C28RB6LGM` (#programming-crap) — project updates, debugging stories, screenshots, architecture discussions
- **Secondary channel**: `C064NSLUK19` (#artificial-intelligence) — AI tool discussions, Claude Code usage, workflow experiments

Use `mcp__claude_ai_Slack__slack_read_channel` for each channel, filtering to the target date.

Cache raw Slack data to `docs/blog/.cache/slack-journal.json` keyed by date to avoid re-fetching. Check the cache before calling Slack tools. **In refresh mode**, ignore the cache for the target date and fetch fresh data (the day may have new messages since the last enrichment).

### 3. Generate Developer Journal Section

From Shanon's messages on that date, classify and synthesize into a narrative paragraph or two covering:

- **Intent/motivation** — what was the session about? ("Intended to just test the deployment script...")
- **Technical decisions** — architecture choices, tradeoffs ("Considered Lambda orchestration, landed on SQS...")
- **Debugging stories** — problems hit and solved ("Hit Docker disk space issues...")
- **Screenshots** — note what images were shared, infer content from surrounding messages ("Shared a screenshot of the composite result")
- **Social context** — how friend interactions influenced decisions (see Privacy Rules below)

Write in narrative voice (third person or first person matching the blog tone). Keep it 2-5 paragraphs max.

If there are no relevant Shanon messages for a date (only friend messages, or no messages at all), skip that date — leave it as `<!-- generated -->`.

### 3b. Capture Image Metadata

When reading Slack messages, for each message that has image attachments:

1. **Match to manifest** — look up the image in `docs/blog/images/manifest.json` by `slack_file_id`, or create a new entry if not found
2. **Record `message_context`** — the Slack message text surrounding the image (Shanon's message only, not friends')
3. **Generate `alt_text`** — 10-20 words describing the visual content, derived from the message context. If no context is available, use the filename heuristics table below.
4. **Record `timestamp`** — the Slack message `ts` value
5. **Assign `placement_hint`** — correlate which Developer Journal paragraph the image relates to:
   - `"after:N"` where N is the 1-based paragraph index in the Developer Journal section
   - `"end"` if the image doesn't clearly relate to a specific paragraph

#### Alt Text Heuristics (fallback when no message context)

| Filename Pattern | Alt Text |
|------------------|----------|
| `jwst-composite-*` | "JWST composite output" |
| `jwst-mosaic-*` | "JWST mosaic output" |
| `IMG_*.jpeg` / `IMG_*.jpg` | "Photo shared in discussion" |
| `File.png` | "File shared in Slack" |
| `image.png` / `image-N.png` | "Screenshot from development session" |

### 3c. Download Images (Best Effort)

For images not yet downloaded (no file on disk in `docs/blog/images/YYYY-MM-DD/`):

1. Attempt download using WebFetch if a URL is visible in MCP output
2. Save to `docs/blog/images/YYYY-MM-DD/{filename}` — create the date directory if needed
3. Set `downloaded: true` on success, `false` on failure
4. Log any failures for manual follow-up — do not block the rest of the enrichment

### 4. Insert/Replace Developer Journal

**Fresh enrichment** (post has `<!-- generated -->`): Insert a new Developer Journal section.
**Refresh mode** (post has `<!-- enriched -->`): Replace the existing Developer Journal section content. Preserve the `## Developer Journal` heading and any image embeds that are already wired in — regenerate only the text paragraphs, then re-interleave existing image embeds at their current positions.

In both cases:
- Location: after `<!-- more -->`, before the first `## Highlights` or `## What Changed` or `## Commits`
- Format:

```markdown
## Developer Journal

[synthesized narrative paragraphs]

```

### 4a. Write Manifest

After writing the Developer Journal section, write the updated manifest back to `docs/blog/images/manifest.json`:

- Preserve all existing entries for other dates
- For the current date, update entries with the new fields (`alt_text`, `message_context`, `timestamp`, `placement_hint`, `downloaded`)
- New fields default to `null` for entries where no data was gathered
- Keep the manifest sorted by date key, entries within each date ordered by timestamp

### 5. Update Marker

Replace `<!-- generated -->` with `<!-- enriched -->` in the post file.

This prevents Layer 1 (`generate-session-blog.sh`) from overwriting the enriched content on re-run.

### 6. Remind About Wiring

After all dates are processed, print a reminder:

```
Images captured in manifest. To wire them into posts, run:
  python3 scripts/wire-blog-images.py --date YYYY-MM-DD
```

Or if multiple dates were enriched:

```
  python3 scripts/wire-blog-images.py --all
```

## Privacy Rules (CRITICAL — must follow exactly)

- **NEVER quote friends directly** — always summarize: "A friend tested the staging URL and gave feedback about the signup requirement, which led to implementing anonymous access"
- **NEVER include friends' names or usernames** — use "a friend", "friends", "someone in the channel"
- **Shanon's messages**: paraphrase in narrative voice, don't dump raw quotes. Capture the intent and energy, not verbatim text.
- **No timestamps** in output — just narrative flow
- **No Slack links** in output
- **Screenshots/images**: note that an image was shared and infer what it showed from surrounding context ("Shared the composite result showing all 8 NIRCam channels mapped to the NASA palette")
- **Bot messages**: ignore completely
- **Reactions/emoji**: can mention general sentiment ("the result got positive reactions") but don't list specific emoji

## Edge Cases

- **No Slack data for a date** → skip, leave as `<!-- generated -->`
- **Only friend messages** (Shanon posted nothing) → skip
- **Pre-PR dates** (2025-06-28 through 2025-07-13) → enrich if data exists, insert before `## Commits`
- **Already enriched** (`<!-- enriched -->` marker) → skip unless refresh mode is active. In refresh mode, regenerate the journal from fresh Slack data.
- **Slack MCP unavailable** → report error, don't modify any files

## Example Output

```markdown
## Developer Journal

Intended to just test the deployment script, but wound up fixing a cascade of staging issues. The SignalR proxy was missing from nginx — composite processing appeared stuck because WebSocket connections were falling through to the SPA fallback.

Shared the staging URL with friends for the first real external test. Feedback about the mandatory signup requirement led to implementing anonymous access for users who just want to browse existing composites. A friend's suggestion to show auth badges on recipe cards made it into the same session.

Hit Docker disk space issues on the dev machine midway through — had to clear build cache to keep going. The 8-channel Pillars of Creation composite was the stress test that surfaced the OOM crash.
```

## Verification

After enriching, confirm:
1. The `<!-- enriched -->` marker is present
2. The Developer Journal section is properly placed
3. No friend names/usernames leaked
4. Re-running `./scripts/generate-session-blog.sh` skips enriched posts
