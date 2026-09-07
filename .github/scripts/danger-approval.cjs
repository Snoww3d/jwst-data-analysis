// pos-danger-approval:v1 — shared with board/approval.rs.
// A receipt names a revision; a label alone cannot approve a later revision.
const PREFIX = "<!-- pos-danger-approval:v1 ";
const validSha = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
function parse(body) {
  const line = (body ?? "").split("\n").find((l) => l.startsWith(PREFIX));
  if (!line || !line.endsWith(" -->")) return null;
  try {
    const r = JSON.parse(line.slice(PREFIX.length, -4));
    return validSha(r.head) &&
      validSha(r.base) &&
      ["app", "label", "review"].includes(r.source)
      ? r
      : null;
  } catch {
    return null;
  }
}
function body(receipt) {
  return `${PREFIX}${JSON.stringify(receipt)} -->\n\nDanger-zone approval for head ${receipt.head} against base ${receipt.base}. New revisions require a new approval. This does not merge the PR.`;
}
function approved({
  comments = [],
  labelEvents = [],
  reviews = [],
  ownerLogin,
  head,
  base,
}) {
  if (!validSha(head) || !validSha(base)) return false;
  const events = labelEvents.filter((e) => e.label === "danger-approved");
  const latest = events.at(-1);
  const removed = events.filter((e) => e.event === "unlabeled").at(-1);
  return comments.some((c) => {
    const r = parse(c.body);
    if (!r || r.head !== head || r.base !== base) return false;
    if (
      removed &&
      (!c.created_at ||
        !removed.created_at ||
        c.created_at <= removed.created_at)
    )
      return false;
    if (r.source === "app")
      return c.user?.login === ownerLogin && c.user?.type === "User";
    if (c.user?.login !== "github-actions[bot]" || c.user?.type !== "Bot")
      return false;
    if (r.source === "label")
      return (
        latest?.event === "labeled" &&
        latest.actor === ownerLogin &&
        Number.isSafeInteger(latest.id) &&
        latest.id > 0 &&
        latest.id === r.eventId
      );
    return reviews.some(
      (v) =>
        Number.isSafeInteger(v.id) &&
        v.id > 0 &&
        v.id === r.eventId &&
        v.user === ownerLogin &&
        v.type === "User" &&
        v.state === "APPROVED" &&
        v.commit_id === head,
    );
  });
}
// Only an event with its own revision can mint a mobile/review receipt. A
// rerun of an older event retains that older revision and cannot approve HEAD.
function fromEvent(event, ownerLogin, labelEvents) {
  const pr = event.pull_request;
  if (
    !pr ||
    pr.state !== "open" ||
    pr.draft ||
    event.sender?.login !== ownerLogin ||
    event.sender?.type !== "User"
  )
    return null;
  const head = pr.head?.sha,
    base = pr.base?.sha;
  if (!validSha(head) || !validSha(base)) return null;
  if (event.action === "labeled" && event.label?.name === "danger-approved") {
    const latest = labelEvents
      .filter((e) => e.label === "danger-approved")
      .at(-1);
    // Match this delivery by event id, not by timestamp. A concurrent CI check
    // or review can bump pr.updated_at between the label event and the handler
    // calling the issue-events API, causing a false negative (#1994). The event
    // id is stable across replays and doesn't race with concurrent PR updates.
    // The approved() function already verifies latest.id === r.eventId against
    // the current label events, so a reapplication (new event id) correctly
    // invalidates the old receipt, and a repeated run of the same event id is
    // deduplicated by the comment body check (r.head !== head).
    if (
      latest?.event !== "labeled" ||
      latest.actor !== ownerLogin ||
      !Number.isSafeInteger(latest.id) ||
      latest.id <= 0
    )
      return null;
    return { head, base, source: "label", eventId: latest.id };
  }
  if (
    event.action === "submitted" &&
    event.review?.state?.toUpperCase() === "APPROVED" &&
    event.review.commit_id === head &&
    event.review.user?.login === ownerLogin
  )
    return { head, base, source: "review", eventId: event.review.id };
  return null;
}
module.exports = { PREFIX, parse, body, approved, fromEvent };
