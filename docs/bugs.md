# Bug Tracker

This document tracks known bugs and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Open** | 1 |
| **Resolved** | 2 |

## Open Bugs

### 66. Race Condition in Download Resume
**Priority**: Medium
**Location**: `processing-engine/app/mast/routes.py:422-439`

**Issue**: No check for duplicate resume requests - two clients could resume the same download job simultaneously, corrupting state.

**Reproduction Steps**:
1. Start a MAST download that gets interrupted
2. Send two concurrent resume requests for the same job ID
3. Both proceed without conflict detection

**Expected Behavior**: Second resume request should return 409 Conflict while first is in progress.

**Fix Approach**:
1. Track in-progress resumes in a set with async lock
2. Return 409 Conflict if job already being resumed
3. Clean up tracking on completion/failure

---

<!-- Template for new bugs
### [Bug ID]. [Brief Description]
**Priority**: High/Medium/Low
**Location**: [File or Component]

**Issue**: [Description of what is wrong]

**Reproduction Steps**:
1. [Step 1]
2. [Step 2]

**Expected Behavior**: [What should happen]
-->

## Resolved Bugs

| Bug ID | Description | PR |
|--------|-------------|----|
| 60 | Unsafe URL Construction in Frontend | #158 |
| 65 | Information Disclosure in Error Messages | TBD |
