output "staging_urls" {
  description = "The three staging surfaces (temporary CloudFront hosts; octapm.com DNS untouched)."
  value       = local.urls
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "cloudfront_distribution_ids" {
  value = { for s in local.surfaces : s => aws_cloudfront_distribution.surface[s].id }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "rds_endpoint" {
  description = "Private endpoint; reachable only from the staging tasks."
  value       = aws_db_instance.main.address
}

output "secrets" {
  value = {
    generated = aws_secretsmanager_secret.generated.name
    manual    = aws_secretsmanager_secret.manual.name
  }
}

output "migration_task" {
  description = "Run migrations with this task definition and a command override (deploy phase)."
  value = {
    task_definition = aws_ecs_task_definition.worker.family
    subnets         = aws_subnet.public[*].id
    security_group  = aws_security_group.worker.id
    command         = ["npx", "prisma", "migrate", "deploy"]
  }
}
