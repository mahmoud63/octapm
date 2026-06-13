import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const deployWorkflow = resolve(repoRoot, '.github', 'workflows', 'deploy.yml')
const frontendApiClient = resolve(repoRoot, 'frontend', 'src', 'services', 'api', 'client.ts')
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

function requirePattern(failures, label, source, pattern) {
  if (!pattern.test(source ?? '')) {
    failures.push(label)
  }
}

function rejectPattern(failures, label, source, pattern) {
  if (pattern.test(source ?? '')) {
    failures.push(label)
  }
}

export function validateDeploymentReadiness({
  deploySource,
  frontendApiClientSource,
  iamSource,
  databaseSource,
  variablesSource,
  monitoringSource,
}) {
  const failures = []
  const dbInstance = extractBlock(
    databaseSource,
    /resource\s+"aws_db_instance"\s+"main"\s*\{/m,
  )
  const rdsMultiAzVariable = extractBlock(
    variablesSource,
    /variable\s+"rds_multi_az"\s*\{/m,
  )
  const alarmEmailVariable = extractBlock(
    variablesSource,
    /variable\s+"alarm_notification_email"\s*\{/m,
  )
  const alarmsTopic = extractBlock(
    monitoringSource,
    /resource\s+"aws_sns_topic"\s+"alarms"\s*\{/m,
  )
  const alarmEmailSubscription = extractBlock(
    monitoringSource,
    /resource\s+"aws_sns_topic_subscription"\s+"alarm_email"\s*\{/m,
  )
  const ec2Permissions = extractBlock(
    iamSource,
    /data\s+"aws_iam_policy_document"\s+"ec2_permissions"\s*\{/m,
  )
  const githubDeployPermissions = extractBlock(
    iamSource,
    /data\s+"aws_iam_policy_document"\s+"github_actions_deploy_permissions"\s*\{/m,
  )

  rejectPattern(
    failures,
    'Deploy workflow must not hardcode an AWS Secrets Manager ARN.',
    deploySource,
    /arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:/,
  )
  rejectPattern(
    failures,
    'Deploy workflow must not hardcode the production public URL.',
    deploySource,
    /https:\/\/octapm\.com/,
  )
  rejectPattern(
    failures,
    'Deploy workflow must not hardcode the legacy GitHub repository URL.',
    deploySource,
    /github\.com\/mahmoud63\/octapm\.git/,
  )
  rejectPattern(
    failures,
    'Deploy workflow must not hardcode the production RDS endpoint.',
    deploySource,
    /rds\.amazonaws\.com/,
  )
  requirePattern(
    failures,
    'Frontend build must read VITE_API_URL from GitHub Environment vars.',
    deploySource,
    /VITE_API_URL:\s*\$\{\{\s*vars\.VITE_API_URL(?:\s*\|\|\s*secrets\.VITE_API_URL)?\s*\}\}/,
  )
  requirePattern(
    failures,
    'Backend deploy must read the app secret ARN from GitHub Environment vars.',
    deploySource,
    /APP_SECRETS_ARN:\s*\$\{\{\s*vars\.APP_SECRETS_ARN(?:\s*\|\|\s*secrets\.APP_SECRETS_ARN)?\s*\}\}/,
  )
  requirePattern(
    failures,
    'Backend deploy must fetch Secrets Manager values using APP_SECRETS_ARN.',
    deploySource,
    /--secret-id\s+"\$APP_SECRETS_ARN"/,
  )
  requirePattern(
    failures,
    'Deploy workflow must validate required environment configuration before deployment.',
    deploySource,
    /Validate deployment configuration[\s\S]*required=\(/,
  )
  requirePattern(
    failures,
    'Production deploys must require authenticated smoke checks.',
    deploySource,
    /Production deploys must set SMOKE_REQUIRE_AUTHENTICATED=true/,
  )
  requirePattern(
    failures,
    'Manual dispatch must not allow production deployments.',
    deploySource,
    /Manual deployment is reserved for staging rehearsal/,
  )
  rejectPattern(
    failures,
    'Frontend API client must not fall back to the production public URL.',
    frontendApiClientSource,
    /https:\/\/octapm\.com\/api\/v1/,
  )
  requirePattern(
    failures,
    'Frontend API client must default to same-origin /api/v1 when VITE_API_URL is not injected.',
    frontendApiClientSource,
    /\|\|\s*['"]\/api\/v1['"]/,
  )

  requirePattern(
    failures,
    'RDS instance must use var.rds_multi_az instead of a hardcoded value.',
    dbInstance,
    /multi_az\s*=\s*var\.rds_multi_az/,
  )
  requirePattern(
    failures,
    'Production RDS precondition must require rds_multi_az.',
    dbInstance,
    /!\s*contains\(\s*\[\s*"prod"\s*,\s*"production"\s*\]\s*,\s*var\.environment\s*\)\s*\|\|\s*var\.rds_multi_az/,
  )
  requirePattern(
    failures,
    'rds_multi_az must default to true.',
    rdsMultiAzVariable,
    /default\s*=\s*true/,
  )
  rejectPattern(
    failures,
    'RDS Multi-AZ must not remain hardcoded false.',
    dbInstance,
    /multi_az\s*=\s*false/,
  )

  requirePattern(
    failures,
    'Production monitoring must require alarm_notification_email.',
    alarmsTopic,
    /!\s*contains\(\s*\[\s*"prod"\s*,\s*"production"\s*\]\s*,\s*var\.environment\s*\)\s*\|\|\s*trimspace\(var\.alarm_notification_email\)\s*!=\s*""/,
  )
  requirePattern(
    failures,
    'alarm_notification_email variable must be defined.',
    alarmEmailVariable,
    /variable\s+"alarm_notification_email"|default\s*=\s*""/,
  )
  requirePattern(
    failures,
    'CloudWatch alarms must create an SNS email subscription from alarm_notification_email.',
    alarmEmailSubscription,
    /endpoint\s*=\s*var\.alarm_notification_email/,
  )
  rejectPattern(
    failures,
    'EC2 runtime role must not be able to invalidate CloudFront.',
    ec2Permissions,
    /cloudfront:CreateInvalidation/,
  )
  rejectPattern(
    failures,
    'EC2 runtime role must not write the SPA deployment bucket.',
    ec2Permissions,
    /aws_s3_bucket\.spa\.arn/,
  )
  requirePattern(
    failures,
    'GitHub deploy role must retain SPA bucket deployment permissions.',
    githubDeployPermissions,
    /aws_s3_bucket\.spa\.arn/,
  )
  requirePattern(
    failures,
    'GitHub deploy role must retain CloudFront invalidation permissions.',
    githubDeployPermissions,
    /cloudfront:CreateInvalidation/,
  )

  return failures
}

function runSelfTest() {
  const badDeploy = `
VITE_API_URL: https://octapm.com/api/v1
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id arn:aws:secretsmanager:us-east-2:123456789012:secret:pmcopilots/prod/app-secrets)
git clone https://x-access-token:$GH_TOKEN@github.com/mahmoud63/octapm.git "$APP_DIR"
DATABASE_URL=postgresql://pmcopilots:pw@pmcopilots-db.example.us-east-2.rds.amazonaws.com:5432/pmcopilots
`
  const badFrontendApiClient = "const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://octapm.com/api/v1'"
  const badDatabase = `
resource "aws_db_instance" "main" {
  multi_az = false
}
`
  const badVariables = ''
  const badMonitoring = 'resource "aws_sns_topic" "alarms" {}'
  const badIam = `
data "aws_iam_policy_document" "ec2_permissions" {
  statement {
    actions = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.main.arn, aws_s3_bucket.spa.arn]
  }
}

data "aws_iam_policy_document" "github_actions_deploy_permissions" {}
`
  const badFailures = validateDeploymentReadiness({
    deploySource: badDeploy,
    frontendApiClientSource: badFrontendApiClient,
    iamSource: badIam,
    databaseSource: badDatabase,
    variablesSource: badVariables,
    monitoringSource: badMonitoring,
  })
  if (badFailures.length < 10) {
    throw new Error('Self-test expected unsafe deployment readiness fixtures to fail.')
  }

  const goodDeploy = `
jobs:
  deployment-gate:
    steps:
      - name: Validate deployment configuration
        run: |
          required=(
            AWS_REGION
          )
          echo "Production deploys must set SMOKE_REQUIRE_AUTHENTICATED=true."
          echo "Manual deployment is reserved for staging rehearsal."
  deploy-frontend:
    steps:
      - name: Build
        env:
          VITE_API_URL: \${{ vars.VITE_API_URL }}
  deploy-backend:
    steps:
      - name: Deploy to EC2
        env:
          APP_SECRETS_ARN: \${{ vars.APP_SECRETS_ARN }}
        run: |
          aws secretsmanager get-secret-value --secret-id "$APP_SECRETS_ARN"
`
  const goodFrontendApiClient = "const API_BASE_URL = import.meta.env.VITE_API_URL?.replace(/\\/$/, '') || '/api/v1'"
  const goodDatabase = `
resource "aws_db_instance" "main" {
  multi_az = var.rds_multi_az
  lifecycle {
    precondition {
      condition = !contains(["prod", "production"], var.environment) || var.rds_multi_az
    }
  }
}
`
  const goodVariables = `
variable "rds_multi_az" {
  type = bool
  default = true
}

variable "alarm_notification_email" {
  type = string
  default = ""
}
`
  const goodMonitoring = `
resource "aws_sns_topic" "alarms" {
  lifecycle {
    precondition {
      condition = !contains(["prod", "production"], var.environment) || trimspace(var.alarm_notification_email) != ""
    }
  }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  endpoint = var.alarm_notification_email
}
`
  const goodIam = `
data "aws_iam_policy_document" "ec2_permissions" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

data "aws_iam_policy_document" "github_actions_deploy_permissions" {
  statement {
    actions = ["s3:PutObject"]
    resources = [aws_s3_bucket.spa.arn]
  }

  statement {
    actions = ["cloudfront:CreateInvalidation"]
  }
}
`
  const goodFailures = validateDeploymentReadiness({
    deploySource: goodDeploy,
    frontendApiClientSource: goodFrontendApiClient,
    iamSource: goodIam,
    databaseSource: goodDatabase,
    variablesSource: goodVariables,
    monitoringSource: goodMonitoring,
  })
  if (goodFailures.length > 0) {
    throw new Error(`Self-test expected compliant deployment readiness fixtures to pass: ${goodFailures.join('; ')}`)
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('Deployment readiness validation self-test passed.')
  process.exit(0)
}

const failures = validateDeploymentReadiness({
  deploySource: readFileSync(deployWorkflow, 'utf8'),
  frontendApiClientSource: readFileSync(frontendApiClient, 'utf8'),
  iamSource: readFileSync(resolve(terraformDir, 'iam.tf'), 'utf8'),
  databaseSource: readFileSync(resolve(terraformDir, 'database.tf'), 'utf8'),
  variablesSource: readFileSync(resolve(terraformDir, 'variables.tf'), 'utf8'),
  monitoringSource: readFileSync(resolve(terraformDir, 'monitoring.tf'), 'utf8'),
})

if (failures.length > 0) {
  console.error('Deployment readiness validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Deployment readiness validation passed.')
