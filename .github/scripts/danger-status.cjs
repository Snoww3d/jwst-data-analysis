// Owner-facing side of the Danger Zone gate: one sticky PR comment that says
// what the gate decided and the single thing the owner must do next, and
// removal of a `danger-approved` label whose approval no longer covers HEAD.
//
// Nothing here decides pass/fail. `danger-zone.cjs` computes the verdict with
// `evaluate()` first; these helpers only report it and tidy the label. Every
// write is best-effort: a failure is logged and the verdict stands.
const approval = require("./danger-approval.cjs");

const MARKER = "<!-- danger-gate-status -->";
const LABEL = "danger-approved";
const BOT = "github-actions[bot]";
const MAX_PATHS = 20;
const validSha = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
const short = (sha) => `\`${String(sha ?? "").slice(0, 7)}\``;
const isBot = (c) => c.user?.login === BOT && c.user?.type === "Bot";

/**
 * The receipt of a `danger-approved` label that is on the PR but approves a
 * different head/base, or null when that is not provable.
 *
 * Stale means all of: the label is on the PR now; `approval.approved()` is
 * false for this head/base; the latest `danger-approved` event is the owner's
 * `labeled` event; and the workflow receipts minted for exactly that event id
 * (the binding `approved()` checks) all name another revision. Anything else
 * (no receipt, a non-owner label, a receipt that matches HEAD but fails some
 * other check) is ambiguous and returns null, so the label is left alone.
 */
function staleLabel({
  labelPresent,
  comments = [],
  labelEvents = [],
  reviews = [],
  ownerLogin,
  head,
  base,
}) {
  if (labelPresent !== true || !ownerLogin) return null;
  if (!validSha(head) || !validSha(base)) return null;
  if (
    approval.approved({
      comments,
      labelEvents,
      reviews,
      ownerLogin,
      head,
      base,
    })
  )
    return null;
  const latest = labelEvents.filter((e) => e.label === LABEL).at(-1);
  if (
    latest?.event !== "labeled" ||
    latest.actor !== ownerLogin ||
    !Number.isSafeInteger(latest.id) ||
    latest.id <= 0
  )
    return null;
  const receipts = comments
    .filter(isBot)
    .map((c) => approval.parse(c.body))
    .filter((r) => r && r.source === "label" && r.eventId === latest.id);
  if (receipts.length === 0) return null;
  if (receipts.some((r) => r.head === head && r.base === base)) return null;
  return receipts.at(-1);
}

// File names come from git; keep each on one list line so no line of the
// comment can ever start with the receipt prefix.
const cleanPath = (p) => String(p).replace(/[\r\n`]/g, "?");

function specAction({ specDir, smallDiffLines, changedLines }) {
  return (
    "Do one of these (the gate re-runs when the PR body is edited or a commit lands):\n" +
    `1. Add a spec under \`${specDir}\` to this PR (approach, alternatives rejected, failure modes), ` +
    `or, if the spec is already on main, put \`Spec: ${specDir}<name>.md\` on its own line in the PR body.\n` +
    `2. For a change under ${smallDiffLines} lines (this PR changes ${changedLines}), ` +
    "put `SDLC-Exception: plan-in-pr-body` on its own line in the PR body."
  );
}

/**
 * The status comment body. `problems` is `evaluate().problems`; empty means
 * the gate passed. `stale` is the `staleLabel()` receipt, `removed` whether
 * this run removed that label.
 */
function render({
  hits,
  problems,
  head,
  stale = null,
  removed = false,
  commitsSince = null,
  labelPresent = false,
  specDir = "docs/plans/design/",
  smallDiffLines = 200,
  changedLines = 0,
}) {
  const status = [];
  let approvalNext = null;
  let specNext = null;
  let otherNext = null;
  for (const p of problems) {
    if (p.code === "approval") {
      if (stale) {
        const since =
          stale.head === head
            ? "the base branch has changed since"
            : Number.isInteger(commitsSince) && commitsSince > 0
              ? `${commitsSince} new commit(s) since`
              : "new commits since";
        status.push(
          removed
            ? `❌ Approval was for ${short(stale.head)}, ${since} — label removed, re-apply \`${LABEL}\`.`
            : `❌ Approval was for ${short(stale.head)}, ${since} — remove and re-apply \`${LABEL}\`.`,
        );
        approvalNext = removed
          ? `Re-apply the \`${LABEL}\` label (the gate already removed the stale one).`
          : `Remove the \`${LABEL}\` label, then apply it again (the gate could not remove it for you).`;
      } else if (labelPresent) {
        status.push(
          `❌ Needs your approval for ${short(head)} — \`${LABEL}\` is on, but no approval is recorded for this revision.`,
        );
        approvalNext = `Remove the \`${LABEL}\` label, then apply it again as the repo owner.`;
      } else {
        status.push(`❌ Needs your approval for ${short(head)}.`);
        approvalNext = `Apply the \`${LABEL}\` label (or approve this revision in personal-os).`;
      }
    } else if (p.code === "spec") {
      status.push(`❌ Needs a spec.${p.reason ? ` ${p.reason}` : ""}`);
      specNext = specAction({ specDir, smallDiffLines, changedLines });
    } else {
      status.push(`❌ ${p.message}`);
      otherNext ??= "Fix the problem above; the gate re-runs on the next push.";
    }
  }
  if (status.length === 0) status.push(`✅ Approved for ${short(head)}.`);

  // One action. A spec fix may add a commit, which would stale an approval
  // given now, so the spec comes first.
  let next;
  if (specNext)
    next =
      specNext + (approvalNext ? "\n\nApprove after that, not before." : "");
  else next = approvalNext ?? otherNext ?? "Nothing. The gate is green.";

  const shown = hits.slice(0, MAX_PATHS);
  const paths = shown.map(
    ({ file, pattern }) =>
      `- \`${cleanPath(file)}\` (\`${cleanPath(pattern)}\`)`,
  );
  if (hits.length > shown.length)
    paths.push(`- …and ${hits.length - shown.length} more (see the check log)`);

  return [
    MARKER,
    "### Danger Zone Gate",
    "",
    ...status.map((s) => `**Status:** ${s}`),
    "",
    `**Next step:** ${next}`,
    "",
    "**Protected paths touched:**",
    ...paths,
    "",
    `_Approval covers one revision. If new commits land, this gate removes \`${LABEL}\` and says so here: just re-apply it. Updated for ${short(head)}._`,
  ].join("\n");
}

/** How to converge on exactly one status comment, created by the bot. */
function upsertAction(comments, body) {
  const existing = comments.find(
    (c) => isBot(c) && (c.body ?? "").startsWith(MARKER),
  );
  if (!existing) return { action: "create" };
  if (existing.body === body) return { action: "none", id: existing.id };
  return { action: "update", id: existing.id };
}

/**
 * Whether this run's token can write to the PR. `pull_request` runs from a
 * fork or from Dependabot get a read-only token, so skip rather than fail.
 */
function writeSkipReason({ repo, headRepo, actor }) {
  if (headRepo && repo && headRepo !== repo)
    return `head repository ${headRepo} is a fork, so the token is read-only`;
  if (actor === "dependabot[bot]")
    return "Dependabot runs get a read-only token";
  return null;
}

module.exports = {
  MARKER,
  staleLabel,
  render,
  upsertAction,
  writeSkipReason,
};
