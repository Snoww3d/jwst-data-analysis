# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 14 |
| **Remaining** | 3 |

## Remaining Tasks (3)

### 13. Proper Job Queue for Background Tasks
**Priority**: Nice to Have
**Location**: `backend/JwstDataAnalysis.API/Controllers/MastController.cs`

**Issue**: Long-running import tasks run in-process without proper queue management.

**Impact**: Server restart loses in-progress jobs; no retry mechanism; limited scalability.

**Fix Approach**: Implement background job processing:
- Option A: Use Hangfire for .NET background jobs
- Option B: Use a message queue (RabbitMQ, Redis) with worker processes
- Option C: Use .NET `IHostedService` with persistent state

---

### 14. FITS TypeScript Interfaces
**Priority**: Nice to Have
**Location**: `frontend/jwst-frontend/src/types/`

**Issue**: FITS-related data structures lack proper TypeScript interfaces.

**Impact**: No type safety for FITS metadata; IDE can't provide autocomplete.

**Fix Approach**: Create dedicated FITS types in `src/types/FitsTypes.ts`

---

### 17. Stretched Histogram Panel Drag UX
**Priority**: Nice to Have
**Location**: `frontend/jwst-frontend/src/components/ImageViewer.tsx`

**Issue**: The stretched histogram panel's drag behavior doesn't match user expectations. Users expect to drag markers TO a visual position, but the current implementation treats drag distance as "how much to add" scaled by range.

**Current Behavior**:
- Markers always at edges (0 and 1) on stretched panel
- Formula: `newBlack = originalBlack + range × position × sensitivity`
- 0.2x sensitivity helps but doesn't fully solve the UX mismatch

**Impact**: Fine-tuning black/white points on the stretched panel is unintuitive. Users overshoot or undershoot desired values.

**Fix Approach Options**:
1. **Snap-to-data feature**: Button that auto-detects where histogram data starts
2. **Direct position mapping**: Show actual positions within current range (zoomed view)
3. **Visual feedback**: Show ghost marker at target position while dragging
4. **Adaptive sensitivity**: Sensitivity proportional to current range
5. **Click-to-set**: Click anywhere on histogram to set that value

**Related**: PR #50

---

## Resolved Tasks (14)

| Task | Description | PR |
|------|-------------|-----|
| #1 | Path Traversal in Preview Endpoint | PR #26 |
| #2 | Memory Exhaustion in File Download | PR #27 |
| #3 | Regex Injection in MongoDB Search | PR #28 |
| #4 | Path Traversal in Export Endpoint | PR #29 |
| #5 | N+1 Query in Export Endpoint | PR #30 |
| #6 | Duplicated Import Code in MastController | PR #31 |
| #7 | Missing Frontend TypeScript Types | PR #32 |
| #8 | Hardcoded API URLs in Frontend | PR #33 |
| #9 | Statistics Query Loads All Documents | PR #34 |
| #10 | Missing MongoDB Indexes | PR #35 |
| #11 | File Extension Validation Bypass | PR #36 |
| #12 | Centralized API Service Layer | PR #37 |
| #15 | Download Job Cleanup Timer | PR #46 |
| #16 | Missing Magma/Inferno Colormaps | PR #45 |

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks"
2. Assign next task number (currently: #18)
3. Include: Priority, Location, Issue, Impact, Fix Approach
