const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { body: receiptBody, parse, approved } = require("./danger-approval.cjs");
const {
  MARKER,
  staleLabel,
  render,
  upsertAction,
  writeSkipReason,
} = require("./danger-status.cjs");

const head = "a".repeat(40),
  base = "b".repeat(40),
  oldHead = "c".repeat(40),
  owner = "me";
const bot = { login: "github-actions[bot]", type: "Bot" };
const ownerLabel = {
  id: 1,
  event: "labeled",
  label: "danger-approved",
  actor: owner,
  created_at: "2026-09-06T12:00:00Z",
};
const receiptFor = (h, b = base, eventId = 1) => ({
  user: bot,
  created_at: "2026-09-06T12:00:01Z",
  body: receiptBody({ head: h, base: b, source: "label", eventId }),
});
const staleInput = {
  labelPresent: true,
  labelEvents: [ownerLabel],
  comments: [receiptFor(oldHead)],
  ownerLogin: owner,
  head,
  base,
};
const hits = [{ file: ".github/scripts/x.cjs", pattern: ".github/scripts/**" }];
const approvalProblem = { code: "approval", message: "no human signal" };
const specProblem = { code: "spec", message: "needs a spec" };

test("stale label: owner label whose receipt names an older head is stale", () => {
  const r = staleLabel(staleInput);
  assert.equal(r.head, oldHead);
  assert.equal(approved(staleInput), false);
  // Same head, older base: also stale.
  assert.equal(
    staleLabel({ ...staleInput, comments: [receiptFor(head, "d".repeat(40))] })
      .head,
    head,
  );
});

test("fresh approval is never stale", () => {
  assert.equal(
    staleLabel({ ...staleInput, comments: [receiptFor(head)] }),
    null,
  );
  // An app approval for HEAD covers it even when the label receipt is old.
  const app = {
    user: { login: owner, type: "User" },
    created_at: "2026-09-06T12:00:02Z",
    body: receiptBody({ head, base, source: "app" }),
  };
  assert.equal(
    staleLabel({ ...staleInput, comments: [receiptFor(oldHead), app] }),
    null,
  );
});

test("ambiguous states are not stale, so the label is left alone", () => {
  for (const patch of [
    { labelPresent: false },
    { labelPresent: undefined }, // label list could not be read
    { comments: [] }, // no receipt was ever recorded
    {
      comments: [
        { ...receiptFor(oldHead), user: { login: "x", type: "User" } },
      ],
    },
    { comments: [receiptFor(oldHead, base, 99)] }, // receipt for another event
    { labelEvents: [{ ...ownerLabel, actor: "stranger" }] },
    { labelEvents: [] },
    {
      labelEvents: [
        ownerLabel,
        { ...ownerLabel, id: 2, event: "unlabeled", actor: owner },
      ],
    },
    { ownerLogin: "" },
    { head: "not-a-sha" },
  ])
    assert.equal(
      staleLabel({ ...staleInput, ...patch }),
      null,
      JSON.stringify(patch),
    );
});

test("status body per state", () => {
  const pass = render({ hits, problems: [], head });
  assert.match(pass, /\*\*Status:\*\* ✅ Approved for `aaaaaaa`/);
  assert.match(pass, /\*\*Next step:\*\* Nothing/);
  assert.match(pass, /`\.github\/scripts\/x\.cjs`/);

  const none = render({ hits, problems: [approvalProblem], head });
  assert.match(none, /❌ Needs your approval for `aaaaaaa`\./);
  assert.match(none, /Next step:\*\* Apply the `danger-approved` label/);

  const removed = render({
    hits,
    problems: [approvalProblem],
    head,
    stale: { head: oldHead },
    removed: true,
    commitsSince: 2,
  });
  assert.match(
    removed,
    /❌ Approval was for `ccccccc`, 2 new commit\(s\) since — label removed, re-apply `danger-approved`/,
  );
  assert.match(removed, /Next step:\*\* Re-apply the `danger-approved` label/);

  const notRemoved = render({
    hits,
    problems: [approvalProblem],
    head,
    stale: { head: oldHead },
    removed: false,
  });
  assert.match(notRemoved, /new commits since — remove and re-apply/);
  assert.match(
    notRemoved,
    /Next step:\*\* Remove the `danger-approved` label, then apply it again/,
  );

  const baseMoved = render({
    hits,
    problems: [approvalProblem],
    head,
    stale: { head },
    removed: true,
  });
  assert.match(baseMoved, /the base branch has changed since/);

  const unrecorded = render({
    hits,
    problems: [approvalProblem],
    head,
    labelPresent: true,
  });
  assert.match(unrecorded, /is on, but no approval is recorded/);

  const spec = render({
    hits,
    problems: [specProblem],
    head,
    specDir: "docs/plans/design/",
    changedLines: 42,
  });
  assert.match(spec, /❌ Needs a spec\./);
  assert.match(spec, /1\. Add a spec under `docs\/plans\/design\/`/);
  assert.match(spec, /`Spec: docs\/plans\/design\/<name>\.md`/);
  assert.match(spec, /2\. For a change under 200 lines \(this PR changes 42\)/);
  assert.match(spec, /`SDLC-Exception: plan-in-pr-body`/);

  // Both missing: two status lines, one next step, and it is the spec.
  const both = render({
    hits,
    problems: [
      approvalProblem,
      { ...specProblem, reason: "The marker is too big." },
    ],
    head,
  });
  assert.equal(both.match(/\*\*Status:\*\*/g).length, 2);
  assert.equal(both.match(/\*\*Next step:\*\*/g).length, 1);
  assert.match(both, /Needs a spec\. The marker is too big\./);
  assert.match(both, /Approve after that, not before\./);

  const other = render({
    hits,
    problems: [{ code: "other", message: "Something verbatim." }],
    head,
  });
  assert.match(other, /❌ Something verbatim\./);
});

