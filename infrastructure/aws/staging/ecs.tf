# ECS cluster with two Fargate services from one image:
#   api     node src/index.js   1 task, 0.5 vCPU / 1 GB, behind the ALB
#   worker  node src/worker.js  1 task, 0.25 vCPU / 0.5 GB, jobs + scheduler leadership
# Both run in the public subnets with public IPs (no NAT gateway); inbound to
# the API only from the ALB, none to the worker. Secrets come from Secrets
# Manager through `secrets` (never plaintext). The one-off migration task
# (`npx prisma migrate deploy`) runs from the worker definition with a command
# override in the deploy phase.

locals {
  image = "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
  urls  = { for s in local.surfaces : s => "https://${aws_cloudfront_distribution.surface[s].domain_name}" }

  common_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "APP_ENV", value = "staging" },
    { name = "PORT", value = "5000" },
    # CloudFront then ALB: two trusted hops, with the origin secret.
    { name = "TRUST_PROXY_HOPS", value = "2" },
    { name = "WEB_APP_URL", value = local.urls["app"] },
    { name = "PORTAL_URL", value = local.urls["portal"] },
    { name = "ADMIN_URL", value = local.urls["admin"] },
    # Same-origin API: OAuth / SSO redirect URIs on the app host.
    { name = "API_BASE_URL", value = local.urls["app"] },
    { name = "CORS_ALLOWED_ORIGINS", value = join(",", local.surface_origins) },
    { name = "FILE_STORAGE_S3_BUCKET", value = aws_s3_bucket.uploads.bucket },
    { name = "FILE_STORAGE_S3_REGION", value = var.region },
    { name = "AWS_REGION", value = var.region },
    { name = "EMAIL_PROVIDER", value = "ses" },
    { name = "SES_REGION", value = var.region },
    { name = "EMAIL_FROM", value = var.email_from_address == "" ? "OctaPM Staging <set-email-from-address@invalid.example>" : "OctaPM Staging <${var.email_from_address}>" },
    { name = "REALTIME_ADAPTER", value = "postgres" },
    { name = "RATE_LIMIT_STORE", value = "postgres" },
    { name = "AUTH_THROTTLE_STORE", value = "postgres" },
    { name = "SHUTDOWN_TIMEOUT_MS", value = "25000" },
  ]

  common_secrets = concat(
    [for k in local.generated_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.generated.arn}:${k}::" }],
    [for k in local.manual_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.manual.arn}:${k}::" }],
  )
}

resource "aws_ecs_cluster" "main" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
  tags = {
    Component = "ecs"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/octapm/staging/api"
  retention_in_days = var.log_retention_days
  tags = {
    Component = "api"
  }
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/octapm/staging/migrate"
  retention_in_days = var.log_retention_days
  tags = {
    Component = "database-migrations"
  }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/octapm/staging/worker"
  retention_in_days = var.log_retention_days
  tags = {
    Component = "worker"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = local.image
      essential    = true
      command      = ["node", "src/index.js"]
      portMappings = [{ containerPort = 5000, protocol = "tcp" }]
      environment = concat(local.common_environment, [
        { name = "SCHEDULERS_ENABLED", value = "false" },
        { name = "JOB_WORKER_ENABLED", value = "false" },
        { name = "DATABASE_CONNECTION_LIMIT", value = "10" },
      ])
      secrets     = local.common_secrets
      stopTimeout = 30
      healthCheck = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:5000/api/health/live',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])

  tags = {
    Component = "api"
  }
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = local.image
      essential = true
      command   = ["node", "src/worker.js"]
      environment = concat(local.common_environment, [
        { name = "SCHEDULERS_ENABLED", value = "true" },
        { name = "JOB_WORKER_ENABLED", value = "true" },
        { name = "DATABASE_CONNECTION_LIMIT", value = "5" },
      ])
      secrets     = local.common_secrets
      stopTimeout = 30
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])

  tags = {
    Component = "worker"
  }
}

# One-off migration task: the same image, `npx --no prisma migrate deploy`, with
# DATABASE_URL as its only secret (the CLI never boots the application, so it
# needs none of the others). Run by the deploy workflow before the services
# roll; the services do not roll if it fails. Never `migrate reset` or `db push`.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name        = "migrate"
      image       = local.image
      essential   = true
      command     = ["npx", "--no", "prisma", "migrate", "deploy"]
      environment = [{ name = "NODE_ENV", value = "production" }, { name = "APP_ENV", value = "staging" }]
      secrets     = [{ name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.generated.arn}:DATABASE_URL::" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.migrate.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "migrate"
        }
      }
    }
  ])

  tags = {
    Component = "database-migrations"
  }
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.services_enabled ? 1 : 0
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 90
  enable_execute_command            = false
  propagate_tags                    = "SERVICE"

  # Rolling replacement with no gap: the new task is healthy before the old stops.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 5000
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront]

  # The deploy workflow registers SHA-tagged task definition revisions and sets
  # the task count (0 until the application can boot, then 1). Terraform
  # creates the service and owns everything else about it.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = {
    Component = "api"
  }
}

resource "aws_ecs_service" "worker" {
  name                   = "worker"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.worker.arn
  desired_count          = var.services_enabled ? 1 : 0
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"

  # Stop the old worker before starting the new one (scheduler leadership is
  # also lock-guarded, so an overlap would be safe, just pointless).
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = true
  }

  # The deploy workflow registers SHA-tagged task definition revisions and sets
  # the task count (0 until the application can boot, then 1). Terraform
  # creates the service and owns everything else about it.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = {
    Component = "worker"
  }
}
