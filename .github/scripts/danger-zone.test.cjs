// npm run test:gate  (node --test .github/scripts/*.test.cjs)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  evaluate: evaluateGate,
  specReference,
  APPROVAL_LABEL,
} = require("./danger-zone.cjs");

const OWNER = "Snoww3d";
const { body: receiptBody } = require("./danger-approval.cjs");
const head = "a".repeat(40),
  base = "b".repeat(40);
const evaluate = (args) => evaluateGate({ head, base, ...args });
const config = {
  artifacts: { spec: "docs/plans/design/" },
  gates: { require_spec_for_danger_zone_changes: true },
  danger_zones: { paths: ["src-tauri/src/cos/**", ".github/workflows/**"] },
};

const dangerous = ["src-tauri/src/cos/dispatch.rs"];
const withSpec = [...dangerous, "docs/plans/design/thing.md"];
const humanReview = [
  { id: 2, commit_id: head, state: "APPROVED", user: OWNER, type: "User" },
];
const humanApproval = {
  reviews: humanReview,
  comments: [
    {
      user: { login: "github-actions[bot]", type: "Bot" },
      body: receiptBody({ head, base, source: "review", eventId: 2 }),
    },
  ],
};
const ownerLabel = [
  { id: 1, event: "labeled", label: APPROVAL_LABEL, actor: OWNER },
];
const labelApproval = {
  labelEvents: ownerLabel,
  comments: [
    {
      user: { login: "github-actions[bot]", type: "Bot" },
      body: receiptBody({ head, base, source: "label", eventId: 1 }),
    },
  ],
};
const marker = "## Summary\nsmall fix\n\nSDLC-Exception: plan-in-pr-body\n";

function run(overrides) {
  return evaluate({
    changedFiles: withSpec,
    config,
    ownerLogin: OWNER,
    ...overrides,
  });
}

const humanErrors = (r) => r.errors.filter((e) => e.includes("human signal"));
const specErrors = (r) => r.errors.filter((e) => e.includes("needs a spec"));

test("no danger-zone path touched: not gated", () => {
  const r = evaluate({
    changedFiles: ["src/App.tsx"],
    config,
    ownerLogin: OWNER,
  });
  assert.equal(r.gated, false);
  assert.deepEqual(r.errors, []);
});

test("danger-zone path with nothing else: held on both signals", () => {
  const r = evaluate({ changedFiles: dangerous, config, ownerLogin: OWNER });
  assert.equal(r.gated, true);
  assert.equal(humanErrors(r).length, 1);
  assert.equal(specErrors(r).length, 1);
});

test("approving human review releases the human signal", () => {
  const r = run(humanApproval);
  assert.deepEqual(r.errors, []);
});

test("approving bot review does not count", () => {
  const r = run({
    reviews: [{ state: "APPROVED", user: "bot[bot]", type: "Bot" }],
  });
  assert.equal(humanErrors(r).length, 1);
});

test("owner-applied label releases the human signal", () => {
  const r = run(labelApproval);
  assert.deepEqual(r.errors, []);
});

test("label applied by a non-owner does not count", () => {
  const r = run({
    labelEvents: [
      { event: "labeled", label: APPROVAL_LABEL, actor: "stranger" },
    ],
  });
  assert.equal(humanErrors(r).length, 1);
});

test("label removed after the owner applied it does not count", () => {
  const r = run({
    ...labelApproval,
    labelEvents: [
      ...ownerLabel,
      { event: "unlabeled", label: APPROVAL_LABEL, actor: OWNER },
    ],
  });
  assert.equal(humanErrors(r).length, 1);
});

test("a different label from the owner does not count", () => {
  const r = run({
    labelEvents: [{ event: "labeled", label: "agent-ready", actor: OWNER }],
  });
  assert.equal(humanErrors(r).length, 1);
});

test("marker with 50 changed lines satisfies the spec signal", () => {
  const r = evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    body: marker,
    diffStats: { additions: 30, deletions: 20 },
    config,
    ownerLogin: OWNER,
  });
  assert.deepEqual(r.errors, []);
});

