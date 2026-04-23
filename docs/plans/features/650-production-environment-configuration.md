# #650 — Production Environment Configuration

**Issue:** [#650](https://github.com/Snoww3d/jwst-data-analysis/issues/650)
**Branch:** `feature/650-production-environment-configuration`
**Phase:** 6 (Production Readiness) — CE deploy blocker
**Status:** Plan approved — implementation pending
**Plan dates:** initial 2026-04-16 (uncommitted) → revised 2026-04-23 after CEO + eng review

## Background

Configure the operational pieces needed to run the JWST app in production on a single VPS / EC2 instance: production bootstrap script, MongoDB backup + restore, IAM policy for the app's S3 bucket, S3 lifecycle for backups, and a production runbook. Closes the last operational gap before the CE deploy.

Companion CE deploy blockers: #1339 (closed), #650 (this issue), #652 (deploy workflow review), #1040 (remove window.jwst).

## What already exists (do not reimplement)

- JWT placeholder fail-fast: `backend/JwstDataAnalysis.API/Program.cs:72-77`
- Compose fail-fast on missing `JWT_SECRET_KEY` / `CORS_ALLOWED_ORIGINS` (`docker/docker-compose.prod.yml`)
- TLS config: `frontend/jwst-frontend/nginx-ssl.conf` (TLS 1.2/1.3, HSTS, OCSP)
- Staging bootstrap: `scripts/server-setup.sh` (~80% of logic reusable for prod)
- S3 lifecycle: `scripts/apply-s3-lifecycle.sh` + `scripts/s3-lifecycle-policy.json` (mast/, mosaic/ prefixes)
- EC2 provisioning: `scripts/deploy-aws.sh`
- Mongo image `mongo:8.0` ships `mongodump` v100.15.0 + `mongorestore` + `mongosh` at `/usr/bin/`

## Decisions locked in

| ID | Decision | Outcome | Follow-up |
|---|---|---|---|
| D1 | server-setup.sh refactor vs parallel | Parallel `server-setup-prod.sh` now | #1411 to consolidate later |
| D2 | Commented-out certbot stanza | Un-comment + use in-stack 12h auto-renewal loop | — |
| D3 | PR splitting strategy | Single PR (~600 LOC) — atomic deploy story | — |

## Final scope (9 deliverables)

### 1. `scripts/server-setup-prod.sh` (NEW)

Production bootstrap, parallel to `server-setup.sh`.

Behaviors:
- Wait for Docker readiness (mirror existing pattern)
- Clone / update repo to `$HOME/jwst-app` (same path as staging)
- Validate `DOMAIN_NAME` env var: present + matches hostname regex (RFC 1123 simplified: `^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$`)
- DNS preflight: `dig +short $DOMAIN_NAME` must equal the EC2 EIP. Abort with readable error + retry hint if mismatched (avoids Let's Encrypt rate-limit lockout: 5 failed validations/hour/domain).
- Profile-switch detection: if existing `.env` has `CORS_ALLOWED_ORIGINS=http://...` (HTTP staging), prompt for explicit confirmation before overwriting with HTTPS.
- Create `.env` if missing (auto-generate Mongo password; HTTPS CORS origin from `DOMAIN_NAME`).
- Set up `data/` directory with uid/gid 1001 (same as staging).
- SSL cert presence check: validate `docker/ssl/fullchain.pem` and `docker/ssl/privkey.pem` exist before invoking compose. If absent, print certbot acquisition instructions and exit (HTTP-only first, then re-run script).
- Bring up stack: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
- Verify health: backend `/api/health`, frontend `/`, certbot service running.
- Idempotent: re-run pulls latest, rebuilds, restarts.

Does NOT duplicate JWT placeholder check (Program.cs already enforces).

### 2. `scripts/backup-mongo.sh` (NEW)

Nightly MongoDB backup wrapper. Output is the mongodump native archive
format (`--archive --gzip`), gzip-streamed straight from mongodump — no
intermediate tar wrapper.

Behaviors:
- Pre-flight checks (in order, abort on first failure):
  1. `docker inspect jwst-mongodb --format '{{.State.Status}}'` == "running"
  2. `docker exec jwst-mongodb which mongodump` resolves
  3. Free disk space at `$BACKUP_DIR` ≥ 2× current dataset size (estimated via `mongosh ... db.adminCommand({listDatabases:1}).totalSize.toString()`; if mongosh fails, the 2× check is skipped with a warning rather than aborting).
- Read credentials from `$ENV_FILE` (default `$SCRIPT_DIR/../docker/.env`).
- Build URI: `mongodb://$USER:$PASS@mongodb:27017/?authSource=admin` and `export` it.
- Invoke mongodump via `docker exec -e MONGO_URI jwst-mongodb sh -c '...'` so the URI is expanded by the in-container shell — the password never appears on host argv (verified: `ps -ef | grep -F "$PASS"` returns 0 lines during a real run).
- Output: `$BACKUP_DIR/jwst-backup-$(date -u +%Y%m%d-%H%M%S).archive.gz` (default `$BACKUP_DIR=$HOME/jwst-backups`).
- Integrity check: `gzip -t $OUT` must succeed; otherwise delete partial archive and exit non-zero.
- If `S3_BACKUP_BUCKET` is set: `aws s3 cp $OUT s3://$BUCKET/backups/$(basename $OUT)`. On S3 failure, KEEP the local archive (don't delete).
- Retention: `find -mtime +$RETENTION_DAYS -delete` (default 7).
- `--dry-run` flag: prints planned commands via `printf '%q '` (copy-pasteable), executes nothing.
- Sets explicit `PATH=/usr/local/bin:...` so cron picks up the AWS CLI installed at `/usr/local/bin/aws` on Amazon Linux.
- Logs to `/var/log/jwst-backup.log` (cron-friendly; failures visible without mail).

### 3. `scripts/restore-mongo.sh` (NEW — added per CEO review R1)

Reverse of backup-mongo.sh. Operates directly on the mongodump `.archive.gz`
format (no tar extraction step). Without a tested restore, the backup
pipeline is theater.

Behaviors:
- Args: `<archive-path-or-s3-uri> [--dry-run]`. If `s3://...`, download to a `mktemp` temp file first (trap-cleaned).
- Integrity check: `gzip -t $ARCHIVE` before going further.
- Pre-flight: confirm `jwst-mongodb` is running and `mongorestore` is in the container.
- Active-connections check: in-container `mongosh ... print(db.serverStatus().connections.current.toString())`. If the count doesn't parse, fail CLOSED (refuse to proceed). If > 1 (i.e. backend is connected), warn loudly and require typing the literal string "RESTORE OVER LIVE DB" to proceed.
- Confirmation prompt: show archive mtime + size + target; require typing "yes" to proceed.
- `docker cp` the archive into the container; run `docker exec -e MONGO_URI jwst-mongodb sh -c "mongorestore --uri=\"\$MONGO_URI\" ..."` so the password never appears on host argv (same pattern as backup; verified via `ps -ef`).
- Adds `--dryRun` flag when `--dry-run` is passed (mongorestore validates archive without applying changes).
- On mongorestore failure: prints a multi-line WARNING block explaining the partially-restored DB risk (`--drop` drops each collection right before restoring it) and instructs the operator to re-run rather than start the backend.
- Post-restore verification (non-dry-run): collection counts logged via in-container mongosh script.
- Sets explicit `PATH=/usr/local/bin:...` for cron-style invocations.

### 4. `scripts/s3-iam-policy.json` (NEW)

Least-privilege bucket policy. Actions verified against actual S3 client call sites:

- Backend `S3StorageProvider.cs`: PutObject, GetObject, GetObjectMetadata (HeadObject), DeleteObject
- Processing-engine `s3_storage.py`: head_object, put_object, upload_file (multipart), download_file, delete_object, generate_presigned_url

Required actions:
- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::$BUCKET/*`
- `s3:ListBucket`, `s3:GetBucketLocation` on `arn:aws:s3:::$BUCKET`
- `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` on `arn:aws:s3:::$BUCKET/*` (large FITS via boto3 TransferConfig + AmazonS3Client default multipart)
- `s3:ListBucketMultipartUploads` on `arn:aws:s3:::$BUCKET`

Explicit denies:
- `s3:DeleteBucket`, `s3:CreateBucket`, `s3:PutBucketAcl`, `s3:PutBucketPolicy`

Bucket name parameterized via `$BUCKET_NAME` placeholder; users substitute in their own.

### 5. `scripts/s3-lifecycle-policy.json` (EXTEND)

Add a third rule to the existing array:

```json
{
  "ID": "backups-glacier-and-expire",
  "Filter": { "Prefix": "backups/" },
  "Status": "Enabled",
  "Transitions": [
    { "Days": 30, "StorageClass": "GLACIER" }
  ],
  "Expiration": { "Days": 90 }
}
```

Existing `mast-intelligent-tiering` and `mosaic-intelligent-tiering` rules untouched.

### 6. `docs/deployment.md` (EXTEND)

Add a new top-level "## Production Deployment" section after the existing "Staging vs Production" table. Sections:

- **Prerequisites** — domain registered, DNS A-record pointing to EIP, AWS CLI configured, `.env` ready
- **First-time deploy** — domain setup → DNS verification → certbot HTTP-01 challenge (via temp HTTP-only profile or standalone) → cert files in `docker/ssl/` → run `server-setup-prod.sh` → verify HTTPS in browser
- **Renewal** — explanation of in-stack certbot 12h loop (no host cron needed); how to verify it's working (`docker compose logs certbot`)
- **Backup procedure** — `backup-mongo.sh` cron entry example (`0 3 * * * /home/ec2-user/jwst-app/scripts/backup-mongo.sh >> /var/log/jwst-backup.log 2>&1`); low-traffic-window note (single-node mongodump locks working set during snapshot)
- **Restore procedure** — `restore-mongo.sh` usage; warning about active-connections check; example: stop backend → restore → start backend
- **Operations** — log locations, common ops (rebuild after code update, log tail, manual cert renew)

Add cross-link at top: "For architecture diagrams and design rationale (single-node MongoDB, EBS sizing), see [`architecture/deployment-architecture.md`](architecture/deployment-architecture.md)."

Remove (or move to "Decision Log") the now-obsolete bullets in "Future Improvements": Custom domain + SSL, Backups (these are the work this PR is doing).

### 7. `docker/docker-compose.prod.yml` (EDIT)

Two changes:
- Un-comment the `certbot:` service stanza (lines ~50-60). Verify image tag `certbot/certbot:v5.2.0` is current; bump if needed.
- Add comments:
  - On the `frontend` service `ports:` block: `# 0.0.0.0 binding intentional for production (vs dev's 127.0.0.1) — frontend is the public ingress.`
  - Above the `certbot` service: `# In-stack auto-renewal (12h loop). First-cert acquisition still requires a manual run before HTTPS activates — see docs/deployment.md.`

### 8. `docker/.env.example` (EDIT)

Add `DOMAIN_NAME` to the existing "Production TLS/HTTPS Configuration" section:

```
# Domain name for production deployment. Must have a DNS A-record
# pointing to your EIP before running server-setup-prod.sh (the script
# verifies DNS before invoking certbot to avoid Let's Encrypt rate limits).
# Format: lowercase RFC 1123 hostname (e.g., jwst.example.com).
DOMAIN_NAME=
```

Plus an `S3_BACKUP_BUCKET` line in the storage section (used by backup-mongo.sh):

```
# S3 bucket for MongoDB backup uploads (optional). Leave empty for local-only
# backups. If set, backup-mongo.sh uploads each archive to s3://$BUCKET/backups/.
S3_BACKUP_BUCKET=
```

### 9. `MEMORY.md` (EDIT)

Update the "Current Workstream" → "Next" line: remove `#650 (production env config)` from the CE deploy blocker list now that it's shipping.

## Test plan

Pre-flight (before merging):
- [x] `docker exec jwst-mongodb which mongodump` returns `/usr/bin/mongodump` (verified locally — also `mongorestore`, `mongosh` present)
- [x] AWS SDK / boto3 multipart thresholds match assumed actions (audit complete in eng review)

Script tests (verified locally against running jwst-mongodb container):
- [x] backup-mongo.sh: happy path → 20MB `.archive.gz`, exit 0
- [x] backup-mongo.sh: integrity check passes (`gzip -t` succeeds)
- [x] backup-mongo.sh: --dry-run prints planned actions via `printf '%q'`, executes nothing
- [x] backup-mongo.sh: credential NOT visible in `ps -ef | grep -F "$MONGO_PASS"` during live dump (returns 0 lines — verified Round 1 + Round 2)
- [x] restore-mongo.sh: --dry-run round-trip with --dryRun mongorestore succeeds
- [x] restore-mongo.sh: confirmation prompt blocks unintended overwrite (refuses without "yes")
- [x] restore-mongo.sh: refuses with override required when active connections > 1
- [x] restore-mongo.sh: credential NOT visible in `ps -ef` during live mongorestore (Round 2 fix verified via `bash -x` trace)
- [x] all 3 scripts: `bash -n` syntax check passes
- [x] s3-iam-policy.json + s3-lifecycle-policy.json: `jq empty` passes
- [x] docker-compose.prod.yml: `docker compose config` validates with required env vars
- [ ] backup-mongo.sh: pre-flight disk-space check fails-fast when free < 2× dataset (not exercised — would need a constrained-disk test env)
- [ ] backup-mongo.sh: container-down case exits non-zero with readable error (logical inspection only; not exercised)
- [ ] backup-mongo.sh: S3 upload failure preserves local archive (no S3 bucket configured locally)
- [ ] backup-mongo.sh: retention prunes older files (would need backups older than 7 days)
- [ ] restore-mongo.sh: round-trip with real mongorestore (would mutate local DB; deferred to staging)
- [ ] server-setup-prod.sh: not exercisable locally (needs EC2 + EIP + real DNS)

IAM policy (against test bucket):
- [ ] Allows: GetObject, PutObject, DeleteObject, HeadObject, ListBucket, GetBucketLocation
- [ ] Allows: AbortMultipartUpload, ListBucketMultipartUploads, ListMultipartUploadParts
- [ ] Denies: DeleteBucket, CreateBucket, PutBucketAcl
- [ ] Upload 50MB FITS via processing-engine → multipart succeeds
- [ ] Presigned URL generation succeeds, URL is fetchable

Lifecycle policy:
- [ ] backups/ rule applies (verify via `aws s3api get-bucket-lifecycle-configuration`)
- [ ] mast/ + mosaic/ rules unaffected

Docs:
- [ ] All commands in production runbook copy-paste runnable
- [ ] Cross-link present
- [ ] Cron entry example matches actual script path
- [ ] Renewal procedure works (`certbot renew --dry-run` from inside the certbot container)

Manual full-deploy smoke (post-merge):
- [ ] Fresh EC2 + new domain → server-setup-prod.sh succeeds end-to-end
- [ ] HTTPS works in browser; HTTP 301-redirects to HTTPS
- [ ] `certbot renew --dry-run` succeeds inside certbot container
- [ ] Nightly backup cron fires, archive appears in S3

Docker rebuild required: NO (operational scripts + docs + .env.example + lifecycle JSON only). Compose change is metadata + one previously-commented service.

## Docs update checklist

- [x] `docs/deployment.md` — primary deliverable (Production section)
- [ ] `docs/key-files.md` — add `scripts/backup-mongo.sh`, `scripts/restore-mongo.sh`, `scripts/server-setup-prod.sh`, `scripts/s3-iam-policy.json`
- [ ] `docs/quick-reference.md` — add backup/restore command examples
- [x] `docs/architecture/deployment-architecture.md` — cross-link added; review for any contradictions
- [x] `docs/standards/backend-development.md` — N/A (no .NET code change)
- [x] `docs/development-plan.md` — mark #650 complete in Phase 6

## Risks accepted vs filed

| Risk | Status | Tracker |
|---|---|---|
| R1 — Untested backups | Mitigated in-PR (restore script + tested round-trip); cadence follow-up filed | #1408 |
| R2 — LE rate-limit lockout | Mitigated in-PR (DNS preflight) | — |
| R3 — Mongo creds in `ps aux` | Mitigated in-PR (env-file read, no inline `-p`) | — |
| R4 — Setup script duplication | Accepted with follow-up | #1411 |
| R5 — Commented certbot dead code | Mitigated in-PR (un-comment) | — |
| R6 — Backup S3 unbounded growth | Mitigated in-PR (lifecycle backups/ rule) | — |
| R7 — IAM action incompleteness | Mitigated in-PR (verified actions) | — |
| R8 — Cron silence on failure | Accepted with follow-up | #1409 |
| R9 — Profile re-run footgun | Mitigated in-PR (profile-switch warning) | — |
| R10 — deployment.md vs architecture/ overlap | Accepted with follow-up | #1410 |

## NOT in scope

- Docker network isolation (#651)
- Deploy workflow review / blue-green / rollback (#652)
- Container resource limits (#745)
- MongoDB Atlas / replica set (Phase 7+)
- Terraform IaC (Phase 7+)
- CloudWatch monitoring (#644-#646)
- Restore drill cadence (#1408)
- Backup notifications (#1409)
- Docs consolidation (#1410)
- server-setup script consolidation (#1411)

## Implementation order

To keep self-review sane, implement in this order so each layer is testable on its own:

1. `docker/.env.example` — add DOMAIN_NAME + S3_BACKUP_BUCKET (smallest change, unblocks scripts)
2. `scripts/s3-iam-policy.json` + `scripts/s3-lifecycle-policy.json` extension — JSON only, no runtime
3. `scripts/backup-mongo.sh` — testable locally against the running jwst-mongodb container
4. `scripts/restore-mongo.sh` — round-trip tested with #3
5. `scripts/server-setup-prod.sh` — depends on .env additions; can't fully test locally (no EIP)
6. `docker/docker-compose.prod.yml` — un-comment certbot + comments
7. `docs/deployment.md` — Production section; references all above
8. `MEMORY.md` — update Next list
9. Self-review (code-reviewer agent) — iterate until clean
10. Push, open PR with full body + test plan checked

Auth-adjacent flag: touches CORS env var defaults via setup script; does NOT touch Program.cs CORS code or JWT validation. Per CLAUDE.md "auth flow is currently fragile" — extra care in self-review on the env-var generation logic.
