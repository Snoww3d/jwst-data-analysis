#!/usr/bin/env node

/**
 * Validate pull request standards from title/body metadata.
 * This runs in CI and fails fast when required sections/checklists are incomplete.
 */

const prTitle = (process.env.PR_TITLE || "").trim();
const prBody = (process.env.PR_BODY || "").replace(/\r\n/g, "\n");
const prHeadRef = (process.env.PR_HEAD_REF || "").trim();

// Dependabot generates PRs whose bodies are package changelogs, not the project
// PR template. We still validate title prefix and branch prefix below (Dependabot
// complies with both via .github/dependabot.yml), but skip the body/section
// checks because they would always fail and would block the auto-merge tier
// for dependency bumps.
const isDependabot = /^dependabot\//i.test(prHeadRef);

const errors = [];

const VALID_TITLE_PREFIXES = "feat|fix|docs|refactor|test|chore|perf|ci";
const VALID_BRANCH_PREFIXES =
  "feature/|fix/|docs/|refactor/|test/|chore/|perf/|ci/|dependabot/|codex/";

const REQUIRED_SECTIONS = [
  "Summary",
  "Changes Made",
  "Test Plan",
  "Documentation Checklist",
  "Tech Debt Impact",
  "Risk & Rollback",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComments(text) {
  let result = text;
  let prev;
  do {
    prev = result;
    result = result.replace(/<!--[\s\S]*?-->/g, "");
  } while (result !== prev);
  return result.trim();
}

function extractSection(heading) {
  const lines = prBody.split("\n");
  const headingRegex = new RegExp(
    `^##\\s+${escapeRegExp(heading)}\\s*$`,
    "i",
  );
  const genericHeadingRegex = /^##\s+/;

  let startIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingRegex.test(lines[i])) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    return "";
  }

  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (genericHeadingRegex.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join("\n").trim();
}

function checkedCount(section) {
  return (section.match(/^- \[[xX]\]\s+/gm) || []).length;
}

function totalCheckboxCount(section) {
  return (section.match(/^- \[[ xX]\]\s+/gm) || []).length;
}

function hasMeaningfulContent(section) {
  const content = stripComments(section);

  const bulletLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  if (bulletLines.some((line) => !/^-\s*$/.test(line))) return true;

  // Accept Markdown table rows too. Skip the alignment row (`|---|---|`)
  // since it has no semantic content. A row with at least one non-empty
  // non-separator cell counts.
  const tableRows = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (
    tableRows.some((row) => {
      if (/^\|[\s|:-]+\|$/.test(row)) return false; // alignment row
      const cells = row.slice(1, -1).split("|").map((c) => c.trim());
      return cells.some((c) => c.length > 0);
    })
  ) {
    return true;
  }

  return false;
}

// --- Title prefix ---
const titleRegex = new RegExp(
  `^(${VALID_TITLE_PREFIXES})(\\([^)]+\\))?: .+`,
  "i",
);
if (!titleRegex.test(prTitle)) {
  errors.push(
    `PR title must use conventional format: \`<prefix>: description\`. Valid prefixes: \`${VALID_TITLE_PREFIXES.replace(/\|/g, ", ")}\`.`,
  );
}

// --- Branch naming ---
const branchRegex = new RegExp(
  `^(${VALID_BRANCH_PREFIXES.replace(/\//g, "\\/").replace(/\|/g, "|")})`,
  "i",
);
if (!branchRegex.test(prHeadRef)) {
  errors.push(
    `Branch name must start with one of: \`${VALID_BRANCH_PREFIXES.replace(/\|/g, ", ")}\`.`,
  );
}

// --- Required sections ---
// Dependabot bodies are package changelogs, not the PR template — skip.
if (!isDependabot) {
  for (const sectionName of REQUIRED_SECTIONS) {
    if (!extractSection(sectionName)) {
      errors.push(`Missing required section: \`## ${sectionName}\`.`);
    }
  }
}

// All checks below this point inspect the PR body. Dependabot generates its
// own changelog body, so skip them — title and branch prefix are still
// validated above.
if (!isDependabot) {
  // --- Summary ---
  const summarySection = extractSection("Summary");
  if (summarySection && stripComments(summarySection).length < 12) {
    errors.push(
      "`## Summary` must contain a meaningful description of the change.",
    );
  }

  // --- Why (optional section, but validated if present) ---
  const whySection = extractSection("Why");
  if (whySection && stripComments(whySection).length < 12) {
    errors.push("`## Why` must explain the reason for the change.");
  }

  // --- Changes Made ---
  const changesSection = extractSection("Changes Made");
  if (changesSection && !hasMeaningfulContent(changesSection)) {
    errors.push(
      "`## Changes Made` must include at least one non-empty bullet or table row.",
    );
  }

  // --- Test Plan ---
  const testPlanSection = extractSection("Test Plan");
  if (testPlanSection && checkedCount(testPlanSection) < 1) {
    errors.push("`## Test Plan` must have at least one checked checkbox.");
  }

  // --- Documentation Checklist ---
  const docsChecklistSection = extractSection("Documentation Checklist");
  if (docsChecklistSection && checkedCount(docsChecklistSection) < 1) {
    errors.push(
      "`## Documentation Checklist` must have at least one checked checkbox.",
    );
  }

  // --- Tech Debt Impact ---
  const techDebtSection = extractSection("Tech Debt Impact");
  if (techDebtSection) {
    const total = totalCheckboxCount(techDebtSection);
    const checked = checkedCount(techDebtSection);

    if (total < 1) {
      errors.push("`## Tech Debt Impact` must include checkbox items.");
    } else if (checked < 1) {
      errors.push(
        "`## Tech Debt Impact` must have at least one checked option.",
      );
    }
  }

  // --- Risk & Rollback ---
  // Strip bold/italic markers so `**Risk**:`, `*Risk*:`, and `Risk:` all
  // satisfy the field-name check. Authors naturally bold field names in
  // Markdown; the regex shouldn't reject that.
  const riskSection = extractSection("Risk & Rollback");
  if (riskSection) {
    const normalizedRiskSection = stripComments(riskSection).replace(
      /\*\*|__|(?<![\\*])\*(?!\*)|(?<![\\_])_(?!_)/g,
      "",
    );
    if (!/Risk:\s*\S+/i.test(normalizedRiskSection)) {
      errors.push(
        "`## Risk & Rollback` must include a non-empty `Risk:` value.",
      );
    }
    if (!/Rollback:\s*\S+/i.test(normalizedRiskSection)) {
      errors.push(
        "`## Risk & Rollback` must include a non-empty `Rollback:` value.",
      );
    }
  }

  // --- Closes #N or "No linked issue" ---
  const strippedBody = stripComments(prBody);
  const hasClosingKeyword =
    /\b(closes|close|closed|fixes|fix|fixed|resolves|resolve|resolved)\s+#\d+/i.test(
      strippedBody,
    );
  const hasNoIssueMarker = /no linked issue/i.test(strippedBody);
  if (!hasClosingKeyword && !hasNoIssueMarker) {
    errors.push(
      'PR body must include `Closes #N` to link an issue, or `No linked issue` if none applies.',
    );
  }
}

// --- Report ---
if (errors.length > 0) {
  console.error("PR standards validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

if (isDependabot) {
  console.log(
    "PR standards validation passed (Dependabot mode: title and branch prefix validated, body checks skipped).",
  );
} else {
  console.log("PR standards validation passed.");
}
