# A small alarm set on an SNS topic (e-mail subscription optional):
# API health and errors at the ALB, API/worker CPU and memory (ECS service
# metrics, no Container Insights), RDS storage, memory, CPU and connections.

resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
  tags = {
    Component = "monitoring"
  }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alb_dimensions = { LoadBalancer = aws_lb.main.arn_suffix }
  tg_dimensions  = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  db_dimensions  = { DBInstanceIdentifier = aws_db_instance.main.identifier }

  alarms = {
    api-unhealthy = {
      description = "No healthy API task behind the ALB"
      namespace   = "AWS/ApplicationELB"
      metric      = "HealthyHostCount"
      stat        = "Minimum"
      comparison  = "LessThanThreshold"
      threshold   = 1
      periods     = 3
      dimensions  = local.tg_dimensions
    }
    api-5xx = {
      description = "API answered 5xx more than 10 times in 5 minutes"
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_Target_5XX_Count"
      stat        = "Sum"
      comparison  = "GreaterThanThreshold"
      threshold   = 10
      periods     = 1
      dimensions  = local.tg_dimensions
    }
    alb-5xx = {
      description = "ALB itself answered 5xx (no target / timeout) more than 10 times in 5 minutes"
      namespace   = "AWS/ApplicationELB"
      metric      = "HTTPCode_ELB_5XX_Count"
      stat        = "Sum"
      comparison  = "GreaterThanThreshold"
      threshold   = 10
      periods     = 1
      dimensions  = local.alb_dimensions
    }
    api-cpu = {
      description = "API service CPU above 85% for 15 minutes"
      namespace   = "AWS/ECS"
      metric      = "CPUUtilization"
      stat        = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 85
      periods     = 3
      dimensions  = { ClusterName = aws_ecs_cluster.main.name, ServiceName = "api" }
    }
    api-memory = {
      description = "API service memory above 85% for 15 minutes"
      namespace   = "AWS/ECS"
      metric      = "MemoryUtilization"
      stat        = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 85
      periods     = 3
      dimensions  = { ClusterName = aws_ecs_cluster.main.name, ServiceName = "api" }
    }
    worker-memory = {
      description = "Worker service memory above 85% for 15 minutes"
      namespace   = "AWS/ECS"
      metric      = "MemoryUtilization"
      stat        = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 85
      periods     = 3
      dimensions  = { ClusterName = aws_ecs_cluster.main.name, ServiceName = "worker" }
    }
    db-storage = {
      description = "RDS free storage below 4 GB"
      namespace   = "AWS/RDS"
      metric      = "FreeStorageSpace"
      stat        = "Minimum"
      comparison  = "LessThanThreshold"
      threshold   = 4294967296
      periods     = 1
      dimensions  = local.db_dimensions
    }
    db-memory = {
      description = "RDS freeable memory below 100 MB"
      namespace   = "AWS/RDS"
      metric      = "FreeableMemory"
      stat        = "Minimum"
      comparison  = "LessThanThreshold"
      threshold   = 104857600
      periods     = 3
      dimensions  = local.db_dimensions
    }
    db-cpu = {
      description = "RDS CPU above 80% for 15 minutes"
      namespace   = "AWS/RDS"
      metric      = "CPUUtilization"
      stat        = "Average"
      comparison  = "GreaterThanThreshold"
      threshold   = 80
      periods     = 3
      dimensions  = local.db_dimensions
    }
    db-connections = {
      description = "RDS connections above 60 (db.t4g.micro allows about 80)"
      namespace   = "AWS/RDS"
      metric      = "DatabaseConnections"
      stat        = "Maximum"
      comparison  = "GreaterThanThreshold"
      threshold   = 60
      periods     = 2
      dimensions  = local.db_dimensions
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "main" {
  for_each = local.alarms

  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  comparison_operator = each.value.comparison
  threshold           = each.value.threshold
  evaluation_periods  = each.value.periods
  period              = 300
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  # The services sit at 0 tasks until the first image; no alarm actions then.
  actions_enabled = var.services_enabled
  alarm_actions   = [aws_sns_topic.alarms.arn]
  ok_actions      = [aws_sns_topic.alarms.arn]

  tags = {
    Component = "monitoring"
  }
}
