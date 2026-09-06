# Spec: Render zoom memory guard

- **Status:** implemented
- **Intent:** issues #1105 and #1825
- **Date:** 2026-09-06

## Summary

Reject render downsampling that exceeds available memory before scipy allocates.
Validate FITS dimensions from headers before materializing image payloads.

## Requirements

| # | Requirement | Verified by |
|---|-------------|-------------|
| R1 | Available bytes are the lesser of host availability and cgroup v2 limit minus current usage, clamped to zero; unavailable/unlimited cgroup falls back to psutil. | Mocked cgroup and host tests |
| R2 | Reject zoom when input size × itemsize × 3 exceeds 80% of available bytes. | Boundary and dtype tests |
| R3 | Preview and pixeldata check immediately before zoom; guard and scipy MemoryError return HTTP 413. | Route tests, including successful downsampling |
| R4 | Preview, histogram, pixeldata and thumbnail validate header shape before payload access; skip non-image HDUs. | Lazy payload regression tests and real FITS tests |

## Approach

Add two helpers to app/diagnostics.py and call the guard at both zoom sites.
Catch MemoryError locally and return a fixed, actionable HTTP detail. Read image
HDU shape from headers using getattr to skip table HDUs without a shape property.

### Alternatives rejected

| Option | Why not |
|--------|---------|
| Host memory alone or cgroup limit alone | Overestimates memory inside a busy constrained container |
| Change interpolation or subsample by strides | Changes successful image output unnecessarily |
| Global MemoryError handler | Broadens the API change beyond these render sites |

## Data model and API changes

No schema, routes, request parameters or successful response changes. Memory
rejection at either zoom site becomes HTTP 413 with a retry/smaller-image hint.

## Failure modes

| Failure | Detected how | Behaviour |
|---------|--------------|-----------|
| Missing, unreadable, invalid or unlimited cgroup files | Read/parse failure | Use psutil available bytes |
| Container at/over limit | Remaining budget <= 0 | Reject nonempty zoom input |
| Estimate too large or scipy allocation fails | MemoryError | HTTP 413 |
| Oversized compressed FITS | Header element count | HTTP 413 before payload access |

## Flagged concerns

No configured danger-zone paths change. This is a conservative snapshot check,
not a memory reservation; concurrent requests can still race. Concurrency and
slot sizing remain tracked in #1664 and #1773. Existing allocations before zoom
remain subject to the FITS element cap rather than a new dynamic budget.

## Open questions carried forward

None. Scope and 413 mapping are authorized by the card.
