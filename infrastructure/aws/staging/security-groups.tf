# Internet → CloudFront → ALB (port 80, CloudFront's origin-facing addresses
# only, plus the X-CloudFront-Secret header the listener and the API check)
# → API tasks (5000, from the ALB only) → RDS (5432, from the tasks only).
# PostgreSQL is never reachable from 0.0.0.0/0.

data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "OctaPM staging ALB: HTTP from CloudFront origin-facing addresses only"
  vpc_id      = aws_vpc.main.id
  tags = {
    Name      = "${var.name}-alb"
    Component = "load-balancer"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from CloudFront origin-facing servers"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5000
  to_port                      = 5000
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_security_group" "api" {
  name        = "${var.name}-api"
  description = "OctaPM staging API tasks: 5000 from the ALB only"
  vpc_id      = aws_vpc.main.id
  tags = {
    Name      = "${var.name}-api"
    Component = "api"
  }
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "Application port from the ALB"
  ip_protocol                  = "tcp"
  from_port                    = 5000
  to_port                      = 5000
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS out: ECR, Secrets Manager, CloudWatch, S3, SES, Anthropic"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "api_to_db" {
  security_group_id            = aws_security_group.api.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.db.id
}

resource "aws_security_group" "worker" {
  name        = "${var.name}-worker"
  description = "OctaPM staging worker tasks: no inbound"
  vpc_id      = aws_vpc.main.id
  tags = {
    Name      = "${var.name}-worker"
    Component = "worker"
  }
}

resource "aws_vpc_security_group_egress_rule" "worker_https" {
  security_group_id = aws_security_group.worker.id
  description       = "HTTPS out: ECR, Secrets Manager, CloudWatch, S3, SES, Anthropic"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "worker_to_db" {
  security_group_id            = aws_security_group.worker.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.db.id
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "OctaPM staging RDS: PostgreSQL from the API and worker tasks only"
  vpc_id      = aws_vpc.main.id
  tags = {
    Name      = "${var.name}-db"
    Component = "database"
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_worker" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the worker tasks (and the one-off migration task)"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.worker.id
}
