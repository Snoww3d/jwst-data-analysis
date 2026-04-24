# Deployment Guide

Operator runbook for the JWST Data Analysis app on AWS EC2 — covers staging
(HTTP, single-IP) and production (HTTPS, custom domain).

> For architecture diagrams, network topology, and design rationale (single-node
> MongoDB, EBS sizing, tiered storage decision), see
> [`architecture/deployment-architecture.md`](architecture/deployment-architecture.md).
>
> For the *why* behind the deploy workflow (manual promote, no auto-rollback,
> stop-the-world deploys, etc.) and what signal would change each decision,
> see [`deploy-workflow-review.md`](deploy-workflow-review.md).

## Architecture

Single EC2 instance running the full Docker Compose stack:

```
Internet → :80 (nginx) → frontend static files
                       → /api → backend:5000 → MongoDB
                                             → processing-engine:8000
```

All services run in Docker containers on one `t3.medium` instance (2 vCPU, 4 GB RAM, 100 GB gp3).

## Prerequisites

- **AWS CLI** installed and configured:
  ```bash
  brew install awscli
  aws configure    # Enter Access Key ID, Secret, region (e.g., us-east-1)
  aws sts get-caller-identity   # Verify
  ```
- **IAM permissions** required: EC2 (full), VPC (read), EIP (allocate/release), SSM (read parameters)

## Deploy

### 1. Provision the EC2 Instance

```bash
./scripts/deploy-aws.sh
```

This creates:
- Security group (SSH + HTTP + HTTPS)
- SSH key pair (saved to `~/.ssh/jwst-staging.pem`)
- EC2 `t3.medium` instance with Amazon Linux 2023
- Elastic IP for stable public address
- User-data script that installs Docker + Docker Compose

All resources are tagged `Project=jwst-app` for easy identification.

### 2. Set Up the App

Wait ~2 minutes for the user-data script to install Docker, then:

```bash
# Copy the setup script
scp -i ~/.ssh/jwst-staging.pem scripts/server-setup.sh ec2-user@<PUBLIC_IP>:~/

# SSH in and run it
ssh -i ~/.ssh/jwst-staging.pem ec2-user@<PUBLIC_IP>
chmod +x server-setup.sh && ./server-setup.sh
```

The setup script:
- Clones the repo
- Creates `.env` with auto-generated MongoDB password and correct CORS origin
- Builds all Docker images (first build takes ~5-10 min)
- Starts all services
- Verifies container health

### 3. Verify

Open `http://<PUBLIC_IP>` in your browser. You should see the JWST frontend.

Test the API: `curl http://<PUBLIC_IP>/api/health`

## Update After Pushing Code

SSH into the server:

```bash
ssh -i ~/.ssh/jwst-staging.pem ec2-user@<PUBLIC_IP>
cd ~/jwst-app
git pull
cd docker
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build
```

Or re-run the setup script (it pulls latest and rebuilds):

```bash
./server-setup.sh
```

## SSH Access

```bash
ssh -i ~/.ssh/jwst-staging.pem ec2-user@<PUBLIC_IP>
```

The key file is created during provisioning at `~/.ssh/jwst-staging.pem`.

## Useful Commands (on the server)

```bash
# View logs
cd ~/jwst-app/docker
docker compose -f docker-compose.yml -f docker-compose.staging.yml logs -f

# Restart all services
docker compose -f docker-compose.yml -f docker-compose.staging.yml restart

# Restart a single service
docker compose -f docker-compose.yml -f docker-compose.staging.yml restart backend

# Stop everything
docker compose -f docker-compose.yml -f docker-compose.staging.yml down

# Check disk usage
df -h
docker system df
```

## Check Status

```bash
./scripts/deploy-aws.sh status
```

Shows instance state, public IP, SSH command, and app URL.

## Teardown

```bash
./scripts/deploy-aws.sh teardown
```

Removes:
- EC2 instance (terminated)
- Elastic IP (released)
- Security group (deleted)
- Key pair from AWS (local `.pem` file is kept)

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| t3.medium (on-demand, 24/7) | ~$30 |
| 100 GB gp3 EBS | ~$8 |
| Elastic IP (attached) | $3.65 |
| Data transfer (light usage) | ~$1 |
| **Total** | **~$43/mo** |

To reduce costs:
- Stop the instance when not testing: `aws ec2 stop-instances --instance-ids <id>`
  - EBS charges continue (~$8/mo), but compute stops
  - EIP charges $3.65/mo even when instance is stopped
- Switch to `t3.small` ($15/mo compute) if 2 GB RAM is sufficient

## Staging vs Production

The staging setup uses `docker-compose.staging.yml` which differs from production:

| Feature | Staging | Production |
|---------|---------|-----------|
| Protocol | HTTP only | HTTPS (TLS) |
| Port | 80 | 80 + 443 |
| SSL certs | None | Let's Encrypt |
| nginx config | `nginx-staging.conf` | `nginx-ssl.conf` |
| CORS origin | `http://<ip>` | `https://domain.com` |

