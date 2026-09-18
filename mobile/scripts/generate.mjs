#!/usr/bin/env node
/**
 * Generate what the app must never hand-write.
 *
 * Two things come straight from the backend in this repository, so the mobile
 * client cannot drift from it:
 *
 *   src/api/generated/schema.d.ts        TypeScript types for every operation
 *                                        in the backend's OpenAPI document
 *   src/permissions/generated/policy.json a copy of shared/permissions.json,
 *                                        the RBAC policy the server enforces
 *
 * Both outputs are ignored by git and rebuilt before typecheck, test and start.
 *
 *   node scripts/generate.mjs
 */
import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const mobile = path.resolve(here, '..')
const repo = path.resolve(mobile, '..')
const require = createRequire(import.meta.url)

const specFile = path.join(repo, 'backend', 'src', 'openapi', 'spec.js')
const policyFile = path.join(repo, 'shared', 'permissions.json')

async function generateApiTypes() {
  const { openApiSpec } = require(specFile)
  const paths = Object.keys(openApiSpec.paths ?? {}).length
  const schemas = Object.keys(openApiSpec.components?.schemas ?? {}).length
  const ast = await openapiTS(openApiSpec, { immutable: false })
  const out = path.join(mobile, 'src', 'api', 'generated')
  await mkdir(out, { recursive: true })
  const header = `// Generated from backend/src/openapi/spec.js by scripts/generate.mjs. Do not edit.\n`
  await writeFile(path.join(out, 'schema.d.ts'), header + astToString(ast))
  await writeFile(
    path.join(out, 'summary.json'),
    JSON.stringify({ openapi: openApiSpec.openapi, paths, schemas, generatedFrom: 'backend/src/openapi/spec.js' }, null, 2)
  )
  console.log(`api types: ${paths} paths, ${schemas} schemas`)
}

async function copyPolicy() {
  const out = path.join(mobile, 'src', 'permissions', 'generated')
  await mkdir(out, { recursive: true })
  await copyFile(policyFile, path.join(out, 'policy.json'))
  const { size } = await stat(policyFile)
  console.log(`permission policy: ${(size / 1024).toFixed(1)} KB copied from shared/permissions.json`)
}

await generateApiTypes()
await copyPolicy()
