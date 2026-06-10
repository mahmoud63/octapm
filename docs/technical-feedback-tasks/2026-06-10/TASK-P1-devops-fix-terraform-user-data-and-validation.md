# TASK-P1-devops-fix-terraform-user-data-and-validation

## Summary

Resolved F-026 by adding the missing EC2 bootstrap template and moving encoded Terraform EC2 bootstrap content from `user_data` to `user_data_base64`.

## Implementation

- Added `infrastructure/terraform/templates/user-data.sh` to bootstrap Amazon Linux 2023 with AWS CLI, Git, Python, Node.js 20, PM2, and non-sensitive deployment metadata.
- Updated `infrastructure/terraform/compute.tf` so the rendered template is assigned to `user_data_base64`.
- Added `infrastructure/scripts/validate-ec2-user-data.mjs` with positive and negative coverage for encoded `user_data`, conflicting user-data fields, and missing template references.
- Added EC2 user-data validation and `terraform validate -no-color` to the `Quality Gates / Infrastructure - security and resilience validation` job.

## Validation

- `node infrastructure/scripts/validate-ec2-user-data.mjs --self-test`
- `node infrastructure/scripts/validate-ec2-user-data.mjs`
- `terraform init -backend=false`
- `terraform validate -no-color`

## Manual QA

- Review `terraform plan` before apply and confirm EC2 user data is rendered through `user_data_base64` without secret values.
- After replacement-instance provisioning, inspect `/var/log/cloud-init-output.log` or `/var/log/pmcopilots-user-data.log` and confirm bootstrap completion.
- SSH as `ec2-user` and confirm `node --version` is v20, `aws --version` works, `pm2 --version` works, and `/etc/pmcopilots/bootstrap.env` contains only non-sensitive metadata plus the Secrets Manager ARN.
