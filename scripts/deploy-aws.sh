#!/usr/bin/env bash
# deploy-aws.sh — Provision an EC2 instance for JWST app staging
#
# Usage:
#   ./scripts/deploy-aws.sh          # Full provisioning
#   ./scripts/deploy-aws.sh teardown  # Remove all AWS resources
#   ./scripts/deploy-aws.sh status    # Show instance status and SSH command
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - Sufficient IAM permissions (EC2, VPC, EIP)
#
# Creates: Security Group, Key Pair, EC2 instance (t3.medium), Elastic IP
# All resources are tagged with Project=jwst-app for easy identification

set -euo pipefail

# --- Configuration -----------------------------------------------------------
PROJECT_TAG="jwst-app"
INSTANCE_TYPE="t3.medium"
VOLUME_SIZE=30                    # GB, gp3
KEY_NAME="jwst-staging"
SG_NAME="jwst-staging-sg"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"
KEY_FILE="$HOME/.ssh/${KEY_NAME}.pem"

# Amazon Linux 2023 x86_64 — resolve latest AMI dynamically
AMI_SSM_PATH="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"

# --- Helpers ------------------------------------------------------------------
info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()    { printf "\033[1;32m[OK]\033[0m    %s\n" "$*"; }
err()   { printf "\033[1;31m[ERROR]\033[0m %s\n" "$*" >&2; }
die()   { err "$@"; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"
}

get_resource_id() {
    # Retrieve a tagged resource. Returns empty string if not found.
    local resource_type="$1"
    case "$resource_type" in
        instance)
            aws ec2 describe-instances \
                --filters "Name=tag:Project,Values=$PROJECT_TAG" \
                          "Name=instance-state-name,Values=pending,running,stopped" \
                --query "Reservations[0].Instances[0].InstanceId" \
                --output text --region "$REGION" 2>/dev/null | grep -v "^None$" || true
            ;;
        sg)
            aws ec2 describe-security-groups \
                --filters "Name=group-name,Values=$SG_NAME" \
                --query "SecurityGroups[0].GroupId" \
                --output text --region "$REGION" 2>/dev/null | grep -v "^None$" || true
            ;;
        eip)
            aws ec2 describe-addresses \
                --filters "Name=tag:Project,Values=$PROJECT_TAG" \
                --query "Addresses[0].AllocationId" \
                --output text --region "$REGION" 2>/dev/null | grep -v "^None$" || true
            ;;
        eip-ip)
            aws ec2 describe-addresses \
                --filters "Name=tag:Project,Values=$PROJECT_TAG" \
                --query "Addresses[0].PublicIp" \
                --output text --region "$REGION" 2>/dev/null | grep -v "^None$" || true
            ;;
    esac
}

# --- Teardown -----------------------------------------------------------------
teardown() {
    info "Tearing down all $PROJECT_TAG resources in $REGION..."

    local instance_id eip_alloc sg_id

    # Terminate instance
    instance_id=$(get_resource_id instance)
    if [[ -n "$instance_id" ]]; then
        info "Terminating instance $instance_id..."
        aws ec2 terminate-instances --instance-ids "$instance_id" --region "$REGION" --output text >/dev/null
        info "Waiting for instance termination..."
        aws ec2 wait instance-terminated --instance-ids "$instance_id" --region "$REGION"
        ok "Instance terminated"
    fi

    # Release Elastic IP
    eip_alloc=$(get_resource_id eip)
    if [[ -n "$eip_alloc" ]]; then
        info "Releasing Elastic IP $eip_alloc..."
        aws ec2 release-address --allocation-id "$eip_alloc" --region "$REGION"
        ok "Elastic IP released"
    fi

    # Delete Security Group (may need retries while ENIs detach)
    sg_id=$(get_resource_id sg)
    if [[ -n "$sg_id" ]]; then
        info "Deleting security group $sg_id..."
        local retries=0
        while ! aws ec2 delete-security-group --group-id "$sg_id" --region "$REGION" 2>/dev/null; do
            retries=$((retries + 1))
            if [[ $retries -ge 12 ]]; then
                err "Could not delete security group after 60s — ENIs may still be attached"
                break
            fi
            sleep 5
        done
        ok "Security group deleted"
    fi

    # Delete key pair (keep local file as backup)
    if aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" &>/dev/null; then
        aws ec2 delete-key-pair --key-name "$KEY_NAME" --region "$REGION"
        ok "Key pair deleted from AWS (local file kept at $KEY_FILE)"
    fi

    ok "Teardown complete"
}

# --- Status -------------------------------------------------------------------
status() {
    local instance_id public_ip state

    instance_id=$(get_resource_id instance)
    if [[ -z "$instance_id" ]]; then
        info "No $PROJECT_TAG instance found in $REGION"
        return
    fi

    state=$(aws ec2 describe-instances --instance-ids "$instance_id" \
        --query "Reservations[0].Instances[0].State.Name" \
        --output text --region "$REGION")
    public_ip=$(get_resource_id eip-ip)

    echo ""
    echo "  Instance:  $instance_id"
    echo "  State:     $state"
    echo "  Region:    $REGION"
    echo "  Public IP: ${public_ip:-none}"
    echo ""

    if [[ -n "$public_ip" && "$state" == "running" ]]; then
        echo "  SSH:       ssh -i $KEY_FILE ec2-user@$public_ip"
        echo "  App:       http://$public_ip"
    fi
    echo ""
}

