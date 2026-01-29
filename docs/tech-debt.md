# Tech Debt Tracking

This document provides **full details and fix approaches** for tech debt items.

## Quick Reference

| What | Where |
|------|-------|
| **Current status** | Run `/tasks` in Claude Code |
| **Task storage** | `~/.claude/tasks/<session-id>/*.json` |
| **Fix approaches** | This file (below) |

## Task Dependencies

```
#10 (MongoDB indexes)         ✅ RESOLVED (PR #35)
#11 (File validation)         ✅ RESOLVED (PR #36)
#12 (Centralized API service) ✅ RESOLVED (PR #37)
#13 (Job queue)               ← blocked by ← #6 (Duplicated import code)
#14 (FITS TypeScript)         ← blocked by ← #7 (Missing TS types)
```

## Priority Levels

- **Critical** (Tasks #1-4): Security vulnerabilities or performance issues that could cause data loss or system compromise
- **Recommended** (Tasks #5-11): Issues that should be fixed before production or that significantly impact maintainability
- **Nice to Have** (Tasks #12-16): Improvements that would enhance code quality but aren't blocking

## Adding New Tech Debt

1. Create task: `TaskCreate subject="..." description="..." metadata={"priority": "...", "category": "..."}`
2. Set dependencies if needed: `TaskUpdate taskId="X" addBlockedBy=["Y"]`
3. Add fix details to this file under appropriate section
4. Update dependency graph above if applicable

---

## Critical Issues

### 1. Path Traversal in Preview Endpoint
**Location**: `processing-engine/main.py:167`

**Issue**: The `/preview/{file_path:path}` endpoint accepts user-controlled paths without validation, allowing attackers to read arbitrary files from the server.

**Impact**: An attacker could read sensitive files like `/etc/passwd`, configuration files, or source code.

**Fix Approach**:
```python
from pathlib import Path

ALLOWED_DATA_DIR = Path("/app/data").resolve()

@app.get("/preview/{file_path:path}")
async def preview_file(file_path: str):
    # Resolve the full path and ensure it's within allowed directory
    requested_path = (ALLOWED_DATA_DIR / file_path).resolve()

    if not requested_path.is_relative_to(ALLOWED_DATA_DIR):
        raise HTTPException(status_code=403, detail="Access denied")

    if not requested_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Continue with file serving...
```

---

### 2. Memory Exhaustion in File Download
**Location**: `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs:111`

**Issue**: The download endpoint reads entire files into memory before sending to client. Large FITS files (100MB+) could exhaust server memory.

**Impact**: Denial of service through memory exhaustion when downloading large files.

**Fix Approach**:
```csharp
[HttpGet("{id}/download")]
public async Task<IActionResult> DownloadFile(string id)
{
    var data = await _mongoDBService.GetAsync(id);
    if (data == null || string.IsNullOrEmpty(data.FilePath))
        return NotFound();

    var filePath = data.FilePath;
    if (!System.IO.File.Exists(filePath))
        return NotFound("File not found on disk");

    // Stream the file instead of loading into memory
    var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read,
        bufferSize: 81920, useAsync: true);

    return File(stream, "application/octet-stream", data.FileName);
}
```

---

### 3. Regex Injection in MongoDB Search
**Location**: `backend/JwstDataAnalysis.API/Services/MongoDBService.cs:76`

**Issue**: User-provided search terms are used directly in regex patterns without escaping, allowing regex injection attacks.

**Impact**: Attackers could craft malicious regex patterns causing ReDoS (Regular Expression Denial of Service) or unexpected query behavior.

**Fix Approach**:
```csharp
public async Task<List<JwstDataModel>> SearchAsync(string searchTerm)
{
    // Escape special regex characters
    var escapedTerm = Regex.Escape(searchTerm);

    var filter = Builders<JwstDataModel>.Filter.Or(
        Builders<JwstDataModel>.Filter.Regex(x => x.FileName,
            new BsonRegularExpression(escapedTerm, "i")),
        Builders<JwstDataModel>.Filter.Regex(x => x.Description,
            new BsonRegularExpression(escapedTerm, "i"))
    );

    return await _collection.Find(filter).ToListAsync();
}
```

---

### 4. Path Traversal in Export Endpoint
**Location**: `backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs:225`

**Issue**: The export endpoint constructs file paths using user input without proper validation.

**Impact**: Potential to write files to arbitrary locations or read from unintended directories.

**Fix Approach**:
```csharp
private string GetSafeExportPath(string requestedFilename)
{
    // Sanitize filename - remove path components
    var safeName = Path.GetFileName(requestedFilename);

    // Additional validation
    if (string.IsNullOrWhiteSpace(safeName) ||
        safeName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
    {
        throw new ArgumentException("Invalid filename");
    }

    var exportDir = Path.Combine(_configuration["ExportDirectory"], "exports");
    return Path.Combine(exportDir, safeName);
}
```

---

## Recommended Issues

### 5. N+1 Query in Export Endpoint
**Location**: `backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs`

**Issue**: Export endpoint fetches each record individually instead of batch loading.

**Impact**: Poor performance when exporting many records; excessive database round-trips.

**Fix Approach**:
```csharp
// Instead of:
foreach (var id in request.Ids)
{
    var item = await _mongoDBService.GetAsync(id);
    items.Add(item);
}

// Use:
var items = await _mongoDBService.GetManyAsync(request.Ids);
```

---

### 6. Duplicated Import Code in MastController
**Location**: `backend/JwstDataAnalysis.API/Controllers/MastController.cs`

**Issue**: Import logic is duplicated across multiple endpoints (`Import`, `ImportFromExisting`, `ResumeImport`).

**Impact**: Bug fixes and changes must be applied in multiple places; risk of inconsistency.

**Fix Approach**: Extract common import logic into a private method or dedicated service:
```csharp
private async Task<IActionResult> ProcessImportedFiles(
    string obsId,
    List<string> filePaths,
    Dictionary<string, object> mastMetadata)
{
    // Common logic for:
    // 1. Creating MongoDB records
    // 2. Extracting FITS metadata
    // 3. Setting processing levels
    // 4. Linking lineage
}
```

---

### 7. Missing Frontend TypeScript Types
**Location**: `frontend/jwst-frontend/src/components/JwstDataDashboard.tsx`

**Issue**: Several response objects use `any` type instead of proper interfaces.

**Impact**: No compile-time type checking; harder to catch bugs; poor IDE support.

**Fix Approach**: Add interfaces in `types/JwstDataTypes.ts`:
```typescript
export interface ProcessingResult {
    algorithmName: string;
    parameters: Record<string, unknown>;
    outputPath: string;
    completedAt: string;
}

export interface FacetedSearchResponse {
    items: JwstData[];
    facets: {
        dataTypes: { value: string; count: number }[];
        statuses: { value: string; count: number }[];
    };
    totalCount: number;
}
```

---

### 8. Hardcoded API URLs in Frontend
**Location**: Multiple files in `frontend/jwst-frontend/src/`

**Issue**: API base URL `http://localhost:5001` is hardcoded throughout components.

**Impact**: Difficult to deploy to different environments; must change code for production.

**Fix Approach**: Create centralized API configuration:
```typescript
// src/config/api.ts
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

// Usage in components:
import { API_BASE_URL } from '../config/api';
const response = await fetch(`${API_BASE_URL}/api/jwstdata`);
```

---

### 9. Statistics Query Loads All Documents
**Location**: `backend/JwstDataAnalysis.API/Services/MongoDBService.cs`

**Issue**: `GetStatisticsAsync()` uses aggregation but some statistics still load full documents.

**Impact**: Slow queries and high memory usage as dataset grows.

**Fix Approach**: Use MongoDB aggregation pipeline with `$group` and `$project`:
```csharp
public async Task<DataStatistics> GetStatisticsAsync()
{
    var pipeline = new BsonDocument[]
    {
        new BsonDocument("$group", new BsonDocument
        {
            { "_id", null },
            { "totalCount", new BsonDocument("$sum", 1) },
            { "totalSize", new BsonDocument("$sum", "$fileSize") },
            { "byType", new BsonDocument("$push", "$dataType") }
        })
    };

    // Process aggregation results...
}
```

---

### 10. Missing MongoDB Indexes ✅ RESOLVED
**Location**: `backend/JwstDataAnalysis.API/Services/MongoDBService.cs`

**Resolution**: Added indexes for commonly queried fields in `EnsureIndexesAsync()`:
- `DataType` (ascending)
- `Status` (ascending)
- `ObservationBaseId` (ascending)
- `ProcessingLevel` (ascending)
- `UploadDate` (descending)
- `FileName` + `Description` (text index for search)

**Commit**: PR #35 (Task #10)

---

### 11. File Extension Validation Bypass ✅ RESOLVED
**Location**: `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs`

**Resolution**: Added `FileContentValidator` class that validates file content using magic bytes/signatures:
- FITS files: Checks for "SIMPLE" header
- CSV files: Validates structure and content
- JSON files: Validates JSON parsing

**Commit**: PR #36 (Task #11)

---

## Nice to Have

### 12. Centralized API Service Layer ✅ RESOLVED
**Location**: `frontend/jwst-frontend/src/services/`

**Resolution**: Implemented centralized API service layer with:
- `apiClient.ts`: Core HTTP client with automatic JSON handling and error extraction
- `ApiError.ts`: Custom error class with status code, statusText, and details
- `jwstDataService.ts`: JWST data operations (getAll, upload, process, archive, delete)
- `mastService.ts`: MAST operations (search, import, progress, cancel, resume)
- `index.ts`: Re-exports for clean imports

**Commit**: PR #37 (Task #12)

---

### 13. Proper Job Queue for Background Tasks
**Location**: `backend/JwstDataAnalysis.API/Controllers/MastController.cs`

**Issue**: Long-running import tasks run in-process without proper queue management.

**Impact**: Server restart loses in-progress jobs; no retry mechanism; limited scalability.

**Fix Approach**: Implement background job processing:
- Option A: Use Hangfire for .NET background jobs
- Option B: Use a message queue (RabbitMQ, Redis) with worker processes
- Option C: Use .NET `IHostedService` with persistent state

---

### 14. FITS TypeScript Interfaces
**Location**: `frontend/jwst-frontend/src/types/`

**Issue**: FITS-related data structures lack proper TypeScript interfaces.

**Impact**: No type safety for FITS metadata; IDE can't provide autocomplete.

**Fix Approach**: Create dedicated FITS types:
```typescript
// src/types/FitsTypes.ts
export interface FitsHeader {
    SIMPLE: boolean;
    BITPIX: number;
    NAXIS: number;
    NAXIS1?: number;
    NAXIS2?: number;
    TELESCOP?: string;
    INSTRUME?: string;
    FILTER?: string;
    DATE_OBS?: string;
    EXPTIME?: number;
}

export interface FitsImageData {
    header: FitsHeader;
    data: Float32Array | Float64Array;
    width: number;
    height: number;
}
```

---

### 15. Download Job Cleanup Timer
**Location**: `processing-engine/app/mast/download_state_manager.py`

**Issue**: Completed/failed download state files are never cleaned up.

**Impact**: Disk space gradually consumed by old state files.

**Fix Approach**: Add periodic cleanup:
```python
import asyncio
from datetime import datetime, timedelta

class DownloadStateManager:
    async def cleanup_old_states(self, max_age_days: int = 7):
        """Remove state files older than max_age_days."""
        cutoff = datetime.now() - timedelta(days=max_age_days)

        for state_file in self.state_dir.glob("*.json"):
            if state_file.stat().st_mtime < cutoff.timestamp():
                state_file.unlink()

    async def start_cleanup_timer(self, interval_hours: int = 24):
        """Run cleanup periodically."""
        while True:
            await self.cleanup_old_states()
            await asyncio.sleep(interval_hours * 3600)
```

---

### 16. Missing Magma/Inferno Colormaps
**Location**: `frontend/jwst-frontend/src/utils/colormaps.ts`

**Issue**: Only basic colormaps implemented; missing popular astronomy colormaps.

**Impact**: Users have limited visualization options for FITS images.

**Fix Approach**: Add additional colormaps:
```typescript
export const COLORMAPS = {
    grayscale: (t: number) => [t * 255, t * 255, t * 255],
    viridis: (t: number) => viridisInterpolate(t),
    magma: (t: number) => magmaInterpolate(t),
    inferno: (t: number) => infernoInterpolate(t),
    plasma: (t: number) => plasmaInterpolate(t),
    // Astronomy-specific
    heat: (t: number) => heatInterpolate(t),
    cool: (t: number) => coolInterpolate(t),
};
```

---

## Tracking Updates

When fixing an item:
1. Mark task as completed: Use TaskUpdate with `status: "completed"`
2. Remove the section from this file or move to a "Resolved" section
3. Include fix commit hash for reference

The task system persists across sessions and tracks dependencies automatically.
