import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const databaseTf = resolve(repoRoot, 'infrastructure', 'terraform', 'database.tf')
const variablesTf = resolve(repoRoot, 'infrastructure', 'terraform', 'variables.tf')

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

function requirePattern(label, source, pattern) {
  if (!pattern.test(source)) {
    throw new Error(label)
  }
}

export function validateRdsBackupPolicy(databaseSource, variablesSource) {
  const dbInstance = extractBlock(
    databaseSource,
    /resource\s+"aws_db_instance"\s+"main"\s*\{/m,
  )
  const retentionVariable = extractBlock(
    variablesSource,
    /variable\s+"rds_backup_retention_days"\s*\{/m,
  )

  const failures = []

  function check(label, source, pattern) {
    if (!source) {
      failures.push(label)
      return
    }

    try {
      requirePattern(label, source, pattern)
    } catch (error) {
      failures.push(error.message)
    }
  }

  check(
    'RDS backups must retain at least seven days in production.',
    dbInstance,
    /backup_retention_period\s*=\s*var\.rds_backup_retention_days/,
  )
  check(
    'rds_backup_retention_days must default to at least seven days.',
    retentionVariable,
    /default\s*=\s*(?:[7-9]|[12][0-9]|3[0-5])/,
  )
  check(
    'rds_backup_retention_days must reject values below seven days.',
    retentionVariable,
    /condition\s*=\s*var\.rds_backup_retention_days\s*>=\s*7\s*&&\s*var\.rds_backup_retention_days\s*<=\s*35/s,
  )
  check(
    'RDS automated backups must be retained after instance deletion.',
    dbInstance,
    /delete_automated_backups\s*=\s*false/,
  )
  check(
    'RDS deletion protection must stay enabled for production.',
    dbInstance,
    /deletion_protection\s*=\s*true/,
  )
  check(
    'RDS final snapshots must not be skipped.',
    dbInstance,
    /skip_final_snapshot\s*=\s*false/,
  )
  check(
    'RDS final snapshot identifiers must include a generated unique suffix.',
    dbInstance,
    /final_snapshot_identifier\s*=\s*".*\$\{random_id\.db_final_snapshot_suffix\.hex\}.*"/,
  )
  check(
    'RDS snapshots must copy DB tags for traceability.',
    dbInstance,
    /copy_tags_to_snapshot\s*=\s*true/,
  )

  return failures
}

function runSelfTest() {
  const badDatabase = `
resource "aws_db_instance" "main" {
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "pmcopilots-db-final-snapshot"
  backup_retention_period   = 0
}
`
  const badVariables = ''
  const badFailures = validateRdsBackupPolicy(badDatabase, badVariables)
  if (badFailures.length < 4) {
    throw new Error('Self-test expected unsafe RDS backup policy to fail.')
  }

  const goodDatabase = `
resource "aws_db_instance" "main" {
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "\${var.app_name}-\${var.environment}-db-final-\${random_id.db_final_snapshot_suffix.hex}"
  copy_tags_to_snapshot      = true
  backup_retention_period    = var.rds_backup_retention_days
  delete_automated_backups   = false
}
`
  const goodVariables = `
variable "rds_backup_retention_days" {
  type    = number
  default = 7

  validation {
    condition     = var.rds_backup_retention_days >= 7 && var.rds_backup_retention_days <= 35
    error_message = "rds_backup_retention_days must be between 7 and 35."
  }
}
`
  const goodFailures = validateRdsBackupPolicy(goodDatabase, goodVariables)
  if (goodFailures.length > 0) {
    throw new Error(`Self-test expected compliant RDS policy to pass: ${goodFailures.join('; ')}`)
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('RDS backup validation self-test passed.')
  process.exit(0)
}

const databaseSource = readFileSync(databaseTf, 'utf8')
const variablesSource = readFileSync(variablesTf, 'utf8')
const failures = validateRdsBackupPolicy(databaseSource, variablesSource)

if (failures.length > 0) {
  console.error('RDS backup validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('RDS backup validation passed.')
