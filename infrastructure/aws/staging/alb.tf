# Public ALB, reachable only from CloudFront's origin-facing addresses (security
# group) and only with the CloudFront origin secret (listener rule; the API's
# own guard checks the same header). Anything else gets 403 at the ALB.

resource "aws_lb" "main" {
  name                       = "${var.name}-alb"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  idle_timeout               = 60
  drop_invalid_header_fields = true
  enable_deletion_protection = false
  tags = {
    Component = "load-balancer"
  }
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.name}-api"
  port                 = 5000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    path                = "/api/health/live"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Component = "api"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  condition {
    http_header {
      http_header_name = "X-CloudFront-Secret"
      values           = [random_password.app["CLOUDFRONT_SHARED_SECRET"].result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
