variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "us-east-2"
}

variable "app_name" {
  description = "Application name used for resource naming"
  type        = string
  default     = "pmcopilots"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Primary domain (e.g. pmcopilots.com)"
  type        = string
}

variable "api_subdomain" {
  description = "Deprecated compatibility variable. Direct API DNS is disabled; API traffic must use the primary domain /api/* CloudFront path."
  type        = string
  default     = "api"
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "pmcopilots"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "pmcopilots"
}

variable "db_password" {
  description = "PostgreSQL master password — set via TF_VAR_db_password env var"
  type        = string
  sensitive   = true
}

variable "rds_backup_retention_days" {
  description = "RDS automated backup retention in days. Production must retain at least seven days; AWS allows up to 35 days."
  type        = number
  default     = 7

  validation {
    condition     = var.rds_backup_retention_days >= 7 && var.rds_backup_retention_days <= 35
    error_message = "rds_backup_retention_days must be between 7 and 35 so production backups cannot be disabled."
  }
}

variable "rds_backup_window" {
  description = "Preferred UTC window for RDS automated backups."
  type        = string
  default     = "02:00-03:00"
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ RDS deployment. Production must keep this enabled for release readiness."
  type        = bool
  default     = true
}

variable "rds_recovery_rpo_hours" {
  description = "Documented production recovery point objective in hours for release readiness evidence."
  type        = number
  default     = 24

  validation {
    condition     = var.rds_recovery_rpo_hours > 0 && var.rds_recovery_rpo_hours <= 24
    error_message = "rds_recovery_rpo_hours must be greater than 0 and no more than 24."
  }
}

variable "rds_recovery_rto_hours" {
  description = "Documented production recovery time objective in hours for release readiness evidence."
  type        = number
  default     = 4

  validation {
    condition     = var.rds_recovery_rto_hours > 0 && var.rds_recovery_rto_hours <= 24
    error_message = "rds_recovery_rto_hours must be greater than 0 and no more than 24."
  }
}

variable "upload_document_retention_days" {
  description = "Retention period for private project document uploads before S3 lifecycle expiration."
  type        = number
  default     = 2555

  validation {
    condition     = var.upload_document_retention_days >= 365
    error_message = "upload_document_retention_days must retain project documents for at least one year."
  }
}

variable "upload_document_noncurrent_retention_days" {
  description = "Retention period for noncurrent private upload object versions."
  type        = number
  default     = 365

  validation {
    condition     = var.upload_document_noncurrent_retention_days >= 90
    error_message = "upload_document_noncurrent_retention_days must retain noncurrent upload versions for at least 90 days."
  }
}

variable "anthropic_api_key" {
  description = "Anthropic API key — set via TF_VAR_anthropic_api_key env var"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT access token secret — set via TF_VAR_jwt_secret env var"
  type        = string
  sensitive   = true
}

variable "jwt_refresh_secret" {
  description = "JWT refresh token secret — set via TF_VAR_jwt_refresh_secret env var"
  type        = string
  sensitive   = true
}

variable "cloudfront_origin_secret" {
  description = "Dedicated CloudFront-to-origin shared secret — set via TF_VAR_cloudfront_origin_secret env var; do not reuse JWT material"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.cloudfront_origin_secret) >= 32 && var.cloudfront_origin_secret != "CHANGE_ME"
    error_message = "cloudfront_origin_secret must be a dedicated non-placeholder value at least 32 characters long."
  }
}

variable "ssh_public_key" {
  description = "SSH public key for EC2 instance access"
  type        = string
}

variable "your_ip_cidr" {
  description = "Your IP CIDR for SSH access (e.g. 1.2.3.4/32)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo allowed to assume deploy role via OIDC (e.g. myorg/pmcopilots)"
  type        = string
}

variable "alarm_notification_email" {
  description = "Email endpoint subscribed to the CloudWatch alarm SNS topic. Required for production."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.alarm_notification_email) == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_notification_email))
    error_message = "alarm_notification_email must be empty or a valid email address."
  }
}


