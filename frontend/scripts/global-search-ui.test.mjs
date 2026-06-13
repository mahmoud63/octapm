import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const commandMenuSource = read('src/components/command-menu.tsx')
const hookSource = read('src/features/search/hooks/use-global-search.ts')

assert.match(hookSource, /apiClient\s*\.\s*get\('\/search'/)
assert.match(hookSource, /GlobalSearchResult/)
assert.match(commandMenuSource, /useGlobalSearch/)
assert.match(commandMenuSource, /searchTypeFilters/)
assert.match(commandMenuSource, /statusFilters/)
assert.match(commandMenuSource, /dateFilters/)
assert.match(commandMenuSource, /resultGroups\.map/)
assert.match(commandMenuSource, /SearchResultItem/)
assert.match(commandMenuSource, /navigate\(\{ to: result\.url \}\)/)
assert.doesNotMatch(commandMenuSource, /Type a command or search/)

console.log('global-search-ui assertions passed')