test("marker with 500 changed lines fails the spec signal", () => {
  const r = evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    body: marker,
    diffStats: { additions: 400, deletions: 100 },
    config,
    ownerLogin: OWNER,
  });
  assert.equal(specErrors(r).length, 1);
  assert.match(specErrors(r)[0], /500 lines/);
});

test("no marker and no spec fails the spec signal", () => {
  const r = evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    body: "## Summary\nsmall fix\n",
    diffStats: { additions: 5, deletions: 0 },
    config,
    ownerLogin: OWNER,
  });
  assert.equal(specErrors(r).length, 1);
});

test("marker must be its own line, not embedded in prose", () => {
  const r = evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    body: "we use SDLC-Exception: plan-in-pr-body here\n",
    diffStats: { additions: 5, deletions: 0 },
    config,
    ownerLogin: OWNER,
  });
  assert.equal(specErrors(r).length, 1);
});

test("spec signal not required when the gate config is off", () => {
  const r = evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    config: { ...config, gates: {} },
    ownerLogin: OWNER,
  });
  assert.deepEqual(r.errors, []);
});

const specRef =
  "## Summary\nPR 3 of the plan.\n\nSpec: docs/plans/design/agent-kanban.md\n";

function bigNoSpec(overrides) {
  return evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    diffStats: { additions: 400, deletions: 100 },
    config,
    ownerLogin: OWNER,
    ...overrides,
  });
}

test("Spec: line naming an existing design doc satisfies the spec signal", () => {
  const r = bigNoSpec({ body: specRef, specRefExists: true });
  assert.deepEqual(r.errors, []);
});

test("Spec: line naming a missing file fails", () => {
  const r = bigNoSpec({ body: specRef, specRefExists: false });
  assert.equal(specErrors(r).length, 1);
  assert.match(specErrors(r)[0], /does not exist at the PR head/);
});

test("Spec: line outside the spec directory is malformed and never counts", () => {
  const body = "Spec: docs/plans/features/agent-kanban.md\n";
  assert.equal(specReference(body, config), null);
  const r = bigNoSpec({ body, specRefExists: true });
  assert.equal(specErrors(r).length, 1);
  assert.match(specErrors(r)[0], /malformed/);
});

test("Spec: path with traversal or odd characters is rejected", () => {
  assert.equal(
    specReference("Spec: docs/plans/design/../../x.md\n", config),
    null,
  );
  assert.equal(specReference("Spec: docs/plans/design/a b.md\n", config), null);
  assert.equal(specReference("Spec: docs/plans/design/a.txt\n", config), null);
  assert.equal(
    specReference("Spec: docs/plans/design/sub/a.md\n", config),
    "docs/plans/design/sub/a.md",
  );
});

test("CRLF bodies still match the Spec: and marker lines", () => {
  const crlf =
    "## Summary\r\nx\r\n\r\nSpec: docs/plans/design/agent-kanban.md\r\n";
  assert.equal(
    specReference(crlf.replace(/\r\n/g, "\n"), config),
    "docs/plans/design/agent-kanban.md",
  );
  assert.deepEqual(bigNoSpec({ body: crlf, specRefExists: true }).errors, []);
  const r = evaluate({
    changedFiles: dangerous,
    ...humanApproval,
    body: "x\r\nSDLC-Exception: plan-in-pr-body\r\n",
    diffStats: { additions: 5, deletions: 0 },
    config,
    ownerLogin: OWNER,
  });
  assert.deepEqual(r.errors, []);
});

// The shared path sanitizer is reachable from `app/mast/`, outside the
// `app/storage/**` glob that used to cover it. Pin the real config so a
// helper-only PR cannot slip the gate.
test("real config gates a path_security.py-only change on both signals", () => {
  const realConfig = JSON.parse(fs.readFileSync(".claude/sdlc.json", "utf8"));
  const r = evaluate({
    changedFiles: ["processing-engine/app/mast/path_security.py"],
    config: realConfig,
    ownerLogin: OWNER,
  });
  assert.equal(r.gated, true);
  assert.equal(humanErrors(r).length, 1);
  assert.equal(specErrors(r).length, 1);
  const released = evaluate({
    changedFiles: ["processing-engine/app/mast/path_security.py"],
    ...humanApproval,
    body: marker,
    diffStats: { additions: 5, deletions: 0 },
    config: realConfig,
    ownerLogin: OWNER,
  });
  assert.deepEqual(released.errors, []);
});

