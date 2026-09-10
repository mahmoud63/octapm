import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const terraformDir = resolve(repoRoot, 'infrastructure', 'terraform')
const computeTf = resolve(terraformDir, 'compute.tf')

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

function resolveTemplatePath(templatePath, moduleDir) {
  const moduleToken = '${path.module}'
  if (templatePath.startsWith(moduleToken)) {
    const relativeTemplatePath = templatePath
      .slice(moduleToken.length)
      .replace(/^[/\\]/, '')
    return resolve(moduleDir, relativeTemplatePath)
  }

  return resolve(moduleDir, templatePath)
}

export function validateEc2UserData(computeSource, options = {}) {
  const moduleDir = options.terraformDir ?? terraformDir
  const hasCustomTemplateExists = Boolean(options.templateExists)
  const templateExists = options.templateExists ?? ((templatePath) => existsSync(templatePath))
  const readTemplate = options.readTemplate ?? (
    hasCustomTemplateExists ? null : ((templatePath) => readFileSync(templatePath, 'utf8'))
  )
  const failures = []
  const appInstance = extractBlock(
    computeSource,
    /resource\s+"aws_instance"\s+"app"\s*\{/m,
  )

  if (!appInstance) {
    return ['EC2 app instance must be present before bootstrap user data can be validated.']
  }

  const assignmentNames = [...appInstance.matchAll(/^\s*(user_data(?:_base64)?)\s*=/gm)]
    .map((match) => match[1])

  if (assignmentNames.length === 0) {
    failures.push('EC2 app instance must define bootstrap user data.')
  }
  if (assignmentNames.includes('user_data') && assignmentNames.includes('user_data_base64')) {
    failures.push('EC2 app instance must use either user_data or user_data_base64, not both.')
  }
  if (/^\s*user_data\s*=\s*base64encode\s*\(/m.test(appInstance)) {
    failures.push('EC2 user_data must not be base64 encoded; use user_data_base64 for encoded content or plain templatefile output for user_data.')
  }
  if (/^\s*user_data_base64\s*=\s*templatefile\s*\(/m.test(appInstance)) {
    failures.push('EC2 user_data_base64 must receive base64-encoded content, not plain template output.')
  }

  const templateRefs = [...appInstance.matchAll(/templatefile\(\s*"([^"]+)"/g)]
    .map((match) => match[1])

  if (templateRefs.length === 0) {
    failures.push('EC2 app bootstrap must render a checked-in templatefile script.')
  }

  for (const templateRef of templateRefs) {
    const resolvedTemplatePath = resolveTemplatePath(templateRef, moduleDir)
    if (!templateExists(resolvedTemplatePath)) {
      failures.push(
        `EC2 user data template does not exist: ${templateRef} (resolved to ${resolvedTemplatePath})`,
      )
      continue
    }

    if (readTemplate) {
      const templateSource = readTemplate(resolvedTemplatePath)
      if (/setup_20\.x/.test(templateSource)) {
        failures.push('EC2 user data must not install the old Node.js 20 runtime.')
      }
      if (!/setup_\$NODE_MAJOR\.x/.test(templateSource) && !/setup_24\.x/.test(templateSource)) {
        failures.push('EC2 user data must install the repository runtime from the Node.js 24 package source.')
      }
      if (!/NODE_MAJOR=24/.test(templateSource) || !/node --version \| grep -Eq "\^v\$NODE_MAJOR\\\\\."/.test(templateSource)) {
        failures.push('EC2 user data must verify Node.js major version 24 after installation.')
      }
      if (!/NPM_VERSION=11\.9\.0/.test(templateSource) || !templateSource.includes("npm --version | grep -Eq '^11\\.'")) {
        failures.push('EC2 user data must verify npm major version 11 after installation.')
      }
    }
  }

  return failures
}

function runSelfTest() {
  const badEncodedMissingTemplate = `
resource "aws_instance" "app" {
  user_data = base64encode(templatefile("\${path.module}/templates/user-data.sh", {}))
}
`
  const badFailures = validateEc2UserData(badEncodedMissingTemplate, {
    terraformDir: '/tmp/terraform',
    templateExists: () => false,
  })
  if (badFailures.length < 2) {
    throw new Error('Self-test expected encoded user_data with a missing template to fail.')
  }

  const badBothFields = `
resource "aws_instance" "app" {
  user_data        = templatefile("\${path.module}/templates/user-data.sh", {})
  user_data_base64 = base64encode(templatefile("\${path.module}/templates/user-data.sh", {}))
}
`
  const bothFailures = validateEc2UserData(badBothFields, {
    terraformDir: '/tmp/terraform',
    templateExists: () => true,
  })
  if (!bothFailures.some((failure) => failure.includes('either user_data or user_data_base64'))) {
    throw new Error('Self-test expected conflicting user_data fields to fail.')
  }

  const goodBase64 = `
resource "aws_instance" "app" {
  user_data_base64 = base64encode(templatefile("\${path.module}/templates/user-data.sh", {}))
}
`
  const goodBase64Failures = validateEc2UserData(goodBase64, {
    terraformDir: '/tmp/terraform',
    templateExists: () => true,
  })
  if (goodBase64Failures.length > 0) {
    throw new Error(`Self-test expected encoded user_data_base64 to pass: ${goodBase64Failures.join('; ')}`)
  }

  const goodPlain = `
resource "aws_instance" "app" {
  user_data = templatefile("\${path.module}/templates/user-data.sh", {})
}
`
  const goodPlainFailures = validateEc2UserData(goodPlain, {
    terraformDir: '/tmp/terraform',
    templateExists: () => true,
  })
  if (goodPlainFailures.length > 0) {
    throw new Error(`Self-test expected plain user_data to pass: ${goodPlainFailures.join('; ')}`)
  }

  const goodNode24Template = `
NODE_MAJOR=24
NPM_VERSION=11.9.0
curl -fsSL "https://rpm.nodesource.com/setup_$NODE_MAJOR.x" | bash -
node --version | grep -Eq "^v$NODE_MAJOR\\\\."
npm --version | grep -Eq '^11\\.'
`
  const goodRuntimeFailures = validateEc2UserData(goodPlain, {
    terraformDir: '/tmp/terraform',
    templateExists: () => true,
    readTemplate: () => goodNode24Template,
  })
  if (goodRuntimeFailures.length > 0) {
    throw new Error(`Self-test expected Node 24 bootstrap template to pass: ${goodRuntimeFailures.join('; ')}`)
  }

  const badNode20Template = `
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
node --version | grep -Eq '^v20\\\\.'
`
  const badRuntimeFailures = validateEc2UserData(goodPlain, {
    terraformDir: '/tmp/terraform',
    templateExists: () => true,
    readTemplate: () => badNode20Template,
  })
  if (!badRuntimeFailures.some((failure) => failure.includes('old Node.js 20'))) {
    throw new Error('Self-test expected Node 20 bootstrap template to fail.')
  }
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('EC2 user data validation self-test passed.')
  process.exit(0)
}

const failures = validateEc2UserData(readFileSync(computeTf, 'utf8'))

if (failures.length > 0) {
  console.error('EC2 user data validation failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('EC2 user data validation passed.')
