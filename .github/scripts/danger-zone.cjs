#!/usr/bin/env node
/**
 * Danger Zone gate.
 *
 * Reads `.claude/sdlc.json` -> `danger_zones.paths` and compares them against
 * the files this PR changes.
 *
 *   - No danger-zone file touched  -> pass. The PR merges autonomously.
 *   - A danger-zone file touched   -> require a human signal, and (when
 *                                     `require_spec_for_danger_zone_changes`
 *                                     is set) a spec signal.
 *
 * Human signal: an exact head/base approval receipt, authored by the owner
 * in the app or recorded by this workflow for the owner's label/review event.
 * Removing danger-approved revokes earlier receipts. Later revisions require
 * fresh approval. See danger-approval.cjs.
 *
 * Spec signal, any of:
 *   - a spec artifact in the diff under `artifacts.spec`;
 *   - a `Spec: <artifacts.spec>/<name>.md` line in the PR body naming a spec
 *     that already exists at the PR head (later PRs of a multi-PR plan);
 *   - a `SDLC-Exception: plan-in-pr-body` line in the PR body, accepted only
 *     when the PR changes fewer than `SMALL_DIFF_LINES` lines.
 *
 * The point is to spend human attention only where a mistake is expensive,
 * rather than taxing every PR equally. See the global `sdlc` skill.
 *
 * `evaluate()` is pure and exported for tests; the CLI wrapper at the bottom
 * gathers the inputs from git and `gh`.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const approval = require("./danger-approval.cjs");
const status = require("./danger-status.cjs");

const CONFIG_PATH = ".claude/sdlc.json";
const APPROVAL_LABEL = "danger-approved";
const SPEC_EXCEPTION_RE = /^SDLC-Exception: plan-in-pr-body$/m;
const SPEC_REF_RE = /^Spec: (\S+)$/m;
const SMALL_DIFF_LINES = 200;

// --- Glob matching. Supports `**`, `*`, and `?`. ---
function toRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more leading directories; bare `**` matches any depth.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * The spec path a `Spec: <path>` body line names, or null. Only a `.md`
 * directly under `config.artifacts.spec` with a plain-character path counts;
 * anything else is malformed and never looked up.
 */
function specReference(body, config) {
  const specDir = config?.artifacts?.spec;
  if (!specDir) return null;
  const m = SPEC_REF_RE.exec(body ?? "");
  if (!m) return null;
  const path = m[1];
  const ok =
    path.startsWith(specDir) &&
    path.endsWith(".md") &&
    /^[A-Za-z0-9._/-]+$/.test(path) &&
    !path.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  return ok ? path : null;
}

/**
 * Pure decision. Returns `{ gated, hits, errors, problems }`:
 *   gated    - a danger-zone path was touched
 *   hits     - [{file, pattern}] of the touched paths
 *   errors   - reasons the gate is held; empty means released
 *   problems - the same reasons as `{code, message, reason?}` for the status
 *              comment; `errors` is always `problems.map(p => p.message)`
 */
