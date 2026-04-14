# Plan: Auth Rate Limiting & Account Lockout (#1096)

## Context

Issue #1096 identifies that auth endpoints (login, register, refresh, change-password) have no per-endpoint rate limiting and no account lockout policy. The global `AspNetCoreRateLimit` middleware applies a blanket 300 req/min limit, which is far too generous for auth endpoints. An attacker can brute-force credentials at scale. This is a security hardening task — auth is called out as "fragile" in CLAUDE.md, so changes must be careful and well-tested.

**Decisions resolved in CEO/eng review:**
- Lockout config → add to existing `JwtSettings` (no new settings class)
- Lockout counter → atomic `$inc` via new `IMongoDBService` methods (race-condition-proof)
- Registration errors → generic but hint-able ("An account with these details already exists")
- Rate limits → config rules in `appsettings.json` (not `[EnableRateLimiting]` attributes — wrong library)
- Admin unlock → out of scope, tracked as #1186

## Changes

### 1. `Configuration/JwtSettings.cs` — Add lockout config
Add two properties:
- `MaxFailedLoginAttempts` (int, default 5)
- `AccountLockoutMinutes` (int, default 15)

### 2. `Models/UserModels.cs` — Add lockout fields to User
Add to `User` class:
- `FailedLoginAttempts` (int, default 0)
- `LockedUntil` (DateTime?, default null)

### 3. `Services/IMongoDBService.cs` — New interface methods
```csharp
Task IncrementFailedLoginAttemptsAsync(string userId, DateTime? lockedUntil = null);
Task ResetFailedLoginAttemptsAsync(string userId);
```

### 4. `Services/MongoDBService.cs` — Implement atomic lockout ops
- `IncrementFailedLoginAttemptsAsync`: `FindOneAndUpdateAsync` with `$inc: { FailedLoginAttempts: 1 }` and conditionally `$set: { LockedUntil }`.
- `ResetFailedLoginAttemptsAsync`: `UpdateOneAsync` with `$set: { FailedLoginAttempts: 0 }` and `$unset: { LockedUntil: "" }`.

### 5. `Services/AuthService.cs` — Lockout logic in LoginAsync
1. **User not found** → dummy `BCrypt.HashPassword` for timing normalization, return null
2. **User locked** → `LockedUntil > UtcNow` → return null (same generic error)
3. **Wrong password** → `IncrementFailedLoginAttemptsAsync`, lock if threshold reached, return null
4. **Correct password** → `ResetFailedLoginAttemptsAsync`, proceed with tokens

Registration: both duplicate errors → `"An account with these details already exists. Please try different credentials."`

### 6. `Services/AuthService.Log.cs` — New log messages (EventIds 2005–2007)
- `LogAccountLocked` — Warning
- `LogAccountLockoutExpired` — Info
- `LogFailedLoginAttempt` — Warning

### 7. `appsettings.json` — Auth-specific rate limit rules
```json
{ "Endpoint": "post:/api/auth/login", "Period": "15m", "Limit": 10 },
{ "Endpoint": "post:/api/auth/register", "Period": "1h", "Limit": 5 },
{ "Endpoint": "post:/api/auth/refresh", "Period": "1m", "Limit": 20 },
{ "Endpoint": "post:/api/auth/change-password", "Period": "15m", "Limit": 5 }
```

### 8. Tests
- AuthServiceTests: lockout, increment, reset, auto-unlock, legacy null handling, generic reg errors
- AuthControllerTests: update registration error assertion

## NOT in scope
- Admin unlock endpoint → #1186
- CAPTCHA / IP blocklist
- Email notification on lockout

## Verification
1. Docker rebuild + `dotnet test`
2. Manual: wrong password 5x → locked → auto-unlock after duration
3. Manual: correct login resets counter
4. Manual: register duplicate → generic error
5. Manual: rate limit 429 on excess login attempts
