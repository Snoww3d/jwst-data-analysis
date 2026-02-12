#!/usr/bin/env node

/**
 * Validate pull request standards from title/body metadata.
 * This runs in CI and fails fast when required sections/checklists are incomplete.
 */

const prTitle = (process.env.PR_TITLE || "").trim();
const prBody = (process.env.PR_BODY || "").replace(/\r\n/g, "\n");
const prHeadRef = (process.env.PR_HEAD_REF || "").trim();

const errors = [];

const REQUIRED_SECTIONS = [
  "Summary",
  "Why",
  "Type of Change",
  "Changes Made",
  "Test Plan",
  "Documentation Checklist",
  "Tech Debt Impact",
  "Risk & Rollback",
  "Quality Checklist",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function extractSection(heading) {
  const lines = prBody.split("\n");
  const headingRegex = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
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

function hasCheckedLine(section, pattern) {
  const regex = new RegExp(`^- \\[[xX]\\]\\s+${pattern}\\s*$`, "im");
  return regex.test(section);
}

function hasMeaningfulBullets(section) {
  const content = stripComments(section);
  const bulletLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));

  return bulletLines.some((line) => !/^-\s*$/.test(line));
}

if (!/^(feat|fix|docs|refactor|test|chore)(\([^)]+\))?: .+/i.test(prTitle)) {
  errors.push(
    "PR title must use conventional format, for example `feat: add X` or `fix(api): handle Y`.",
  );
}

if (
  !/^(codex\/|feature\/|fix\/|docs\/|refactor\/|test\/|chore\/|dependabot\/)/i.test(
    prHeadRef,
  )
) {
  errors.push(
    "Branch name must start with `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, `dependabot/`, or `codex/`.",
  );
}

for (const sectionName of REQUIRED_SECTIONS) {
  if (!extractSection(sectionName)) {
    errors.push(`Missing required section: \`## ${sectionName}\`.`);
  }
}

const summarySection = extractSection("Summary");
if (summarySection && stripComments(summarySection).length < 12) {
  errors.push("`## Summary` must contain a meaningful description of the change.");
}

const whySection = extractSection("Why");
if (whySection && stripComments(whySection).length < 12) {
  errors.push("`## Why` must explain the reason for the change.");
}

const changesSection = extractSection("Changes Made");
if (changesSection && !hasMeaningfulBullets(changesSection)) {
  errors.push("`## Changes Made` must include at least one non-empty bullet item.");
}

const typeOfChangeSection = extractSection("Type of Change");
if (typeOfChangeSection && checkedCount(typeOfChangeSection) < 1) {
  errors.push("`## Type of Change` must have at least one checked checkbox.");
}

const testPlanSection = extractSection("Test Plan");
if (testPlanSection && checkedCount(testPlanSection) < 1) {
  errors.push("`## Test Plan` must have at least one checked checkbox.");
}

const docsChecklistSection = extractSection("Documentation Checklist");
if (docsChecklistSection && checkedCount(docsChecklistSection) < 1) {
  errors.push("`## Documentation Checklist` must have at least one checked checkbox.");
}

const techDebtSection = extractSection("Tech Debt Impact");
if (techDebtSection) {
  const total = totalCheckboxCount(techDebtSection);
  const checked = checkedCount(techDebtSection);

  if (total < 1) {
    errors.push("`## Tech Debt Impact` must include checkbox items.");
  } else if (checked < 1) {
    errors.push("`## Tech Debt Impact` must have one checked option.");
  } else if (checked > 1) {
    errors.push("`## Tech Debt Impact` must have exactly one checked option.");
  }

}

const riskSection = extractSection("Risk & Rollback");
if (riskSection) {
  const normalizedRiskSection = stripComments(riskSection);
  if (!/Risk:\s*\S+/i.test(normalizedRiskSection)) {
    errors.push("`## Risk & Rollback` must include a non-empty `Risk:` value.");
  }
  if (!/Rollback:\s*\S+/i.test(normalizedRiskSection)) {
    errors.push("`## Risk & Rollback` must include a non-empty `Rollback:` value.");
  }
}

const qualitySection = extractSection("Quality Checklist");
if (qualitySection) {
  const total = totalCheckboxCount(qualitySection);
  const checked = checkedCount(qualitySection);

  if (total < 1) {
    errors.push("`## Quality Checklist` must include checkbox items.");
  } else if (checked !== total) {
    errors.push("All checkboxes in `## Quality Checklist` must be checked before merge.");
  }
}

if (errors.length > 0) {
  console.error("PR standards validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("PR standards validation passed.");
