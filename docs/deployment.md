# Deployment Guide

Deploy the JWST Data Analysis app to an AWS EC2 instance for testing/staging.

## Architecture

Single EC2 instance running the full Docker Compose stack:

```
Internet → :80 (nginx) → frontend static files
                       → /api → backend:5000 → MongoDB
                                             → processing-engine:8000
```

All services run in Docker containers on one `t3.medium` instance (2 vCPU, 4 GB RAM, 30 GB gp3).

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
| 30 GB gp3 EBS | ~$2.40 |
| Elastic IP (attached) | $3.65 |
| Data transfer (light usage) | ~$1 |
| **Total** | **~$37/mo** |

To reduce costs:
- Stop the instance when not testing: `aws ec2 stop-instances --instance-ids <id>`
  - EBS charges continue (~$2.40/mo), but compute stops
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

## Future Improvements

These can be added incrementally:

- **Custom domain + SSL**: Register domain, point DNS to Elastic IP, add Let's Encrypt via `docker-compose.prod.yml` + certbot
- **Terraform**: Wrap existing AWS resources in Terraform for reproducibility — the current CLI commands map 1:1 to Terraform resources
- **CI/CD**: GitHub Actions workflow to auto-deploy on merge to main (SSH + docker compose up)
- **S3 storage**: Switch from local volume to S3 bucket for FITS data persistence
- **Backups**: Automated EBS snapshots or `mongodump` cron job
- **Monitoring**: CloudWatch agent for CPU/memory/disk alerts
