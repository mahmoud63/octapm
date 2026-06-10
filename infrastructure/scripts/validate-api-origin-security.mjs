import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const terraformDir = resolve(repoRoot, 'infrastructure', 'terraform')

function extractBlock(source, headerPattern) {
  const match = headerPattern.exec(source)
  if (!match) {
    return null
  }

  const openIndex = source.indexOf('{', match.index)
  if (openIndex === -1) {
    throw new Error(`Terraform block matching ${headerPattern} has no body`)
  }

  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      return source.slice(openIndex + 1, index)
    }
  }

  throw new Error(`Terraform block matching ${headerPattern} is not closed`)
}

function extractNestedBlocks(source, blockName) {
  const blocks = []
  const pattern = new RegExp(`\\b${blockName}\\s*\\{`, 'g')

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const openIndex = source.indexOf('{', match.index)
    let depth = 0

    for (let index = openIndex; index < source.length; index += 1) {
      const char = source[index]
      if (char === '{') depth += 1
      if (char === '}') depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(openIndex + 1, index))
        pattern.lastIndex = index + 1
        break
      }
    }
  }

  return blocks
}

function hasApiPort(block) {
  return /from_port\s*=\s*5000/.test(block) && /to_port\s*=\s*5000/.test(block)
}

function validateApiOriginSecurity({ networkingSource, cdnSource, dnsSource, secretsSource }) {
  const failures = []

  const cloudfrontPrefixList = extractBlock(
    networkingSource,
    /data\s+"aws_ec2_managed_prefix_list"\s+"cloudfront_origin_facing"\s*\{/m,
  )
  if (!cloudfrontPrefixList) {
    failures.push('EC2 API origin must use the AWS-managed CloudFront origin-facing prefix list.')
  } else if (!/name\s*=\s*"com\.amazonaws\.global\.cloudfront\.origin-facing"/.test(cloudfrontPrefixList)) {
    failures.push('CloudFront origin-facing prefix list must use the AWS-managed origin-facing list name.')
  }

  const ec2SecurityGroup = extractBlock(
    networkingSource,
    /resource\s+"aws_security_group"\s+"ec2"\s*\{/m,
  )
  if (!ec2SecurityGroup) {
    failures.push('EC2 security group must be present so API ingress can be locked down.')
  } else {
    const apiIngressRules = extractNestedBlocks(ec2SecurityGroup, 'ingress').filter(hasApiPort)
    if (apiIngressRules.length === 0) {
      failures.push('EC2 security group must define an explicit API ingress rule for port 5000.')
    }

    for (const rule of apiIngressRules) {
      if (/cidr_blocks\s*=\s*\[[^\]]*"0\.0\.0\.0\/0"/s.test(rule)) {
        failures.push('EC2 API port 5000 must not be open to 0.0.0.0/0.')
        break
      }
    }

    const hasLockedCloudFrontIngress = apiIngressRules.some((rule) => (
      /prefix_list_ids\s*=\s*\[[^\]]*data\.aws_ec2_managed_prefix_list\.cloudfront_origin_facing\.id/s.test(rule)
    ))
    if (!hasLockedCloudFrontIngress) {
      failures.push('EC2 API port 5000 must allow only the CloudFront origin-facing prefix list.')
    }
  }

  if (/resource\s+"aws_route53_record"\s+"api_direct"\s*\{/.test(dnsSource)) {
    failures.push('Route53 must not publish a direct api subdomain to the EC2 origin.')
  }
  if (/records\s*=\s*\[\s*aws_eip\.app\.public_ip\s*\]/.test(dnsSource)) {
    failures.push('Route53 records must not expose the EC2 API Elastic IP directly.')
  }

  if (!/origin_id\s*=\s*"api-ec2"/.test(cdnSource)) {
    failures.push('CloudFront distribution must define the API origin.')
  } else if (!/origin\s*\{[\s\S]*origin_id\s*=\s*"api-ec2"[\s\S]*custom_header\s*\{[\s\S]*name\s*=\s*"X-CloudFront-Secret"[\s\S]*value\s*=\s*var\.cloudfront_origin_secret[\s\S]*\}/m.test(cdnSource)) {
    failures.push('CloudFront API origin must send a dedicated cloudfront_origin_secret header.')
  }

  if (/X-CloudFront-Secret[\s\S]{0,200}value\s*=\s*var\.jwt_secret/.test(cdnSource)) {
    failures.push('CloudFront origin header must not reuse jwt_secret.')
  }
  if (/CLOUDFRONT_SHARED_SECRET\s*=\s*var\.jwt_secret/.test(secretsSource)) {
    failures.push('Runtime CloudFront shared secret must not reuse jwt_secret.')
  }
  if (/CLOUDFRONT_SHARED_SECRET\s*=\s*var\.jwt_refresh_secret/.test(secretsSource)) {
    failures.push('Runtime CloudFront shared secret must not reuse jwt_refresh_secret.')
  }

  return failures
}

function runSelfTest() {
  const badNetworking = `
resource "aws_security_group" "ec2" {
  ingress {
    from_port   = 5000
    to_port     = 5000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`
  const badCdn = `
resource "aws_cloudfront_distribution" "main" {
  origin {
    origin_id = "api-ec2"
    custom_header {
      name  = "X-CloudFront-Secret"
      value = var.jwt_secret
    }
  }
}
`
  const badDns = `
resource "aws_route53_record" "api_direct" {
  records = [aws_eip.app.public_ip]
}
`
  const badSecrets = 'CLOUDFRONT_SHARED_SECRET = var.jwt_secret'
  const badFailures = validateApiOriginSecurity({
    networkingSource: badNetworking,
    cdnSource: badCdn,
    dnsSource: badDns,
    secretsSource: badSecrets,
  })
  if (badFailures.length < 5) {
    throw new Error('Self-test expected unsafe API origin policy to fail.')
  }

  const goodNetworking = `
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "ec2" {
  ingress {
    from_port       = 5000
    to_port         = 5000
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id]
  }
}
`
  const goodCdn = `
resource "aws_cloudfront_distribution" "main" {
  origin {
    origin_id = "api-ec2"
    custom_header {
      name  = "X-CloudFront-Secret"
      value = var.cloudfront_origin_secret
    }
  }
}
`
  const goodFailures = validateApiOriginSecurity({
    networkingSource: goodNetworking,
    cdnSource: goodCdn,
    dnsSource: '',
    secretsSource: 'CLOUDFRONT_SHARED_SECRET = var.cloudfront_origin_secret',
  })
  if (goodFailures.length > 0) {
    throw new Error(`Self-test expected compliant API origin policy to pass: ${goodFailures.join('; ')}`)
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('API origin security validation self-test passed.')
  process.exit(0)
}

const failures = validateApiOriginSecurity({
  networkingSource: readFileSync(resolve(terraformDir, 'networking.tf'), 'utf8'),
  cdnSource: readFileSync(resolve(terraformDir, 'cdn.tf'), 'utf8'),
  dnsSource: readFileSync(resolve(terraformDir, 'dns.tf'), 'utf8'),
  secretsSource: readFileSync(resolve(terraformDir, 'secrets.tf'), 'utf8'),
})

if (failures.length > 0) {
  console.error('API origin security validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('API origin security validation passed.')

export { validateApiOriginSecurity }
