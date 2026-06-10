#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const LIVE_STRIPE_SECRET_PATTERNS = [
  {
    name: 'Stripe live secret key',
    pattern: /\bsk_live_[A-Za-z0-9]{12,}\b/g,
  },
  {
    name: 'Stripe live restricted key',
    pattern: /\brk_live_[A-Za-z0-9]{12,}\b/g,
  },
]

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
])

const TEXT_FILE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.prisma',
  '.sql',
  '.tf',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const hasTextExtension = (file) => {
  const lower = file.toLowerCase()
  if (lower.endsWith('.tfvars.example')) return true
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex >= 0 && TEXT_FILE_EXTENSIONS.has(lower.slice(dotIndex))
}

const walkFiles = (root, dir = root, files = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkFiles(root, fullPath, files)
      continue
    }
    if (stat.isFile() && hasTextExtension(fullPath)) {
      files.push(relative(root, fullPath))
    }
  }
  return files
}

const listCandidateFiles = (root) => {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\0')
      .filter(Boolean)
      .filter(hasTextExtension)
  } catch (_error) {
    return walkFiles(root)
  }
}

const lineNumberForIndex = (text, index) =>
  text.slice(0, index).split(/\r?\n/).length

const scanText = (text, file = '<inline>') => {
  const findings = []
  for (const { name, pattern } of LIVE_STRIPE_SECRET_PATTERNS) {
    pattern.lastIndex = 0
    let match = pattern.exec(text)
    while (match) {
      findings.push({
        file,
        line: lineNumberForIndex(text, match.index),
        name,
      })
      match = pattern.exec(text)
    }
  }
  return findings
}

const scanRepository = (root) =>
  listCandidateFiles(root).flatMap((file) => {
    const fullPath = join(root, file)
    const text = readFileSync(fullPath, 'utf8')
    if (text.includes('\0')) return []
    return scanText(text, file)
  })

const runSelfTest = () => {
  const unsafe = ['STRIPE_SECRET_KEY=sk', 'live', '1234567890abcdef'].join('_') + '\n'
  const safe = [
    'STRIPE_SECRET_KEY=sk_live_...',
    'STRIPE_SECRET_KEY=sk_test_1234567890abcdef',
    "const key = `sk_${mode}_generated_for_tests`",
  ].join('\n')

  if (scanText(unsafe).length !== 1) {
    throw new Error('self-test expected one live Stripe secret finding')
  }
  if (scanText(safe).length !== 0) {
    throw new Error('self-test expected no findings for sanitized examples')
  }

  const tmp = mkdtempSync(join(tmpdir(), 'pmc-secret-hygiene-'))
  try {
    writeFileSync(join(tmp, 'notes.txt'), unsafe)
    if (scanRepository(tmp).length !== 1) {
      throw new Error('self-test repository scan did not detect unsafe fixture')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  console.log('Secret hygiene self-test passed')
}

const main = () => {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  const root = resolve(import.meta.dirname, '..', '..')
  const findings = scanRepository(root)
  if (findings.length > 0) {
    console.error(
      `${findings.length} potential live Stripe secret reference(s) found. Values are intentionally not printed.`,
    )
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} ${finding.name}`)
    }
    process.exitCode = 1
    return
  }

  console.log('Secret hygiene validation passed')
}

main()
