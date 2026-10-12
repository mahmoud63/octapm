# Two Secrets Manager secrets, injected into the tasks by ECS (never plaintext
# in a task definition):
#
#   octapm/staging/generated  Terraform generates every value: the database
#                             URL (with its password), the signing and
#                             encryption keys, the CloudFront origin secret.
#                             Nothing is read from a local .env.
#   octapm/staging/manual     Values only the owner has (Anthropic key, Stripe
#                             test-mode values). Terraform creates the secret
#                             CONTAINER only and never manages a version of it:
#                             the owner creates every value in the console (or
#                             the CLI), as one JSON object with exactly the keys
#                             in local.manual_keys. No apply can ever write,
#                             replace or re-label those values. Until the owner
#                             stores them, the tasks cannot start (the services
#                             stay at 0 until the deploy phase anyway).
#
# Why no managed placeholder version: when a value is stored in the console,
# Secrets Manager moves AWSCURRENT to the new version. A Terraform-managed
# placeholder version would then show `version_stages` drift and a later
# apply would move AWSCURRENT back to the placeholder; and if Secrets Manager
# ever removed that unlabelled version, Terraform would re-create it as
# current. Owning no version removes both paths.
#
# Generated values live in the encrypted, versioned remote state.

locals {
  # The CA path inside the image (backend/Dockerfile); Prisma verifies the server
  # only with sslmode=require + sslcert + sslaccept=strict.
  database_url = "postgresql://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=require&sslcert=/app/certs/rds-ca.pem&sslaccept=strict"

  generated_keys = ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET", "MFA_SECRET_KEY", "INTEGRATION_SECRET_KEY", "CLOUDFRONT_SHARED_SECRET"]

  # The JSON keys the owner stores in octapm/staging/manual (ECS reads each one).
  manual_keys = [
    "ANTHROPIC_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_INDIVIDUAL_MONTHLY",
    "STRIPE_PRICE_INDIVIDUAL_ANNUAL",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "STRIPE_PRICE_BUSINESS_ANNUAL",
    "STRIPE_SECRET_ROTATION_CONFIRMED_AT",
    "STRIPE_SECRET_ROTATION_TICKET",
  ]
}

resource "random_password" "app" {
  for_each = toset(["JWT_SECRET", "JWT_REFRESH_SECRET", "MFA_SECRET_KEY", "INTEGRATION_SECRET_KEY", "CLOUDFRONT_SHARED_SECRET"])
  length   = 64
  special  = false
}

resource "aws_secretsmanager_secret" "generated" {
  name                    = "octapm/staging/generated"
  description             = "OctaPM staging: Terraform-generated server secrets (database URL, signing and encryption keys, CloudFront origin secret)"
  recovery_window_in_days = 7
  tags = {
    Component = "secrets"
  }
}

resource "aws_secretsmanager_secret_version" "generated" {
  secret_id = aws_secretsmanager_secret.generated.id
  secret_string = jsonencode(merge(
    { DATABASE_URL = local.database_url },
    { for k, v in random_password.app : k => v.result },
  ))
}

# Container only: the owner stores the value (see the header). Deliberately no
# aws_secretsmanager_secret_version for this secret.
resource "aws_secretsmanager_secret" "manual" {
  name                    = "octapm/staging/manual"
  description             = "OctaPM staging: owner-entered JSON with keys ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_INDIVIDUAL_MONTHLY, STRIPE_PRICE_INDIVIDUAL_ANNUAL, STRIPE_PRICE_BUSINESS_MONTHLY, STRIPE_PRICE_BUSINESS_ANNUAL, STRIPE_SECRET_ROTATION_CONFIRMED_AT, STRIPE_SECRET_ROTATION_TICKET. Terraform never writes its value."
  recovery_window_in_days = 7
  tags = {
    Component = "secrets"
  }
}

output "manual_secret_keys" {
  description = "The JSON keys to store in octapm/staging/manual."
  value       = local.manual_keys
}