## Disk Usage Notes

JWST FITS files are large (100 MB – 5 GB each). A single target like Pillars of Creation can consume 15–20 GB across all filters. The 100 GB EBS volume provides comfortable headroom for caching multiple targets on the staging server.

If disk fills up:
```bash
# Check usage
ssh -i ~/.ssh/jwst-staging.pem ec2-user@<PUBLIC_IP>
df -h /
sudo du -sh ~/jwst-app/data/mast/* | sort -rh | head -20

# Clear MAST download cache (composites are stored separately)
sudo rm -rf ~/jwst-app/data/mast/*
sudo chown -R 1001:1001 ~/jwst-app/data

# Clean Docker build cache
docker builder prune -af
```

## Production Deployment

The production deploy adds HTTPS, a custom domain, MongoDB backups, and a
least-privilege S3 IAM policy on top of the staging stack.

### Prerequisites

- A registered domain (e.g. `jwst.example.com`)
- A DNS A-record for that domain pointing at the EC2 Elastic IP. **Verify
  propagation before running anything else** — the setup script does its own
  `dig` check, but waiting for DNS first saves a script run.
- AWS CLI configured (same as staging)
- An EC2 instance provisioned (`./scripts/deploy-aws.sh`)
- An S3 bucket for FITS storage (and optionally backups). Apply the
  least-privilege policy from `scripts/s3-iam-policy.json` to the IAM user
  whose access keys go in `.env` (substitute your bucket name for
  `BUCKET_NAME_PLACEHOLDER`). If you use separate buckets for storage
  (`S3_BUCKET_NAME`) and backups (`S3_BACKUP_BUCKET`), duplicate the
  statements in the policy with the second bucket's ARN.

### First-time deploy

```bash
# On your laptop
scp -i ~/.ssh/jwst-staging.pem scripts/server-setup-prod.sh ec2-user@<PUBLIC_IP>:~/

ssh -i ~/.ssh/jwst-staging.pem ec2-user@<PUBLIC_IP>
chmod +x server-setup-prod.sh

# First run — will fail at the cert check and print exactly what to do next
DOMAIN_NAME=jwst.example.com ./server-setup-prod.sh

# Acquire the cert (per the printed instructions)
sudo certbot certonly --standalone -d jwst.example.com

# Copy the FULL letsencrypt tree into ./ssl/. The renewal/ subdir is what
# the in-stack certbot service needs to know which cert to renew — without
# it, `certbot renew` silently no-ops and the cert eventually expires.
# rsync -a preserves the symlinks live/<domain>/* -> ../../archive/<domain>/*.
sudo rsync -a /etc/letsencrypt/ ~/jwst-app/docker/ssl/

# Copy the flat fullchain.pem + privkey.pem that nginx reads at /etc/nginx/ssl/
sudo cp ~/jwst-app/docker/ssl/live/jwst.example.com/fullchain.pem ~/jwst-app/docker/ssl/fullchain.pem
sudo cp ~/jwst-app/docker/ssl/live/jwst.example.com/privkey.pem  ~/jwst-app/docker/ssl/privkey.pem
sudo chown -R $USER:$USER ~/jwst-app/docker/ssl

# Belt-and-suspenders: lock down private keys and the dirs that hold them.
# rsync -a preserves perms (privkey is 600 in /etc/letsencrypt) but explicit
# is better than relying on rsync source state.
find ~/jwst-app/docker/ssl -type f -name 'privkey*.pem' -exec chmod 600 {} +
chmod 600 ~/jwst-app/docker/ssl/privkey.pem 2>/dev/null || true
chmod 700 ~/jwst-app/docker/ssl/archive ~/jwst-app/docker/ssl/live

# Re-run — proceeds past the cert check
DOMAIN_NAME=jwst.example.com ./server-setup-prod.sh

# Verify renewal actually works — this is the single most important post-deploy
# check. If it fails here, the cert silently expires in 90 days.
cd ~/jwst-app/docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    exec certbot certbot renew --dry-run
# Should print "Congratulations, all simulated renewals succeeded."
# If it prints "No renewal configurations found", the rsync above was incomplete.
```

