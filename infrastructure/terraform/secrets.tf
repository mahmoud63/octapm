################################
# Secrets Manager — all app secrets in one secret
################################
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.app_name}/${var.environment}/app-secrets"
  description             = "PMcopilots application secrets"
  recovery_window_in_days = 7

  tags = { Name = "${var.app_name}-secrets" }
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    JWT_SECRET               = var.jwt_secret
    JWT_REFRESH_SECRET       = var.jwt_refresh_secret
    ANTHROPIC_API_KEY        = var.anthropic_api_key
    DB_PASSWORD              = var.db_password
    CLOUDFRONT_SHARED_SECRET = var.cloudfront_origin_secret
  })
}
