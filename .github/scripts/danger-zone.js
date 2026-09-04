#!/usr/bin/env node
/**
 * Danger Zone gate.
 *
 * Reads `.claude/sdlc.json` -> `danger_zones.paths` and compares them against
 * the files this PR changes.
 *
 *   - No danger-zone file touched  -> pass. The PR merges autonomously.
 *   - A danger-zone file touched   -> require an approving human review, and
 *                                     (when `require_spec_for_danger_zone_changes`
 *                                     is set) a spec artifact in the diff.
 *
 * The point is to spend human attention only where a mistake is expensive,
 * rather than taxing every PR equally. See the global `sdlc` skill.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const CONFIG_PATH = ".claude/sdlc.json";

function fail(lines) {
  console.error("Danger Zone gate failed:\n");
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

if (!fs.existsSync(CONFIG_PATH)) {
  console.log(`No ${CONFIG_PATH}; nothing to gate.`);
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const patterns = config.danger_zones?.paths ?? [];
if (patterns.length === 0) {
  console.log("No danger zones declared; nothing to gate.");
  process.exit(0);
}

// --- Which files changed? ---
const { BASE_SHA, HEAD_SHA, PR_NUMBER, REPO } = process.env;
const changed = execFileSync(
  "git",
  ["diff", "--name-only", `${BASE_SHA}...${HEAD_SHA}`],
  { encoding: "utf8" },
)
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

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

const matchers = patterns.map((p) => ({ pattern: p, re: toRegExp(p) }));
const hits = [];
for (const file of changed) {
  for (const { pattern, re } of matchers) {
    if (re.test(file)) {
      hits.push({ file, pattern });
      break;
    }
  }
}

if (hits.length === 0) {
  console.log(
    `No danger-zone paths touched across ${changed.length} changed file(s). ` +
      `Autonomous merge is fine.`,
  );
  process.exit(0);
}

console.log("Danger-zone paths touched by this PR:\n");
for (const { file, pattern } of hits) console.log(`  ${file}   (${pattern})`);
console.log("");

const errors = [];

// --- Require an approving human review ---
let reviews = [];
try {
  reviews = JSON.parse(
    execFileSync(
      "gh",
      [
        "api",
        `repos/${REPO}/pulls/${PR_NUMBER}/reviews`,
        "--paginate",
        "--jq",
        "[.[] | {state: .state, user: .user.login, type: .user.type}]",
      ],
      { encoding: "utf8" },
    ),
  );
} catch (err) {
  fail([
    `Could not read reviews for PR #${PR_NUMBER}: ${err.message}`,
    "Treating this as unapproved, because a danger-zone change must not merge unverified.",
  ]);
}

// A bot approving its own work is not human oversight.
const humanApproval = reviews.some(
  (r) => r.state === "APPROVED" && r.type !== "Bot",
);

if (!humanApproval) {
  errors.push(
    "This PR changes a danger-zone path and has no approving review from a human. " +
      "Approve the PR to release the gate.",
  );
}

// --- Require a spec artifact, when configured ---
if (config.gates?.require_spec_for_danger_zone_changes) {
  const specDir = config.artifacts?.spec;
  const hasSpec =
    specDir && changed.some((f) => f.startsWith(specDir) && f.endsWith(".md"));
  if (!hasSpec) {
    errors.push(
      `A danger-zone change needs a spec. Add one under \`${specDir}\` ` +
        "describing the approach, the alternatives rejected, and the failure modes.",
    );
  }
}

if (errors.length > 0) fail(errors);

console.log("Danger-zone change is approved by a human. Gate released.");