function evaluate({
  changedFiles,
  reviews = [],
  labelEvents = [],
  comments = [],
  head,
  base,
  body = "",
  diffStats = { additions: 0, deletions: 0 },
  specRefExists = false,
  config,
  ownerLogin,
}) {
  // Bodies edited in the GitHub UI arrive with CRLF; `$` would miss every line.
  body = (body ?? "").replace(/\r\n/g, "\n");
  const patterns = config?.danger_zones?.paths ?? [];
  const matchers = patterns.map((p) => ({ pattern: p, re: toRegExp(p) }));
  const hits = [];
  for (const file of changedFiles) {
    for (const { pattern, re } of matchers) {
      if (re.test(file)) {
        hits.push({ file, pattern });
        break;
      }
    }
  }
  if (hits.length === 0)
    return { gated: false, hits, errors: [], problems: [] };

  const problems = [];

  // --- Human signal ---
  // A bot approving its own work is not human oversight.
  if (
    !approval.approved({
      comments,
      reviews,
      labelEvents,
      ownerLogin,
      head,
      base,
    })
  ) {
    problems.push({
      code: "approval",
      message:
        "This PR changes a danger-zone path and has no human signal for this head/base. Approve this revision in personal-os, or apply `danger-approved` as the owner in GitHub (including mobile). New commits or a changed base need fresh approval: the gate removes a stale label so you can just re-apply it. If the label is on and this still fails, remove and re-apply it.",
    });
  }

  // --- Spec signal, when configured ---
  if (config.gates?.require_spec_for_danger_zone_changes) {
    const specDir = config.artifacts?.spec;
    const hasSpec =
      specDir &&
      changedFiles.some((f) => f.startsWith(specDir) && f.endsWith(".md"));
    const specRef = specReference(body, config);
    const hasSpecRef = Boolean(specRef) && specRefExists === true;
    const changedLines =
      (diffStats.additions ?? 0) + (diffStats.deletions ?? 0);
    const hasMarker = SPEC_EXCEPTION_RE.test(body);
    const smallDiff = changedLines < SMALL_DIFF_LINES;
    if (!hasSpec && !hasSpecRef && !(hasMarker && smallDiff)) {
      let why;
      let reason;
      if (specRef) {
        why = ` The body names \`Spec: ${specRef}\` but that file does not exist at the PR head.`;
        reason = why.trim();
      } else if (SPEC_REF_RE.test(body)) {
        why = ` The body's \`Spec:\` line is malformed: it must name a \`.md\` under \`${specDir}\`.`;
        reason = why.trim();
      } else if (hasMarker && !smallDiff) {
        why = ` The \`SDLC-Exception: plan-in-pr-body\` marker is present but the PR changes ${changedLines} lines (limit ${SMALL_DIFF_LINES}).`;
        reason = why.trim();
      } else {
        why =
          ` If the spec is already on main, add a \`Spec: ${specDir}<name>.md\` line to the PR body.` +
          ` For a change under ${SMALL_DIFF_LINES} lines, a \`SDLC-Exception: plan-in-pr-body\` line is accepted instead.`;
      }
      problems.push({
        code: "spec",
        reason,
        message:
          `A danger-zone change needs a spec. Add one under \`${specDir}\` ` +
          "describing the approach, the alternatives rejected, and the failure modes." +
          why,
      });
    }
  }

  const errors = problems.map((p) => p.message);
  return { gated: true, hits, errors, problems };
}

module.exports = {
  evaluate,
  specReference,
  toRegExp,
  APPROVAL_LABEL,
  SMALL_DIFF_LINES,
};

