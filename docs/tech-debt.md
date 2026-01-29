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
#12 (Centralized API service) ← blocked by ← #8 (Hardcoded URLs)
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

### 10. Missing MongoDB Indexes
**Location**: MongoDB collection configuration

**Issue**: No indexes defined for commonly queried fields.

**Impact**: Full collection scans for filtered queries; poor performance at scale.

**Fix Approach**: Add indexes for frequently queried fields:
```csharp
// In MongoDB initialization or migration
await _collection.Indexes.CreateManyAsync(new[]
{
    new CreateIndexModel<JwstDataModel>(
        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.DataType)),
    new CreateIndexModel<JwstDataModel>(
        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.Status)),
    new CreateIndexModel<JwstDataModel>(
        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.ObservationBaseId)),
    new CreateIndexModel<JwstDataModel>(
        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.UploadDate)),
    new CreateIndexModel<JwstDataModel>(
        Builders<JwstDataModel>.IndexKeys.Text(x => x.FileName)
            .Text(x => x.Description))
});
```

---

### 11. File Extension Validation Bypass
**Location**: `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs`

**Issue**: File upload validation checks extension but doesn't verify actual file content.

**Impact**: Malicious files could be uploaded with renamed extensions.

**Fix Approach**: Validate file magic bytes/signatures:
```csharp
private static readonly Dictionary<string, byte[]> FileSignatures = new()
{
    { ".fits", new byte[] { 0x53, 0x49, 0x4D, 0x50, 0x4C, 0x45 } }, // "SIMPLE"
    { ".csv", null }, // Text file, check for valid CSV structure
    { ".json", null }  // Text file, validate JSON parsing
};

private bool ValidateFileContent(IFormFile file)
{
    var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (!FileSignatures.TryGetValue(extension, out var signature))
        return false;

    if (signature != null)
    {
        using var reader = new BinaryReader(file.OpenReadStream());
        var header = reader.ReadBytes(signature.Length);
        return header.SequenceEqual(signature);
    }

    return true; // Text files validated differently
}
```

---

## Nice to Have

### 12. Centralized API Service Layer
**Location**: Frontend components

**Issue**: Each component makes its own fetch calls with duplicated error handling.

**Impact**: Inconsistent error handling; harder to add global features like auth tokens.

**Fix Approach**: Create a centralized API service:
```typescript
// src/services/api.ts
class ApiService {
    private baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';

    async get<T>(endpoint: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`);
        if (!response.ok) throw new ApiError(response);
        return response.json();
    }

    async post<T>(endpoint: string, data: unknown): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new ApiError(response);
        return response.json();
    }
}

export const api = new ApiService();
```

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
