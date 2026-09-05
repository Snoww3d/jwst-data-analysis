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
 * Human signal, either of:
 *   - an approving review from a non-bot user;
 *   - a `danger-approved` label whose most recent `labeled` event was
 *     performed by the repo owner. A solo repo cannot review its own PRs, and
 *     a label is one tap from the GitHub mobile app.
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
 * Replay the label timeline and report whether `danger-approved` is currently
 * present *and* was last applied by the owner. A label applied by anyone else,
 * or removed after being applied, does not count.
 */
function ownerLabelApproval(labelEvents, ownerLogin) {
  let approved = false;
  for (const ev of labelEvents) {
    if (ev.label !== APPROVAL_LABEL) continue;
    if (ev.event === "labeled") approved = ev.actor === ownerLogin;
    else if (ev.event === "unlabeled") approved = false;
  }
  return approved;
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
 * Pure decision. Returns `{ gated, hits, errors }`:
 *   gated  - a danger-zone path was touched
 *   hits   - [{file, pattern}] of the touched paths
 *   errors - reasons the gate is held; empty means released
 */
function evaluate({
  changedFiles,
  reviews = [],
  labelEvents = [],
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
  if (hits.length === 0) return { gated: false, hits, errors: [] };

  const errors = [];

  // --- Human signal ---
  // A bot approving its own work is not human oversight.
  const humanReview = reviews.some(
    (r) => r.state === "APPROVED" && r.type !== "Bot",
  );
  const ownerLabel = ownerLabelApproval(labelEvents, ownerLogin);
  if (!humanReview && !ownerLabel) {
    errors.push(
      "This PR changes a danger-zone path and has no human signal. " +
        `Approve the PR, or (as the repo owner) apply the \`${APPROVAL_LABEL}\` label.`,
    );
  }

  // --- Spec signal, when configured ---
  if (config.gates?.require_spec_for_danger_zone_changes) {
    const specDir = config.artifacts?.spec;
    const hasSpec =
      specDir &&
      changedFiles.some((f) => f.startsWith(specDir) && f.endsWith(".md"));
    const specRef = specReference(body, config);
    const hasSpecRef = Boolean(specRef) && specRefExists === true;
    const changedLines = (diffStats.additions ?? 0) + (diffStats.deletions ?? 0);
    const hasMarker = SPEC_EXCEPTION_RE.test(body);
    const smallDiff = changedLines < SMALL_DIFF_LINES;
    if (!hasSpec && !hasSpecRef && !(hasMarker && smallDiff)) {
      let why;
      if (specRef) {
        why = ` The body names \`Spec: ${specRef}\` but that file does not exist at the PR head.`;
      } else if (SPEC_REF_RE.test(body)) {
        why = ` The body's \`Spec:\` line is malformed: it must name a \`.md\` under \`${specDir}\`.`;
      } else if (hasMarker && !smallDiff) {
        why = ` The \`SDLC-Exception: plan-in-pr-body\` marker is present but the PR changes ${changedLines} lines (limit ${SMALL_DIFF_LINES}).`;
      } else {
        why =
          ` If the spec is already on main, add a \`Spec: ${specDir}<name>.md\` line to the PR body.` +
          ` For a change under ${SMALL_DIFF_LINES} lines, a \`SDLC-Exception: plan-in-pr-body\` line is accepted instead.`;
      }
      errors.push(
        `A danger-zone change needs a spec. Add one under \`${specDir}\` ` +
          "describing the approach, the alternatives rejected, and the failure modes." +
          why,
      );
    }
  }

  return { gated: true, hits, errors };
}

module.exports = {
  evaluate,
  ownerLabelApproval,
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

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`No ${CONFIG_PATH}; nothing to gate.`);
    return;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if ((config.danger_zones?.paths ?? []).length === 0) {
    console.log("No danger zones declared; nothing to gate.");
    return;
  }

  const { BASE_SHA, HEAD_SHA, PR_NUMBER, REPO } = process.env;
  const changedFiles = execFileSync(
    "git",
    ["diff", "--name-only", `${BASE_SHA}...${HEAD_SHA}`],
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
  for (const { file, pattern } of dry.hits) console.log(`  ${file}   (${pattern})`);
  console.log("");

  let reviews, labelEvents, pr, ownerLogin;
  let specRefExists = false;
  try {
    reviews = ghJson(`repos/${REPO}/pulls/${PR_NUMBER}/reviews`, true).map(
      (r) => ({ state: r.state, user: r.user?.login, type: r.user?.type }),
    );
    // Issue events carry the actor of each label change; the PR's current
    // label list does not say who applied it.
    labelEvents = ghJson(`repos/${REPO}/issues/${PR_NUMBER}/events`, true)
      .filter((e) => e.event === "labeled" || e.event === "unlabeled")
      .map((e) => ({ event: e.event, label: e.label?.name, actor: e.actor?.login }));
    pr = ghJson(`repos/${REPO}/pulls/${PR_NUMBER}`);
    ownerLogin = ghJson(`repos/${REPO}`).owner.login;
    // A referenced spec must exist at the PR head. A 404 is a failed lookup
    // like any other; the gate stays closed either way.
    const specRef = specReference(pr.body, config);
    specRefExists =
      specRef !== null &&
      ghJson(`repos/${REPO}/contents/${specRef}?ref=${HEAD_SHA}`).type === "file";
  } catch (err) {
    fail([
      `Could not read PR #${PR_NUMBER} state from GitHub: ${err.message}`,
      "Treating this as unapproved, because a danger-zone change must not merge unverified.",
    ]);
  }

  const { errors } = evaluate({
    changedFiles,
    reviews,
    labelEvents,
    body: pr.body,
    diffStats: { additions: pr.additions, deletions: pr.deletions },
    specRefExists,
    config,
    ownerLogin,
  });
  if (errors.length > 0) fail(errors);

  console.log("Danger-zone change has a human signal. Gate released.");
}

if (require.main === module) main();
