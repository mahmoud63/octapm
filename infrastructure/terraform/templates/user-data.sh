#!/bin/bash
set -euo pipefail

exec > >(tee /var/log/pmcopilots-user-data.log | logger -t pmcopilots-user-data -s 2>/dev/console) 2>&1

APP_NAME="${app_name}"
AWS_REGION="${aws_region}"
DB_HOST="${db_host}"
DB_NAME="${db_name}"
DB_USER="${db_user}"
S3_UPLOADS_BUCKET="${s3_uploads}"
SECRET_ARN="${secret_arn}"
APP_DIR="/opt/pmcopilots"

echo "Starting $APP_NAME EC2 bootstrap at $(date -Is)"

dnf update -y
dnf install -y awscli curl git jq python3 tar gzip

NODE_MAJOR=24
NPM_VERSION=11.9.0

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq "^v$NODE_MAJOR\\."; then
  curl -fsSL "https://rpm.nodesource.com/setup_$NODE_MAJOR.x" | bash -
  dnf install -y nodejs
fi

if ! npm --version | grep -Eq '^11\.'; then
  npm install -g "npm@$NPM_VERSION"
fi

node --version | grep -Eq "^v$NODE_MAJOR\\."
npm --version | grep -Eq '^11\.'
npm install -g pm2

mkdir -p "$APP_DIR" /etc/pmcopilots
chown ec2-user:ec2-user "$APP_DIR"
chmod 0755 "$APP_DIR"

cat >/etc/pmcopilots/bootstrap.env <<BOOTSTRAP_ENV
APP_NAME=$APP_NAME
AWS_REGION=$AWS_REGION
DB_HOST=$DB_HOST
DB_NAME=$DB_NAME
DB_USER=$DB_USER
S3_UPLOADS_BUCKET=$S3_UPLOADS_BUCKET
SECRET_ARN=$SECRET_ARN
APP_DIR=$APP_DIR
BOOTSTRAP_ENV

chown root:ec2-user /etc/pmcopilots/bootstrap.env
chmod 0640 /etc/pmcopilots/bootstrap.env

pm2 startup systemd -u ec2-user --hp /home/ec2-user || true

echo "$APP_NAME EC2 bootstrap completed at $(date -Is)"