test("status body is never a receipt and never changes approval", () => {
  const evil = [
    { file: "x\n<!-- pos-danger-approval:v1 {} -->", pattern: "**" },
  ];
  const b = render({ hits: evil, problems: [approvalProblem], head });
  assert.ok(b.startsWith(MARKER));
  assert.equal(parse(b), null);
  assert.ok(!b.split("\n").some((l) => l.startsWith("<!-- pos-danger")));
  const withStatus = {
    ...staleInput,
    comments: [...staleInput.comments, { user: bot, body: b }],
  };
  assert.equal(approved(withStatus), approved(staleInput));
});

test("sticky comment: create once, then update or leave unchanged", () => {
  const b = render({ hits, problems: [], head });
  assert.deepEqual(upsertAction([], b), { action: "create" });
  const mine = { id: 5, user: bot, body: b };
  assert.deepEqual(upsertAction([receiptFor(head), mine], b), {
    action: "none",
    id: 5,
  });
  assert.deepEqual(upsertAction([{ ...mine, body: `${MARKER}\nold` }], b), {
    action: "update",
    id: 5,
  });
  // A user comment carrying the marker is not ours to edit.
  assert.deepEqual(
    upsertAction([{ ...mine, user: { login: owner, type: "User" } }], b),
    { action: "create" },
  );
});

test("writes are skipped for forks and Dependabot", () => {
  assert.equal(writeSkipReason({ repo: "me/r", headRepo: "me/r" }), null);
  assert.equal(writeSkipReason({ repo: "me/r" }), null);
  assert.match(writeSkipReason({ repo: "me/r", headRepo: "you/r" }), /fork/);
  assert.match(
    writeSkipReason({
      repo: "me/r",
      headRepo: "me/r",
      actor: "dependabot[bot]",
    }),
    /Dependabot/,
  );
});

