################################
# CloudWatch Log Group — API server
################################
resource "aws_cloudwatch_log_group" "api" {
  name              = "/pmcopilots/api"
  retention_in_days = 30

  tags = { Name = "${var.app_name}-api-logs" }
}

################################
# SNS Topic — alarms notification
################################
resource "aws_sns_topic" "alarms" {
  name = "${var.app_name}-alarms"

  lifecycle {
    precondition {
      condition     = !contains(["prod", "production"], var.environment) || trimspace(var.alarm_notification_email) != ""
      error_message = "TASK-P1-DEVOPS-001 production blocker: alarm_notification_email must be set for production monitoring."
    }
  }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = trimspace(var.alarm_notification_email) == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_notification_email
}

################################
# CloudWatch Alarms (5 core alarms)
################################

# 1. EC2 CPU > 80%
resource "aws_cloudwatch_metric_alarm" "ec2_cpu" {
  alarm_name          = "${var.app_name}-ec2-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "EC2 CPU > 80% for 10 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  dimensions = { InstanceId = aws_instance.app.id }
}

# 2. RDS CPU > 80%
resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${var.app_name}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU > 80% for 10 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = { DBInstanceIdentifier = aws_db_instance.main.id }
}

# 3. RDS free storage < 5GB
resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${var.app_name}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 5368709120  # 5 GB in bytes
  alarm_description   = "RDS free storage < 5 GB"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = { DBInstanceIdentifier = aws_db_instance.main.id }
}

# 4. EC2 StatusCheck failure
resource "aws_cloudwatch_metric_alarm" "ec2_status" {
  alarm_name          = "${var.app_name}-ec2-status-check"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "EC2 instance status check failed"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = { InstanceId = aws_instance.app.id }
}

# 5. CloudFront 5xx error rate > 5%
resource "aws_cloudwatch_metric_alarm" "cf_5xx" {
  alarm_name          = "${var.app_name}-cf-5xx-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = 5
  alarm_description   = "CloudFront 5xx error rate > 5%"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    DistributionId = aws_cloudfront_distribution.main.id
    Region         = "Global"
  }
}
