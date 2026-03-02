# Enrich Blog Posts with Slack Journal

Enrich generated session blog posts with a "Developer Journal" section synthesized from Slack messages.

## Arguments

- `--date YYYY-MM-DD` — enrich a single date
- `--from YYYY-MM-DD --to YYYY-MM-DD` — enrich a date range
- `--all` — enrich all eligible posts

Parse `$ARGUMENTS` for these flags.

## Process

### 1. Identify Target Posts

Find blog posts in `docs/blog/posts/` matching the date range. A post is eligible if:
- It contains `<!-- generated -->` (not yet enriched)
- It does NOT contain `<!-- enriched -->` (already done → skip)

If no dates specified via arguments, prompt the user to choose.

### 2. Fetch Slack Data

For each target date, use the Slack MCP tools to read messages from both channels:

- **Primary channel**: `C28RB6LGM` (#programming-crap) — project updates, debugging stories, screenshots, architecture discussions
- **Secondary channel**: `C064NSLUK19` (#artificial-intelligence) — AI tool discussions, Claude Code usage, workflow experiments

Use `mcp__claude_ai_Slack__slack_read_channel` for each channel, filtering to the target date.

Cache raw Slack data to `docs/blog/.cache/slack-journal.json` keyed by date to avoid re-fetching. Check the cache before calling Slack tools.

### 3. Generate Developer Journal Section

From Shanon's messages on that date, classify and synthesize into a narrative paragraph or two covering:

- **Intent/motivation** — what was the session about? ("Intended to just test the deployment script...")
- **Technical decisions** — architecture choices, tradeoffs ("Considered Lambda orchestration, landed on SQS...")
- **Debugging stories** — problems hit and solved ("Hit Docker disk space issues...")
- **Screenshots** — note what images were shared, infer content from surrounding messages ("Shared a screenshot of the composite result")
- **Social context** — how friend interactions influenced decisions (see Privacy Rules below)

Write in narrative voice (third person or first person matching the blog tone). Keep it 2-5 paragraphs max.

If there are no relevant Shanon messages for a date (only friend messages, or no messages at all), skip that date — leave it as `<!-- generated -->`.

### 4. Insert into Post

Insert the Developer Journal section into the post file:
- Location: after `<!-- more -->`, before the first `## Highlights` or `## What Changed` or `## Commits`
- Format:

```markdown
## Developer Journal

[synthesized narrative paragraphs]

```

### 5. Update Marker

Replace `<!-- generated -->` with `<!-- enriched -->` in the post file.

This prevents Layer 1 (`generate-session-blog.sh`) from overwriting the enriched content on re-run.

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
- **Already enriched** (`<!-- enriched -->` marker) → skip with a note
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