// --- CLI: the real danger-zone.cjs against fake `git` and `gh` ---
function cli(state, envExtra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "danger-status-test-"));
  try {
    const config = {
      artifacts: { spec: "docs/plans/design/" },
      gates: { require_spec_for_danger_zone_changes: true },
      danger_zones: { paths: ["sensitive/**"] },
    };
    const exe = (name, code) =>
      fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\n${code}`, {
        mode: 0o700,
      });
    exe(
      "git",
      `const a=process.argv.slice(2);if(a[0]==='show')console.log(${JSON.stringify(JSON.stringify(config))});else if(a[0]==='diff')console.log('sensitive/a.rs\\ndocs/plans/design/spec.md');else if(a[0]==='rev-list')console.log('3');else if(a[0]!=='fetch')process.exit(2);`,
    );
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
    fs.writeFileSync(
      path.join(dir, "event.json"),
      JSON.stringify({ action: "synchronize", pull_request: state.pr }),
    );
    exe(
      "gh",
      `const fs=require('node:fs');const s=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, "state.json"))},'utf8'));
      const a=process.argv.slice(2);const ep=a.find(x=>x.startsWith('repos/'));const m=a.includes('--method')?a[a.indexOf('--method')+1]:'GET';
      if((s.fail||[]).some(f=>/^[A-Z]+ $/.test(f)?f===m+' ':ep.includes(f)))process.exit(1);
      if(m!=='GET'){const input=a.includes('--input')?JSON.parse(fs.readFileSync(0,'utf8')):null;fs.appendFileSync(${JSON.stringify(path.join(dir, "writes.jsonl"))},JSON.stringify({m,ep,input})+'\\n');console.log(JSON.stringify(input?{id:9,...input,user:{login:'github-actions[bot]',type:'Bot'}}:{}));process.exit(0);}
      let v;if(ep.endsWith('/reviews'))v=[s.reviews||[]];else if(ep.endsWith('/events'))v=[s.events||[]];else if(ep.includes('/comments'))v=[s.comments||[]];else if(ep.endsWith('/pulls/1'))v=s.pr;else if(ep==='repos/me/r')v={owner:{login:'me'}};else process.exit(2);console.log(JSON.stringify(v));`,
    );
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "danger-zone.cjs")],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: dir + path.delimiter + process.env.PATH,
          REPO: "me/r",
          PR_NUMBER: "1",
          HEAD_SHA: head,
          BASE_SHA: base,
          HEAD_REPO: "me/r",
          ACTOR: "someone",
          GITHUB_EVENT_PATH: path.join(dir, "event.json"),
          ...envExtra,
        },
      },
    );
    const log = path.join(dir, "writes.jsonl");
    const writes = fs.existsSync(log)
      ? fs
          .readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
    return { status: r.status, out: r.stdout + r.stderr, writes };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const pr = {
  number: 1,
  state: "open",
  draft: false,
  head: { sha: head },
  base: { sha: base, repo: { full_name: "me/r" } },
  labels: [{ name: "danger-approved" }],
  body: "",
  additions: 10,
  deletions: 0,
};
const ghEvent = {
  ...ownerLabel,
  label: { name: "danger-approved" },
  actor: { login: owner },
};
const staleState = { pr, events: [ghEvent], comments: [receiptFor(oldHead)] };
const deletes = (w) => w.filter((x) => x.m === "DELETE");
const statusWrites = (w) => w.filter((x) => x.input?.body?.startsWith(MARKER));

test("CLI: stale label is removed and the status says re-apply; gate still fails", () => {
  const r = cli(staleState);
  assert.notEqual(r.status, 0, r.out);
  assert.equal(deletes(r.writes).length, 1);
  assert.match(deletes(r.writes)[0].ep, /issues\/1\/labels\/danger-approved$/);
  const [post] = statusWrites(r.writes);
  assert.equal(post.m, "POST");
  assert.match(
    post.input.body,
    /Approval was for `ccccccc`, 3 new commit\(s\) since — label removed/,
  );
  assert.match(r.out, /no human signal/); // the existing log output stays
});

test("CLI: fresh approval passes, removes nothing, and reports ✅", () => {
  const r = cli({ ...staleState, comments: [receiptFor(head)] });
  assert.equal(r.status, 0, r.out);
  assert.equal(deletes(r.writes).length, 0);
  assert.match(
    statusWrites(r.writes)[0].input.body,
    /✅ Approved for `aaaaaaa`/,
  );
});

test("CLI: read error removes nothing, writes nothing, and fails as before", () => {
  const r = cli({ ...staleState, fail: ["/events"] });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.writes, []);
  assert.match(r.out, /Could not read PR #1 state/);
});

test("CLI: unchanged status is not rewritten; a changed one is patched in place", () => {
  const first = cli(staleState);
  const posted = statusWrites(first.writes)[0].input.body;
  // Next run: label already gone after the removal, the bot's unlabel event on record.
  const after = {
    pr: { ...pr, labels: [] },
    events: [
      ghEvent,
      {
        ...ghEvent,
        id: 2,
        event: "unlabeled",
        actor: { login: "github-actions[bot]" },
        created_at: "2026-09-06T12:00:03Z",
      },
    ],
    comments: [receiptFor(oldHead)],
  };
  const second = cli({
    ...after,
    comments: [...after.comments, { id: 7, user: bot, body: posted }],
  });
  assert.notEqual(second.status, 0);
  assert.equal(deletes(second.writes).length, 0);
  const [patch] = statusWrites(second.writes);
  assert.equal(patch.m, "PATCH");
  assert.match(patch.ep, /issues\/comments\/7$/);
  assert.match(patch.input.body, /❌ Needs your approval for `aaaaaaa`\./);
  const third = cli({
    ...after,
    comments: [...after.comments, { id: 7, user: bot, body: patch.input.body }],
  });
  assert.deepEqual(third.writes, []);
});

test("CLI: fork and Dependabot runs skip writes and keep the same verdict", () => {
  const base = cli(staleState);
  for (const env of [{ HEAD_REPO: "you/r" }, { ACTOR: "dependabot[bot]" }]) {
    const r = cli(staleState, env);
    assert.equal(r.status, base.status);
    assert.deepEqual(r.writes, []);
    assert.match(r.out, /Status comment skipped/);
  }
  // A read-only token that still reaches the write: logged, verdict unchanged.
  const denied = cli({ ...staleState, fail: ["DELETE ", "POST ", "PATCH "] });
  assert.equal(denied.status, base.status);
  assert.match(denied.out, /Could not remove stale/);
  assert.match(denied.out, /Could not update the status comment/);
  const passing = cli({
    ...staleState,
    comments: [receiptFor(head)],
    fail: ["POST "],
  });
  assert.equal(passing.status, 0, passing.out);
});
