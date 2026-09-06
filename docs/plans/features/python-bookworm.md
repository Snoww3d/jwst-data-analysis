# Plan: Restore Python Docker builds with Bookworm

- **Status:** approved
- **Spec:** Not required; bounded base-image repair outside configured danger zones.
- **Branch:** `codex/python-bookworm`
- **Issue:** Unblocks PR #1987 (and other PRs sharing main's Docker build).

## Approach

Replace the explicit Bullseye variant with `python:3.12-slim-bookworm` in both
Python Dockerfiles. Keep Python 3.12, dependency requirements, build arguments,
non-root users and entrypoints unchanged. Commit this plan before implementation.
Intent is skipped because this repairs an established build, not a new feature.

## Plan review

Hold scope: CI logs show apt security-package 404s before pip or application code
runs. Updating the image is the direct repair. Both existing Python images use
Bullseye; no duplicate repair PR is open. Bookworm is a smaller OS step than
Trixie. The low-risk compatibility concern is newer native libraries/toolchains,
addressed by actual image builds and import smoke tests. No API, persistence,
auth, UI or architecture diagrams change. Proceed with the two-line repair.

## Steps

1. Change both `FROM` lines; verify no active Dockerfile references Bullseye.
2. Build both images, checking apt and pip installation and application imports.
3. Review the diff against REVIEW.md; open the separate PR and verify CI and
   Danger Zone Gate before merging.
4. Update PR #1987 with main's repair and run fresh CI on its updated head.

## Files changed

| File | Change |
|------|--------|
| `processing-engine/Dockerfile` | Use Python 3.12 slim Bookworm |
| `processing-engine/Dockerfile.mast` | Use the same OS/Python base |

## Test plan

1. Build the processing image with existing default build arguments; apt and all
   runtime/calibration dependencies must install successfully.
2. Build the MAST image and import both application entrypoints as their default
   non-root user. Use isolated image tags, without replacing running services.
3. Existing GitHub CI builds both images on amd64 and runs Python tests and E2E.
   Require successful CI Gate and Danger Zone Gate for the repair and PR #1987.

## Rollback

Revert the repair commit. This restores Bullseye and can reintroduce the apt
failure; do not treat rollback as a working build fix.

## Blast radius

The processing engine and MAST proxy share the newer Debian runtime. Native
Python wheels and the compiler toolchain are the compatibility surface. No
application data, contracts, service interfaces or deployment settings change.

## Out of scope

Rendering behavior belongs to PR #1987 and its existing issues #1105/#1825.
