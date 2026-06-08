output "cloudfront_domain" {
  description = "CloudFront distribution domain (CNAME target)"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (used for cache invalidation on deploy)"
  value       = aws_cloudfront_distribution.main.id
}

output "ec2_public_ip" {
  description = "EC2 Elastic IP — SSH target and direct API access"
  value       = aws_eip.app.public_ip
}

output "ec2_instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.app.id
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host only, no port)"
  value       = aws_db_instance.main.address
}

output "rds_port" {
  description = "RDS PostgreSQL port"
  value       = aws_db_instance.main.port
}

output "s3_spa_bucket" {
  description = "S3 bucket for React SPA static files"
  value       = aws_s3_bucket.spa.bucket
}

output "s3_uploads_bucket" {
  description = "S3 bucket for BOQ/P6 file uploads"
  value       = aws_s3_bucket.uploads.bucket
}

output "route53_nameservers" {
  description = "Nameservers to configure at your domain registrar"
  value       = aws_route53_zone.main.name_servers
}

output "secrets_manager_arn" {
  description = "ARN of the Secrets Manager secret holding all app secrets"
  value       = aws_secretsmanager_secret.app.arn
}

output "sns_alarms_topic_arn" {
  description = "SNS topic ARN — subscribe your email to receive CloudWatch alerts"
  value       = aws_sns_topic.alarms.arn
}
