// node --test .github/scripts/danger-zone.test.cjs  (also run by danger-zone.yml)
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, specReference, APPROVAL_LABEL } = require("./danger-zone.cjs");

const OWNER = "Snoww3d";
const config = {
  artifacts: { spec: "docs/plans/design/" },
  gates: { require_spec_for_danger_zone_changes: true },
  danger_zones: {
    paths: [
      "processing-engine/app/auth/**",
      "backend/JwstDataAnalysis.API/Services/*AuthService.cs",
      ".github/workflows/**",
      ".github/scripts/**",
    ],
  },
};

const dangerous = ["processing-engine/app/auth/jwt.py"];
const withSpec = [...dangerous, "docs/plans/design/thing.md"];
const humanReview = [{ state: "APPROVED", user: "someone", type: "User" }];
const ownerLabel = [{ event: "labeled", label: APPROVAL_LABEL, actor: OWNER }];
const marker = "## Summary\nsmall fix\n\nSDLC-Exception: plan-in-pr-body\n";

function run(overrides) {
  return evaluate({ changedFiles: withSpec, config, ownerLogin: OWNER, ...overrides });
}

const humanErrors = (r) => r.errors.filter((e) => e.includes("human signal"));
const specErrors = (r) => r.errors.filter((e) => e.includes("needs a spec"));

test("no danger-zone path touched: not gated", () => {
  const r = evaluate({
    changedFiles: ["frontend/jwst-frontend/src/App.tsx", "docs/setup-guide.md"],
    config,
    ownerLogin: OWNER,
  });
  assert.equal(r.gated, false);
  assert.deepEqual(r.errors, []);
});

test("repo path globs: auth service matches, its test file does not", () => {
  const hit = evaluate({
    changedFiles: ["backend/JwstDataAnalysis.API/Services/JwtAuthService.cs"],
    config,
    ownerLogin: OWNER,
  });
  assert.equal(hit.gated, true);
  const miss = evaluate({
    changedFiles: ["backend/JwstDataAnalysis.API.Tests/Services/JwtAuthServiceTests.cs"],
    config,
    ownerLogin: OWNER,
  });
  assert.equal(miss.gated, false);
});

test("the gate script itself is a danger-zone path", () => {
  const r = evaluate({
    changedFiles: [".github/scripts/danger-zone.cjs"],
    config,
    ownerLogin: OWNER,
  });
  assert.equal(r.gated, true);
});

test("danger-zone path with nothing else: held on both signals", () => {
  const r = evaluate({ changedFiles: dangerous, config, ownerLogin: OWNER });
  assert.equal(r.gated, true);
  assert.equal(humanErrors(r).length, 1);
  assert.equal(specErrors(r).length, 1);
});

test("approving human review releases the human signal", () => {
  const r = run({ reviews: humanReview });
  assert.deepEqual(r.errors, []);
});

test("approving bot review does not count", () => {
  const r = run({ reviews: [{ state: "APPROVED", user: "bot[bot]", type: "Bot" }] });
  assert.equal(humanErrors(r).length, 1);
});

test("owner-applied label releases the human signal", () => {
  const r = run({ labelEvents: ownerLabel });
  assert.deepEqual(r.errors, []);
});

test("label applied by a non-owner does not count", () => {
  const r = run({ labelEvents: [{ event: "labeled", label: APPROVAL_LABEL, actor: "stranger" }] });
  assert.equal(humanErrors(r).length, 1);
});

test("label removed after the owner applied it does not count", () => {
  const r = run({
    labelEvents: [
      ...ownerLabel,
      { event: "unlabeled", label: APPROVAL_LABEL, actor: OWNER },
    ],
  });
  assert.equal(humanErrors(r).length, 1);
});

test("owner re-applying the label after removal counts again", () => {
  const r = run({
    labelEvents: [
      ...ownerLabel,
      { event: "unlabeled", label: APPROVAL_LABEL, actor: OWNER },
      ...ownerLabel,
    ],
  });
  assert.deepEqual(r.errors, []);
});

test("a different label from the owner does not count", () => {
  const r = run({ labelEvents: [{ event: "labeled", label: "decision:approve", actor: OWNER }] });
  assert.equal(humanErrors(r).length, 1);
});

test("marker with 50 changed lines satisfies the spec signal", () => {
  const r = evaluate({
    changedFiles: dangerous,
    reviews: humanReview,
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
    reviews: humanReview,
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
    reviews: humanReview,
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
    reviews: humanReview,
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
    reviews: humanReview,
    config: { ...config, gates: {} },
    ownerLogin: OWNER,
  });
  assert.deepEqual(r.errors, []);
});

const specRef = "## Summary\nPR 2 of the plan.\n\nSpec: docs/plans/design/sdlc-adoption.md\n";

function bigNoSpec(overrides) {
  return evaluate({
    changedFiles: dangerous,
    reviews: humanReview,
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
  const body = "Spec: docs/plans/features/sdlc-adoption.md\n";
  assert.equal(specReference(body, config), null);
  const r = bigNoSpec({ body, specRefExists: true });
  assert.equal(specErrors(r).length, 1);
  assert.match(specErrors(r)[0], /malformed/);
});

test("Spec: path with traversal or odd characters is rejected", () => {
  assert.equal(specReference("Spec: docs/plans/design/../../x.md\n", config), null);
  assert.equal(specReference("Spec: docs/plans/design/a b.md\n", config), null);
  assert.equal(specReference("Spec: docs/plans/design/a.txt\n", config), null);
  assert.equal(specReference("Spec: docs/plans/design/ux-specs/a.md\n", config), "docs/plans/design/ux-specs/a.md");
});

test("CRLF bodies still match the Spec: and marker lines", () => {
  const crlf = "## Summary\r\nx\r\n\r\nSpec: docs/plans/design/sdlc-adoption.md\r\n";
  assert.deepEqual(bigNoSpec({ body: crlf, specRefExists: true }).errors, []);
  const r = evaluate({
    changedFiles: dangerous,
    reviews: humanReview,
    body: "x\r\nSDLC-Exception: plan-in-pr-body\r\n",
    diffStats: { additions: 5, deletions: 0 },
    config,
    ownerLogin: OWNER,
  });
  assert.deepEqual(r.errors, []);
});
