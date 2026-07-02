# #1615 — Honor rate-limit IP whitelist for IPv6-mapped IPv4 addresses

**Issue**: [#1615](https://github.com/Snoww3d/jwst-data-analysis/issues/1615)
**Complexity**: Low (quick plan)

## Problem

`appsettings.Development.json` whitelists IPv4 CIDRs (`127.0.0.1`, `172.16.0.0/12`, …),
but traffic from the Docker bridge reaches Kestrel as IPv6-mapped IPv4
(`::ffff:172.18.0.1`). AspNetCoreRateLimit's whitelist matching is address-family
sensitive, so the entries never match and dev/E2E traffic is rate limited like
production — `post:/api/auth/register` (5/hour) breaks local E2E runs with 429s.

## Fix

Normalize the resolved client IP before it reaches whitelist matching and counter
keying:

- New `Configuration/Ipv4MappedIpResolveContributor.cs` — decorates any
  `IIpResolveContributor`; if the resolved string parses as an IPv4-mapped IPv6
  address, returns `MapToIPv4()`.
- New `Configuration/Ipv4MappedRateLimitConfiguration.cs` — overrides
  `RegisterResolvers()` to wrap every registered IP resolver (connection + real-IP
  header) with the normalizer; clears resolver lists first so re-invocation is
  idempotent.
- `Program.cs`: register `Ipv4MappedRateLimitConfiguration` as the
  `IRateLimitConfiguration` singleton instead of the stock one.

No whitelist/config changes; production behavior unchanged (non-mapped addresses
pass through untouched, and normalization also makes counter keys consistent).

## Tests

`JwstDataAnalysis.API.Tests/Configuration/Ipv4MappedRateLimitConfigurationTests.cs`:

- Mapped connection IP (`::ffff:172.18.0.1`) resolves to `172.18.0.1`.
- Plain IPv4 and plain IPv6 (`::1`) pass through unchanged.
- Non-IP resolver output (e.g. XFF list string) passes through unchanged.
- Null/empty resolver output passes through.
- Configuration wraps all base resolvers (connection + header when `RealIpHeader` set).
