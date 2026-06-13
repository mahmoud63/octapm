import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

const taskIndex = read('src/features/tasks/index.tsx')
const taskDrawer = read('src/features/tasks/components/tasks-mutate-drawer.tsx')
const taskDialogs = read('src/features/tasks/components/tasks-dialogs.tsx')
const taskHooks = read('src/features/tasks/hooks/use-tasks.ts')
const taskFeatureDir = path.join(repoRoot, 'src/features/tasks')

const readSourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return readSourceFiles(fullPath)
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      return fs.readFileSync(fullPath, 'utf8')
    }
    return []
  })

const taskSources = readSourceFiles(taskFeatureDir).join('\n')

assert.match(taskIndex, /useTasksQuery/)
assert.doesNotMatch(taskIndex, /data\/tasks/)
assert.match(taskDrawer, /useCreateTask/)
assert.match(taskDrawer, /useUpdateTask/)
assert.doesNotMatch(taskDrawer, /showSubmittedData/)
assert.match(taskDialogs, /useDeleteTask/)
assert.match(taskHooks, /\/tasks/)
assert.match(taskHooks, /\/tasks\/\$\{taskId\}\/close/)
assert.doesNotMatch(taskSources, /@faker-js\/faker/)

console.log('tasks-workflow-ui assertions passed')
