# Two Secrets Manager secrets, injected into the tasks by ECS (never plaintext
# in a task definition):
#
#   octapm/staging/generated  Terraform generates every value: the database
#                             URL (with its password), the signing and
#                             encryption keys, the CloudFront origin secret.
#                             Nothing is read from a local .env.
#   octapm/staging/manual     Values only the owner has (Anthropic key, Stripe
#                             test-mode values). Created with CHANGE_ME
#                             placeholders, which the API's boot validation
#                             refuses by name; the owner replaces them in the
#                             console. Terraform never overwrites them again.
#
# Generated values live in the encrypted, versioned remote state.

locals {
  # The CA path inside the image (backend/Dockerfile); Prisma verifies the server
  # only with sslmode=require + sslcert + sslaccept=strict.
  database_url = "postgresql://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=require&sslcert=/app/certs/rds-ca.pem&sslaccept=strict"

  generated_keys = ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET", "MFA_SECRET_KEY", "INTEGRATION_SECRET_KEY", "CLOUDFRONT_SHARED_SECRET"]
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

resource "aws_secretsmanager_secret" "manual" {
  name                    = "octapm/staging/manual"
  description             = "OctaPM staging: values the owner enters by hand (Anthropic key, Stripe test-mode values)"
  recovery_window_in_days = 7
  tags = {
    Component = "secrets"
  }
}

resource "aws_secretsmanager_secret_version" "manual" {
  secret_id     = aws_secretsmanager_secret.manual.id
  secret_string = jsonencode({ for k in local.manual_keys : k => "CHANGE_ME" })

  # The owner's values are entered in the console; never reverted by a later apply.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
