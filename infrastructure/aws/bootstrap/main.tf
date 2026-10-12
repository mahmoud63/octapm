# OctaPM staging — Terraform remote-state bootstrap.
#
# Creates the one bucket the staging stack keeps its state in: private,
# encrypted, versioned, TLS-only. Locking uses S3's native lock file
# (backend "s3" use_lockfile = true, Terraform >= 1.10), so no DynamoDB table.
#
# Applied once, before the staging stack's first `terraform init`. Its own
# (tiny) state stays local in this folder (gitignored); it can be migrated into
# the bucket afterwards (key bootstrap/terraform.tfstate) — see ../README.md.

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  # Refuses to run against any account but OctaPM Staging.
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project     = "OctaPM"
      Environment = "Staging"
      ManagedBy   = "Terraform"
      Component   = "terraform-state"
      Repository  = "mahmoud63/octapm"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_id" {
  description = "The OctaPM Staging AWS account."
  type        = string
  default     = "977476317319"
}

locals {
  bucket = "octapm-staging-tfstate-${var.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "state" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  policy     = data.aws_iam_policy_document.state.json
  depends_on = [aws_s3_bucket_public_access_block.state]
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}