// --- Dependabot action-bump exemption ---
const REPO = "Snoww3d/jwst-data-analysis";
const bumpConfig = {
  ...config,
  danger_zones: { ...config.danger_zones, dependabot_action_bumps: true },
};
const bumpDiff = [
  "diff --git a/.github/workflows/security.yml b/.github/workflows/security.yml",
  "--- a/.github/workflows/security.yml",
  "+++ b/.github/workflows/security.yml",
  "@@ -10,7 +10,7 @@ jobs:",
  "       - name: Init",
  "-        uses: github/codeql-action/init@v4.37.9",
  "+        uses: github/codeql-action/init@v4.38.0",
  "       - name: Analyze",
  "-        uses: github/codeql-action/analyze@v4.37.9 # pinned",
  "+        uses: github/codeql-action/analyze@v4.38.0 # pinned",
  "-      - uses: actions/checkout@v7",
  "+      - uses: actions/checkout@v8",
  "",
].join("\n");
const bump = {
  changedFiles: [".github/workflows/security.yml"],
  author: "dependabot[bot]",
  headRepo: REPO,
  repo: REPO,
  workflowDiff: bumpDiff,
  config: bumpConfig,
  ownerLogin: OWNER,
};
const held = (overrides) => humanErrors(evaluate({ ...bump, ...overrides }));

test("dependabot uses: bump in a workflow is released with no signals", () => {
  const r = evaluate(bump);
  assert.equal(r.gated, true);
  assert.equal(r.exempt, "dependabot");
  assert.deepEqual(r.errors, []);
});

test("the exemption is off unless the config switch is on", () => {
  const r = evaluate({ ...bump, config });
  assert.equal(r.exempt, undefined);
  assert.equal(humanErrors(r).length, 1);
  assert.equal(specErrors(r).length, 1);
});

test("a human author with the same diff is still gated", () => {
  assert.equal(held({ author: OWNER }).length, 1);
});

test("a fork head is still gated even for dependabot", () => {
  assert.equal(held({ headRepo: "someone/jwst-data-analysis" }).length, 1);
});

test("a bump that also touches a non-workflow danger path is gated", () => {
  const changedFiles = [".github/workflows/security.yml", ...dangerous];
  assert.equal(held({ changedFiles }).length, 1);
});

test("any non-uses: line in the diff holds the gate", () => {
  const withRun = bumpDiff.replace(
    "+        uses: github/codeql-action/init@v4.38.0",
    "+        uses: github/codeql-action/init@v4.38.0\n+        run: echo bumped",
  );
  assert.equal(held({ workflowDiff: withRun }).length, 1);
  const withInput = bumpDiff.replace(
    "-      - uses: actions/checkout@v7",
    "-      - uses: actions/checkout@v7\n-        with:\n+        with:\n+          token: t",
  );
  assert.equal(held({ workflowDiff: withInput }).length, 1);
});

test("swapping the action name at the same line is not a bump", () => {
  const swapped = bumpDiff.replace(
    "+      - uses: actions/checkout@v8",
    "+      - uses: evil/checkout@v8",
  );
  assert.equal(held({ workflowDiff: swapped }).length, 1);
});

test("an unpaired uses: addition or removal is not a bump", () => {
  const added = bumpDiff + "+      - uses: actions/setup-node@v5\n";
  assert.equal(held({ workflowDiff: added }).length, 1);
  const removed = bumpDiff + "-      - uses: actions/setup-node@v5\n";
  assert.equal(held({ workflowDiff: removed }).length, 1);
});

test("an empty diff never releases", () => {
  assert.equal(held({ workflowDiff: "" }).length, 1);
});

test("real config has the switch on and gates the gate scripts", () => {
  const realConfig = JSON.parse(fs.readFileSync(".claude/sdlc.json", "utf8"));
  assert.equal(realConfig.danger_zones.dependabot_action_bumps, true);
  const r = evaluate({
    changedFiles: [".github/scripts/danger-zone.cjs"],
    config: realConfig,
    ownerLogin: OWNER,
  });
  assert.equal(r.gated, true);
  assert.equal(evaluate({ ...bump, config: realConfig }).exempt, "dependabot");
});
