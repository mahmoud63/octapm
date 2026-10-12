# Execution role: pull the image, write logs, read the two secrets.
# Task role: the application's own AWS access — the private uploads bucket and
# SES sending. No stored AWS keys anywhere (the API refuses them in production).

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  tags = {
    Component = "ecs"
  }
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.generated.arn, aws_secretsmanager_secret.manual.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-staging-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
  tags = {
    Component = "ecs"
  }
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "ProjectFiles"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:GetObjectAttributes"]
    resources = ["${aws_s3_bucket.uploads.arn}/*"]
  }
  statement {
    sid       = "ProjectFilesList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.uploads.arn]
  }
  statement {
    sid       = "SendStagingMail"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["arn:aws:ses:${var.region}:${var.account_id}:identity/*", "arn:aws:ses:${var.region}:${var.account_id}:configuration-set/*"]
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "octapm-staging-application"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}