// --- CLI ---
function fail(lines) {
  console.error("Danger Zone gate failed:\n");
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

/** GET a `gh api` path. With `paginate`, every page is fetched and flattened. */
function ghJson(path, paginate = false) {
  const args = ["api", path];
  // --slurp returns one outer array of pages; it cannot be combined with --jq,
  // so field selection happens in JS below.
  if (paginate) args.push("--paginate", "--slurp");
  const out = JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
  return paginate ? out.flat() : out;
}

/** A non-GET `gh api` call with an optional JSON body. */
function ghWrite(method, path, payload) {
  const args = ["api", "--method", method, path];
  if (payload) args.push("--input", "-");
  const out = execFileSync("gh", args, {
    input: payload ? JSON.stringify(payload) : undefined,
    encoding: "utf8",
    timeout: 30_000,
  });
  return out.trim() ? JSON.parse(out) : null;
}

// Issue events carry the actor of each label change; the PR's current label
// list does not say who applied it.
function readLabelEvents(REPO, PR_NUMBER) {
  return ghJson(`repos/${REPO}/issues/${PR_NUMBER}/events`, true)
    .filter((e) => e.event === "labeled" || e.event === "unlabeled")
    .map((e) => ({
      id: e.id,
      created_at: e.created_at,
      event: e.event,
      label: e.label?.name,
      actor: e.actor?.login,
    }));
}

const readComments = (REPO, PR_NUMBER) =>
  ghJson(`repos/${REPO}/issues/${PR_NUMBER}/comments?per_page=100`, true);

const hasLabel = (pr) =>
  (pr.labels ?? []).some((l) => l?.name === APPROVAL_LABEL);

/**
 * Owner-facing report: remove a provably stale `danger-approved` label and
 * create or update the one status comment. Runs after the verdict and cannot
 * change it: every failure is caught and logged here.
 */
function reportStatus(ctx) {
  const { REPO, PR_NUMBER, HEAD_SHA, BASE_SHA, verdict } = ctx;
  const skip = status.writeSkipReason({
    repo: REPO,
    headRepo: process.env.HEAD_REPO,
    actor: process.env.ACTOR,
  });
  const stillCurrent = () => {
    const live = ghJson(`repos/${REPO}/pulls/${PR_NUMBER}`);
    return live.head?.sha === HEAD_SHA && live.base?.sha === BASE_SHA
      ? live
      : null;
  };

  const stale = status.staleLabel({
    labelPresent: ctx.labelPresent,
    comments: ctx.comments,
    labelEvents: ctx.labelEvents,
    reviews: ctx.reviews,
    ownerLogin: ctx.ownerLogin,
    head: HEAD_SHA,
    base: BASE_SHA,
  });
  let removed = false;
  if (stale && skip) {
    console.log(`Stale \`${APPROVAL_LABEL}\` label left in place: ${skip}.`);
  } else if (stale) {
    try {
      // Re-read everything right before deleting, so an approval that landed
      // after the first read is never revoked by this removal.
      const live = stillCurrent();
      const again =
        live &&
        status.staleLabel({
          labelPresent: hasLabel(live),
          comments: readComments(REPO, PR_NUMBER),
          labelEvents: readLabelEvents(REPO, PR_NUMBER),
          reviews: ctx.reviews,
          ownerLogin: ctx.ownerLogin,
          head: HEAD_SHA,
          base: BASE_SHA,
        });
      if (again) {
        ghWrite(
          "DELETE",
          `repos/${REPO}/issues/${PR_NUMBER}/labels/${APPROVAL_LABEL}`,
        );
        removed = true;
        console.log(
          `Removed stale \`${APPROVAL_LABEL}\` label: it approved ${stale.head.slice(0, 7)}, not ${HEAD_SHA.slice(0, 7)}.`,
        );
      } else {
        console.log(
          `\`${APPROVAL_LABEL}\` label no longer provably stale on re-read; left in place.`,
        );
      }
    } catch (err) {
      console.log(
        `Could not remove stale \`${APPROVAL_LABEL}\` label: ${err.message}`,
      );
    }
  }

  let commitsSince = null;
  if (stale && stale.head !== HEAD_SHA) {
    try {
      commitsSince = Number(
        execFileSync(
          "git",
          ["rev-list", "--count", `${stale.head}..${HEAD_SHA}`],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          },
        ).trim(),
      );
    } catch {
      commitsSince = null; // old head not in the clone, e.g. after a force-push
    }
  }

  const body = status.render({
    hits: verdict.hits,
    problems: verdict.problems,
    head: HEAD_SHA,
    stale,
    removed,
    commitsSince,
    labelPresent: ctx.labelPresent && !removed,
    specDir: ctx.config.artifacts?.spec,
    smallDiffLines: SMALL_DIFF_LINES,
    changedLines: ctx.changedLines,
  });
  if (skip) {
    console.log(`Status comment skipped: ${skip}.`);
    return;
  }
  try {
    // An older run must not overwrite the status of a newer revision.
    if (!stillCurrent()) {
      console.log(
        "Status comment skipped: the PR moved on; a newer run reports it.",
      );
      return;
    }
    const plan = status.upsertAction(ctx.comments, body);
    if (plan.action === "create")
      ghWrite("POST", `repos/${REPO}/issues/${PR_NUMBER}/comments`, { body });
    else if (plan.action === "update")
      ghWrite("PATCH", `repos/${REPO}/issues/comments/${plan.id}`, { body });
    console.log(
      `Status comment: ${plan.action === "none" ? "unchanged" : plan.action + "d"}.`,
    );
  } catch (err) {
    console.log(`Could not update the status comment: ${err.message}`);
  }
}

