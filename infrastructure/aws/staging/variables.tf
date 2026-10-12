variable "region" {
  description = "Workload region of OctaPM Staging."
  type        = string
  default     = "us-east-1"
}

variable "account_id" {
  description = "The OctaPM Staging AWS account (provider allowed_account_ids)."
  type        = string
  default     = "977476317319"
}

variable "name" {
  description = "Name prefix of every staging resource."
  type        = string
  default     = "octapm-staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "image_tag" {
  description = "The backend image tag in ECR (the 40-character git commit the image was built from)."
  type        = string
  default     = "not-built-yet"
}

variable "services_enabled" {
  description = <<-EOT
    Run the API and worker services (1 task each). Kept false at the first
    apply: the ECR repository is empty until the deploy phase pushes the first
    image, and the manual secrets are not filled in yet. The deploy phase sets
    it true together with image_tag.
  EOT
  type        = bool
  default     = false
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL major version (the CI image proves every migration on PostgreSQL 16)."
  type        = string
  default     = "16"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "email_from_address" {
  description = <<-EOT
    The SES sender address for staging mail (e.g. a mailbox the owner controls).
    Empty: no SES identity is created yet. Creating one makes SES send a
    verification e-mail to that address. SES is in the sandbox: every
    recipient must be verified too.
  EOT
  type        = string
  default     = ""
}

variable "alarm_email" {
  description = "Optional e-mail subscribed to the staging alarm topic (AWS sends a confirmation link)."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  type    = number
  default = 14
}
