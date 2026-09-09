const test = require("node:test");
const assert = require("node:assert/strict");
const { body, approved, fromEvent, parse } = require("./danger-approval.cjs");
const head = "a".repeat(40),
  base = "b".repeat(40),
  ownerLogin = "me";
const app = {
  user: { login: "me", type: "User" },
  created_at: "2026-09-06T12:00:01Z",
  body: body({ head, base, source: "app" }),
};
const input = { head, base, ownerLogin, comments: [app] };
test("app approval belongs to this owner and exact head/base, and removal revokes it", () => {
  assert.equal(approved(input), true);
  for (const patch of [
    { head: "c".repeat(40) },
    { base: "c".repeat(40) },
    { ownerLogin: "stranger" },
    { head: null },
    { comments: [{ ...app, user: { login: "me", type: "Bot" } }] },
  ])
    assert.equal(approved({ ...input, ...patch }), false);
  assert.equal(
    approved({
      ...input,
      labelEvents: [
        {
          event: "unlabeled",
          label: "danger-approved",
          created_at: "2026-09-06T12:00:02Z",
        },
      ],
    }),
    false,
  );
  assert.equal(parse("approve"), null);
});
test("mobile receipt binds label event and revision; old labels cannot approve a new push", () => {
  const event = {
    action: "labeled",
    label: { name: "danger-approved" },
    sender: { login: "me", type: "User" },
    pull_request: {
      state: "open",
      draft: false,
      updated_at: "2026-09-06T12:00:00Z",
      head: { sha: head },
      base: { sha: base },
    },
  };
  const labels = [
    {
      id: 1,
      event: "labeled",
      label: "danger-approved",
      actor: "me",
      created_at: event.pull_request.updated_at,
    },
  ];
  const receipt = fromEvent(event, "me", labels);
  assert.deepEqual(receipt, { head, base, source: "label", eventId: 1 });
  const v = {
    ...input,
    labelEvents: labels,
    comments: [
      {
        user: { login: "github-actions[bot]", type: "Bot" },
        body: body(receipt),
        created_at: app.created_at,
      },
    ],
  };
  assert.equal(approved(v), true);
  assert.equal(approved({ ...v, head: "c".repeat(40) }), false);
  assert.equal(
    approved({ ...v, labelEvents: [...labels, { ...labels[0], id: 2 }] }),
    false,
  );
  assert.equal(
    approved({
      ...v,
      comments: [
        { ...v.comments[0], user: { login: "someone[bot]", type: "Bot" } },
      ],
    }),
    false,
  );
  assert.equal(
    fromEvent(
      {
        ...event,
        pull_request: { ...event.pull_request, updated_at: "later" },
      },
      "me",
      labels,
    ),
    null,
  );
  assert.equal(
    fromEvent(
      { ...event, sender: { login: "stranger", type: "User" } },
      "me",
      labels,
    ),
    null,
  );
});
test("ordinary approval reviews need an exact receipt and an undismissed owner review", () => {
  const reviews = [
    { id: 7, user: "me", type: "User", state: "APPROVED", commit_id: head },
  ];
  const comments = [
    {
      user: { login: "github-actions[bot]", type: "Bot" },
      body: body({ head, base, source: "review", eventId: 7 }),
    },
  ];
  assert.equal(approved({ ...input, comments, reviews }), true);
  assert.equal(
    approved({
      ...input,
      comments,
      reviews: [{ ...reviews[0], state: "DISMISSED" }],
    }),
    false,
  );
  assert.equal(approved({ ...input, comments: [], reviews }), false);
});

test("shared Rust/gate approval cases agree", () => {
  const cases = require("../../tests/fixtures/danger-approval.json");
  for (const c of cases) assert.equal(approved(c), c.expected, c.name);
});

test("gate CLI records mobile approval and reruns against the live base", () => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "danger-gate-test-"));
  try {
    const config = {
      artifacts: { spec: "docs/plans/design/" },
      gates: { require_spec_for_danger_zone_changes: true },
      danger_zones: { paths: ["sensitive/**"] },
    };
    const pr = {
      number: 1,
      state: "open",
      draft: false,
      head: { sha: head },
      base: { sha: base, repo: { full_name: "me/r" } },
      updated_at: "2026-09-06T12:00:00Z",
      body: "",
      additions: 10,
      deletions: 0,
    };
    const event = {
      action: "labeled",
      label: { name: "danger-approved" },
      sender: { login: "me", type: "User" },
      pull_request: pr,
    };
    fs.writeFileSync(path.join(dir, "event.json"), JSON.stringify(event));
    const executable = (name, code) =>
      fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\n${code}`, {
        mode: 0o700,
      });
    executable(
      "git",
      `const args=process.argv.slice(2);if(args[0]==='show')console.log(${JSON.stringify(JSON.stringify(config))});else if(args[0]==='diff')console.log('sensitive/a.rs\\ndocs/plans/design/spec.md');else if(args[0]!=='fetch')process.exit(2);`,
    );
    executable(
      "gh",
      `const fs=require('node:fs');const args=process.argv.slice(2);const endpoint=args.find(a=>a.startsWith('repos/'));let value;
      if(args.includes('POST')){const request=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync(${JSON.stringify(path.join(dir, "posted.json"))},JSON.stringify(request));value={...request,user:{login:'github-actions[bot]',type:'Bot'},created_at:'2026-09-06T12:00:01Z'};}
      else if(endpoint.endsWith('/reviews'))value=[[]];
      else if(endpoint.endsWith('/events'))value=[[{id:1,event:'labeled',label:{name:'danger-approved'},actor:{login:'me'},created_at:'2026-09-06T12:00:00Z'}]];
      else if(endpoint.includes('/comments'))value=[JSON.parse(process.env.APP_COMMENTS||'[]')];
      else if(endpoint.endsWith('/pulls/1'))value=${JSON.stringify(pr)};
      else if(endpoint==='repos/me/r')value={owner:{login:'me'}};else process.exit(2);console.log(JSON.stringify(value));`,
    );
    const env = {
      ...process.env,
      PATH: dir + path.delimiter + process.env.PATH,
      REPO: "me/r",
      PR_NUMBER: "1",
      HEAD_SHA: head,
      BASE_SHA: "c".repeat(40),
      GITHUB_EVENT_PATH: path.join(dir, "event.json"),
    };
    const cli = path.join(__dirname, "danger-zone.cjs");
    let result = spawnSync(process.execPath, [cli], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const posted = JSON.parse(
      fs.readFileSync(path.join(dir, "posted.json"), "utf8"),
    );
    assert.equal(parse(posted.body).base, base);
    // A later app approval can rerun an older opened event: live base wins.
    fs.writeFileSync(
      path.join(dir, "event.json"),
      JSON.stringify({
        action: "opened",
        pull_request: { ...pr, base: { sha: "c".repeat(40) } },
      }),
    );
    result = spawnSync(process.execPath, [cli], {
      cwd: dir,
      env: { ...env, APP_COMMENTS: JSON.stringify([app]) },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    result = spawnSync(process.execPath, [cli], {
      cwd: dir,
      env: { ...env, HEAD_SHA: "d".repeat(40) },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
