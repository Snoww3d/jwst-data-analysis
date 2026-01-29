# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 12 |
| **Remaining** | 4 |

## Remaining Tasks (4)

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

### 15. Download Job Cleanup Timer
**Priority**: Nice to Have
**Location**: `processing-engine/app/mast/download_state_manager.py`

**Issue**: Completed/failed download state files are never cleaned up.

**Impact**: Disk space gradually consumed by old state files.

**Fix Approach**: Add periodic cleanup with configurable max age (e.g., 7 days)

---

### 16. Missing Magma/Inferno Colormaps
**Priority**: Nice to Have
**Location**: `frontend/jwst-frontend/src/utils/colormaps.ts`

**Issue**: Only basic colormaps implemented; missing popular astronomy colormaps.

**Impact**: Users have limited visualization options for FITS images.

**Fix Approach**: Add magma, inferno, and plasma colormaps

---

## Resolved Tasks (12)

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

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks"
2. Assign next task number (currently: #17)
3. Include: Priority, Location, Issue, Impact, Fix Approach