The script:
- Validates `DOMAIN_NAME` format
- Verifies DNS A-record matches the EIP (avoids Let's Encrypt rate-limit lockout)
- Clones / updates the repo
- Generates a strong `MONGO_ROOT_PASSWORD` and `JWT_SECRET_KEY` into `.env`
- Sets `CORS_ALLOWED_ORIGINS=https://$DOMAIN_NAME`
- Brings up `docker-compose.yml + docker-compose.prod.yml` (which includes the
  `certbot` service for auto-renewal)

### TLS renewal

The `certbot` service runs a 12h renewal loop with a `--deploy-hook` that copies
renewed certs from `/etc/letsencrypt/live/$DOMAIN_NAME/` to the flat path nginx
reads. Verify it's running:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs certbot
```

**Known gap**: nginx caches the cert in memory, so renewed certs aren't picked
up until the frontend container restarts. With LE's 60-day renewal window, a
monthly host-cron entry is sufficient:

```cron
0 4 1 * * cd ~/jwst-app/docker && docker compose -f docker-compose.yml -f docker-compose.prod.yml restart frontend
```

### Backup procedure

`scripts/backup-mongo.sh` snapshots MongoDB to `~/jwst-backups/` and (if
`S3_BACKUP_BUCKET` is set in `.env`) uploads to `s3://$BUCKET/backups/`.

Cron entry (runs nightly at 03:00 UTC):

```cron
0 3 * * * /home/ec2-user/jwst-app/scripts/backup-mongo.sh >> /var/log/jwst-backup.log 2>&1
```

Notes:
- Single-node `mongodump` locks the working set during the snapshot — schedule
  during a low-traffic window.
- The S3 lifecycle rule (`scripts/s3-lifecycle-policy.json`) transitions
  `backups/` to Glacier after 30 days and deletes after 90. **Glacier has a
  90-day minimum storage duration**, so objects expired at day 90 incur a
  prorated early-deletion fee for the missing ~30 days. For the volume here
  (one ~tens-of-MB archive per night) this is rounding-error money. To
  eliminate the fee entirely, change the lifecycle expiration to 120 days
  or move the Glacier transition to day 60.
- Cron stderr goes to the log file, not mail (EC2 has no mail config).
  Failure-channel notification is tracked in #1409.

Manual run / dry-run:

```bash
./scripts/backup-mongo.sh --dry-run    # prints planned actions
./scripts/backup-mongo.sh              # actual backup
```

### Restore procedure

`scripts/restore-mongo.sh` reverses a backup. **Test the restore at least once
per quarter** (see #1408) — an untested backup is theater.

```bash
# Stop the backend first to avoid races (the script also warns if the backend
# is connected and requires an explicit override to proceed otherwise)
cd ~/jwst-app/docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend

# Restore from local archive
~/jwst-app/scripts/restore-mongo.sh ~/jwst-backups/jwst-backup-20260423-030000.archive.gz

# Or from S3
~/jwst-app/scripts/restore-mongo.sh s3://your-bucket/backups/jwst-backup-20260423-030000.archive.gz

# Bring backend back up
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
```

The script always prompts for `yes` confirmation; it shows the archive size,
modification time, and target. `--dry-run` exercises the code paths via
`mongorestore --dryRun`.

### Rollback procedure

Manual. See [`deploy-workflow-review.md`](deploy-workflow-review.md) §3 for
why we don't auto-rollback.

```bash
# On prod host
cd ~/jwst-app
git fetch origin --tags

# Pick ONE of the next two commands.
#
# Preferred: roll back to a previous release tag (requires #277 to have shipped).
git checkout <previous-tag>            # e.g. v1.0.3 if v1.0.4 broke
#
# Until #277 ships there are no release tags — use a commit SHA instead.
# Find it with: git log --oneline -20
git checkout <previous-commit-sha>

cd docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# If the bad deploy corrupted data, also restore the last known-good backup:
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend
~/jwst-app/scripts/restore-mongo.sh ~/jwst-backups/<last-known-good>.archive.gz
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
```

> ⚠ **Do not re-run `server-setup-prod.sh` after a rollback.** It does
> `git reset --hard origin/main` and will re-deploy the broken version.
> See the Restore procedure above for the safety prompts
> `restore-mongo.sh` runs if `backend` is still connected.

Estimated downtime during a normal deploy or rollback: **30–90s** (image
build + container swap). Not yet measured on the target VPS — record the
first prod deploy timing and update. Pick an off-peak window.

### Operations

| Task | Command |
|---|---|
| Tail logs | `docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f` |
| Restart all | `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart` |
| Update after `git pull` | Re-run `./server-setup-prod.sh` (idempotent) |
| Manual cert renew | `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec certbot certbot renew --force-renewal` |
| Check cert expiry | `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec certbot certbot certificates` |
| Cert dry-run (verifies renewal config still works) | `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec certbot certbot renew --dry-run` |
| Check backup log | `tail -f /var/log/jwst-backup.log` |

## Future Improvements

These can be added incrementally:

- **Terraform**: Wrap existing AWS resources in Terraform for reproducibility — the current CLI commands map 1:1 to Terraform resources
- **CI/CD**: GitHub Actions workflow to auto-deploy on merge to main (SSH + docker compose up)
- **Tiered storage (EBS + S3)**: Use S3 as a durable backing store for downloaded FITS files, with EBS as a local hot cache. Downloaded files are uploaded to S3 in the background; when a file is needed again, check EBS cache first, then pull from S3 (same-region, free transfer) instead of re-downloading from MAST. Age-based or LRU eviction keeps EBS usage bounded. See development-plan.md F4 for details.
- **Monitoring**: CloudWatch agent for CPU/memory/disk alerts
- **Auto cert reload**: Wire certbot deploy hook to signal nginx reload without a manual `restart frontend`
- **Backup notification channel**: see #1409