function main() {
  const { HEAD_SHA, PR_NUMBER, REPO } = process.env;
  // A rerun keeps its original event payload. Read the current base so an app
  // receipt for a newly reviewed base can be evaluated without an empty commit.
  const live = ghJson(`repos/${REPO}/pulls/${PR_NUMBER}`);
  if (
    live.head?.sha !== HEAD_SHA ||
    live.base?.repo?.full_name !== REPO ||
    live.state !== "open" ||
    live.draft ||
    !/^[0-9a-f]{40}$/.test(live.base?.sha ?? "")
  ) {
    fail([
      "PR head changed, closed or became a draft; evaluate the current revision.",
    ]);
  }
  const BASE_SHA = live.base.sha;
  execFileSync("git", ["fetch", "origin", BASE_SHA], { stdio: "pipe" });
  const config = JSON.parse(
    execFileSync("git", ["show", `${BASE_SHA}:${CONFIG_PATH}`], {
      encoding: "utf8",
    }),
  );
  if ((config.danger_zones?.paths ?? []).length === 0) {
    console.log("No danger zones declared; nothing to gate.");
    return;
  }

  const changedFiles = execFileSync(
    "git",
    ["diff", "--no-renames", "--name-only", `${BASE_SHA}...${HEAD_SHA}`],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  // Cheap pre-check so a PR outside the danger zones never calls the API.
  const dry = evaluate({ changedFiles, config, ownerLogin: "" });
  if (!dry.gated) {
    console.log(
      `No danger-zone paths touched across ${changedFiles.length} changed file(s). ` +
        `Autonomous merge is fine.`,
    );
    return;
  }

  console.log("Danger-zone paths touched by this PR:\n");
  for (const { file, pattern } of dry.hits)
    console.log(`  ${file}   (${pattern})`);
  console.log("");

  let reviews, labelEvents, pr, ownerLogin, comments;
  let specRefExists = false;
  try {
    reviews = ghJson(`repos/${REPO}/pulls/${PR_NUMBER}/reviews`, true).map(
      (r) => ({
        id: r.id,
        commit_id: r.commit_id,
        state: r.state,
        user: r.user?.login,
        type: r.user?.type,
      }),
    );
    labelEvents = readLabelEvents(REPO, PR_NUMBER);
    pr = ghJson(`repos/${REPO}/pulls/${PR_NUMBER}`);
    ownerLogin = ghJson(`repos/${REPO}`).owner.login;
    if (
      pr.head.sha !== HEAD_SHA ||
      pr.base.sha !== BASE_SHA ||
      pr.state !== "open" ||
      pr.draft
    )
      throw new Error("PR revision changed; evaluate the current revision");
    comments = readComments(REPO, PR_NUMBER);
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
      : {};
    const receipt = approval.fromEvent(event, ownerLogin, labelEvents);
    if (
      receipt &&
      !comments.some(
        (c) =>
          c.user?.login === "github-actions[bot]" &&
          c.body === approval.body(receipt),
      )
    ) {
      const comment = JSON.parse(
        execFileSync(
          "gh",
          [
            "api",
            "--method",
            "POST",
            `repos/${REPO}/issues/${PR_NUMBER}/comments`,
            "--input",
            "-",
          ],
          {
            input: JSON.stringify({ body: approval.body(receipt) }),
            encoding: "utf8",
          },
        ),
      );
      comments.push(comment);
    }

    // A referenced spec must exist at the PR head. A 404 is a failed lookup
    // like any other; the gate stays closed either way.
    const specRef = specReference(pr.body, config);
    specRefExists =
      specRef !== null &&
      ghJson(`repos/${REPO}/contents/${specRef}?ref=${HEAD_SHA}`).type ===
        "file";
  } catch (err) {
    fail([
      `Could not read PR #${PR_NUMBER} state from GitHub: ${err.message}`,
      "Treating this as unapproved, because a danger-zone change must not merge unverified.",
    ]);
  }

  const verdict = evaluate({
    changedFiles,
    reviews,
    labelEvents,
    comments,
    head: HEAD_SHA,
    base: BASE_SHA,
    body: pr.body,
    diffStats: { additions: pr.additions, deletions: pr.deletions },
    specRefExists,
    config,
    ownerLogin,
  });
  const { errors } = verdict;

  // The verdict is fixed above. Reporting it can only log on failure.
  try {
    reportStatus({
      REPO,
      PR_NUMBER,
      HEAD_SHA,
      BASE_SHA,
      verdict,
      config,
      comments,
      labelEvents,
      reviews,
      ownerLogin,
      labelPresent: hasLabel(pr),
      changedLines: (pr.additions ?? 0) + (pr.deletions ?? 0),
    });
  } catch (err) {
    console.log(`Status report failed: ${err.message}`);
  }

  if (errors.length > 0) fail(errors);

  console.log("Danger-zone change has a human signal. Gate released.");
}

if (require.main === module) main();
