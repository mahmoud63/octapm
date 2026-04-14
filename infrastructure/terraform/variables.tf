variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "me-south-1"
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
  description = "Subdomain for API (e.g. api.pmcopilots.com)"
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

variable "ssh_public_key" {
  description = "SSH public key for EC2 instance access"
  type        = string
}

variable "your_ip_cidr" {
  description = "Your IP CIDR for SSH access (e.g. 1.2.3.4/32)"
  type        = string
}