# --- Provision ----------------------------------------------------------------
provision() {
    require_cmd aws
    require_cmd jq

    # Verify AWS credentials
    info "Verifying AWS credentials..."
    local account_id
    account_id=$(aws sts get-caller-identity --query Account --output text --region "$REGION" 2>/dev/null) \
        || die "AWS CLI not configured. Run: aws configure"
    ok "Authenticated to AWS account $account_id (region: $REGION)"

    # Check for existing instance
    local existing_instance
    existing_instance=$(get_resource_id instance)
    if [[ -n "$existing_instance" ]]; then
        die "Instance $existing_instance already exists. Run '$0 status' or '$0 teardown' first."
    fi

    # 1. Resolve AMI
    info "Resolving latest Amazon Linux 2023 AMI..."
    local ami_id
    ami_id=$(aws ssm get-parameters --names "$AMI_SSM_PATH" \
        --query "Parameters[0].Value" --output text --region "$REGION") \
        || die "Could not resolve AMI from SSM"
    ok "AMI: $ami_id"

    # 2. Security Group
    info "Creating security group..."
    local vpc_id sg_id
    vpc_id=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" \
        --query "Vpcs[0].VpcId" --output text --region "$REGION") \
        || die "No default VPC found in $REGION"

    sg_id=$(aws ec2 create-security-group \
        --group-name "$SG_NAME" \
        --description "JWST staging - SSH + HTTP + HTTPS" \
        --vpc-id "$vpc_id" \
        --query "GroupId" --output text --region "$REGION")

    aws ec2 authorize-security-group-ingress --group-id "$sg_id" --region "$REGION" \
        --ip-permissions \
        "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description=SSH}]" \
        "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]" \
        "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]" \
        --output text >/dev/null

    aws ec2 create-tags --resources "$sg_id" --region "$REGION" \
        --tags Key=Project,Value="$PROJECT_TAG"
    ok "Security group: $sg_id"

    # 3. Key Pair
    if [[ -f "$KEY_FILE" ]]; then
        info "Key file exists at $KEY_FILE — importing to AWS..."
        # Import existing public key if key pair doesn't exist in AWS
        if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" &>/dev/null; then
            # Generate public key from private key and import
            local pub_key
            pub_key=$(ssh-keygen -y -f "$KEY_FILE")
            aws ec2 import-key-pair --key-name "$KEY_NAME" \
                --public-key-material "$(echo "$pub_key" | base64)" \
                --region "$REGION" --output text >/dev/null
        fi
        ok "Using existing key pair: $KEY_FILE"
    else
        info "Creating new key pair..."
        aws ec2 create-key-pair --key-name "$KEY_NAME" \
            --query "KeyMaterial" --output text --region "$REGION" > "$KEY_FILE"
        chmod 600 "$KEY_FILE"
        ok "Key pair saved: $KEY_FILE"
    fi

    # 4. User data script — install Docker on first boot
    local user_data
    user_data=$(cat <<'USERDATA'
#!/bin/bash
set -e

# Install Docker
dnf update -y
dnf install -y docker git
systemctl enable docker
systemctl start docker

# Install Docker Compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)
curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Add ec2-user to docker group
usermod -aG docker ec2-user

# Signal that setup is complete
touch /home/ec2-user/.docker-ready
USERDATA
)

    # 5. Launch instance
    info "Launching $INSTANCE_TYPE instance..."
    local instance_id
    instance_id=$(aws ec2 run-instances \
        --image-id "$ami_id" \
        --instance-type "$INSTANCE_TYPE" \
        --key-name "$KEY_NAME" \
        --security-group-ids "$sg_id" \
        --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$VOLUME_SIZE,VolumeType=gp3}" \
        --user-data "$user_data" \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=jwst-staging},{Key=Project,Value=$PROJECT_TAG}]" \
        --query "Instances[0].InstanceId" --output text --region "$REGION")

    ok "Instance launched: $instance_id"

    info "Waiting for instance to be running..."
    aws ec2 wait instance-running --instance-ids "$instance_id" --region "$REGION"
    ok "Instance is running"

    # 6. Elastic IP
    info "Allocating Elastic IP..."
    local eip_json eip_alloc eip_ip
    eip_json=$(aws ec2 allocate-address --domain vpc --region "$REGION" \
        --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Project,Value=$PROJECT_TAG}]")
    eip_alloc=$(echo "$eip_json" | jq -r '.AllocationId')
    eip_ip=$(echo "$eip_json" | jq -r '.PublicIp')

    aws ec2 associate-address --instance-id "$instance_id" \
        --allocation-id "$eip_alloc" --region "$REGION" --output text >/dev/null
    ok "Elastic IP: $eip_ip"

    # --- Summary --------------------------------------------------------------
    echo ""
    echo "========================================"
    echo "  JWST Staging Server Provisioned"
    echo "========================================"
    echo ""
    echo "  Instance:  $instance_id"
    echo "  Region:    $REGION"
    echo "  Type:      $INSTANCE_TYPE"
    echo "  Public IP: $eip_ip"
    echo ""
    echo "  SSH (wait ~2 min for user-data to complete):"
    echo "    ssh -i $KEY_FILE ec2-user@$eip_ip"
    echo ""
    echo "  Next steps:"
    echo "    1. Wait for Docker install to finish (~2 min)"
    echo "    2. SSH in and run the server setup script:"
    echo "       scp -i $KEY_FILE scripts/server-setup.sh ec2-user@$eip_ip:~/"
    echo "       ssh -i $KEY_FILE ec2-user@$eip_ip"
    echo "       chmod +x server-setup.sh && ./server-setup.sh"
    echo ""
    echo "    3. Access the app: http://$eip_ip"
    echo ""
    echo "  Estimated cost: ~\$30/mo (t3.medium) + \$3.65/mo (EIP when attached)"
    echo "  Teardown: ./scripts/deploy-aws.sh teardown"
    echo "========================================"
}

# --- Main ---------------------------------------------------------------------
case "${1:-}" in
    teardown) teardown ;;
    status)   status ;;
    *)        provision ;;
esac
