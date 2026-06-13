#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const PRIVATE_RUNTIME_PATH_PREFIXES = [
  'backend/storage/private-documents/',
  'storage/private-documents/',
]

const normalizePath = (value) =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')

const isPrivateRuntimeStoragePath = (file) => {
  const normalized = normalizePath(file)
  return PRIVATE_RUNTIME_PATH_PREFIXES.some(
    (prefix) =>
      normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  )
}

const splitNullSeparated = (value) => value.split('\0').filter(Boolean)

const gitOutput = (root, args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const listTrackedPrivateStorageFiles = (root) =>
  splitNullSeparated(gitOutput(root, ['ls-files', '-z'])).filter(
    isPrivateRuntimeStoragePath,
  )

const listStagedPrivateStorageFiles = (root) =>
  splitNullSeparated(
    gitOutput(root, [
      'diff',
      '--cached',
      '--name-only',
      '--diff-filter=ACMR',
      '-z',
    ]),
  ).filter(isPrivateRuntimeStoragePath)

const assertSelfTest = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}

const runSelfTest = () => {
  const unsafe = [
    'backend/storage/private-documents/orgs/org-1/projects/project-1/boq/private.xlsx',
    'backend\\storage\\private-documents\\orgs\\org-1\\projects\\project-1\\workflow\\claim.pdf',
    'storage/private-documents/orgs/org-1/projects/project-1/site-reporting/photo.jpg',
  ]
  const safe = [
    'backend/storage/public/example.txt',
    'backend/src/services/file-storage.service.js',
    'docs/qa/secure-file-storage.md',
  ]

  assertSelfTest(
    unsafe.every(isPrivateRuntimeStoragePath),
    'self-test expected private runtime storage paths to be blocked',
  )
  assertSelfTest(
    safe.every((file) => !isPrivateRuntimeStoragePath(file)),
    'self-test expected source and docs paths to be allowed',
  )

  console.log('Private runtime storage self-test passed')
}

const main = () => {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  const root = new URL('../..', import.meta.url)
  const stagedOnly = process.argv.includes('--staged')
  const findings = stagedOnly
    ? listStagedPrivateStorageFiles(root)
    : listTrackedPrivateStorageFiles(root)

  if (findings.length > 0) {
    const scope = stagedOnly ? 'staged' : 'tracked'
    console.error(
      `${findings.length} private runtime storage file(s) are ${scope}. Uploaded project documents must not be committed.`,
    )
    for (const file of findings) {
      console.error(`- ${file}`)
    }
    console.error(
      'Move fixtures outside private runtime storage or untrack the files with git rm --cached.',
    )
    process.exitCode = 1
    return
  }

  console.log('Private runtime storage validation passed')
}

main()
