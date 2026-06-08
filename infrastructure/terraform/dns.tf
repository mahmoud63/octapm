################################
# Route53 Hosted Zone
################################
resource "aws_route53_zone" "main" {
  name = var.domain_name

  tags = { Name = "${var.app_name}-zone" }
}

################################
# A record: domain → CloudFront
################################
resource "aws_route53_record" "root" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

################################
# A record: api.domain → EC2 Elastic IP (direct SSH/deploy access)
# API traffic still flows via CloudFront /api/* path for TLS + CDN
################################
resource "aws_route53_record" "api_direct" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${var.api_subdomain}.${var.domain_name}"
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
