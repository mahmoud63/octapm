################################
# ACM Certificate — must be in us-east-1 for CloudFront
################################
resource "aws_acm_certificate" "main" {
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle { create_before_destroy = true }

  tags = { Name = "${var.app_name}-cert" }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "main" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

################################
# CloudFront OAC (Origin Access Control) for S3
################################
resource "aws_cloudfront_origin_access_control" "spa" {
  name                              = "${var.app_name}-spa-oac"
  description                       = "OAC for SPA S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

################################
# CloudFront Distribution
# - Origin 1: S3 SPA (default /**)
# - Origin 2: EC2 API (/api/*)
################################
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.domain_name]
  price_class         = "PriceClass_100"  # US/EU/ME edge nodes only (cheapest)
  comment             = "${var.app_name} ${var.environment}"

  # ── Origin 1: React SPA from S3 ──────────────────────────────
  origin {
    origin_id                = "spa-s3"
    domain_name              = aws_s3_bucket.spa.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.spa.id
  }

  # ── Origin 2: API from EC2 (no ALB — saves ~$18/mo) ──────────
  origin {
    origin_id   = "api-ec2"
    domain_name = aws_eip.app.public_dns

    custom_origin_config {
      http_port              = 5000
      https_port             = 443
      origin_protocol_policy = "http-only"  # EC2 speaks HTTP; CloudFront terminates TLS
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Shared secret header so EC2 can reject direct requests
    custom_header {
      name  = "X-CloudFront-Secret"
      value = var.jwt_secret  # reuse JWT_SECRET as CF shared secret
    }
  }

  # ── Cache Behavior: /api/* → EC2 ─────────────────────────────
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "api-ec2"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # CachingDisabled managed policy
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"  # AllViewer managed policy
  }

  # ── Default Cache Behavior: /* → S3 SPA ──────────────────────
  default_cache_behavior {
    target_origin_id       = "spa-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"  # CachingOptimized managed policy
  }

  # ── SPA fallback: 403/404 → index.html (React Router) ────────
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.main.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Name = "${var.app_name}-cf" }
}
