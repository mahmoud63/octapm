import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const exists = (path) => existsSync(resolve(root, path))

// ── Backend: durable queue replaces in-memory maps ───────────────────────
const scheduleService = read('../backend/src/services/schedule.service.js')
const boqService = read('../backend/src/services/boq.service.js')
const backendIndex = read('../backend/src/index.js')
const rateLimit = read('../backend/src/middleware/rate-limit.js')
const schema = read('../backend/prisma/schema.prisma')

assert.ok(!exists('../backend/src/services/boq/job-store.js'), 'in-memory BOQ job store removed')
assert.ok(!/const jobs = new Map\(\)/.test(scheduleService), 'schedule job Map removed')
assert.match(scheduleService, /jobService\.enqueueJob\(/, 'schedule generation enqueues a durable job')
assert.match(scheduleService, /runScheduleGenerationJob/, 'schedule generation exposes a job handler')
assert.match(boqService, /jobService\.enqueueJob\(/, 'BOQ AI processing enqueues a durable job')
assert.match(boqService, /runBoqActivityJob/, 'BOQ exposes a job handler')
assert.match(schema, /model BackgroundJob \{/, 'BackgroundJob model declared')
assert.match(backendIndex, /startJobWorker\(\)/, 'API starts the job worker')
assert.match(rateLimit, /getSharedRateLimitStore/, 'rate limiter uses the shared store')
assert.match(
  read('../backend/src/jobs/job.service.js'),
  /FOR UPDATE SKIP LOCKED/,
  'job claims are safe across instances'
)

// ── Frontend: pollers unchanged, retry added ─────────────────────────────
const useSchedule = read('src/features/schedule/hooks/use-schedule.ts')
const scheduleZone = read('src/features/schedule/components/schedule-upload-zone.tsx')
const useBoq = read('src/features/boq/hooks/use-boq.ts')
const boqZone = read('src/features/boq/components/boq-upload-zone.tsx')

assert.match(useSchedule, /\/schedule\/job\/\$\{jobId\}`/, 'schedule poller endpoint unchanged')
assert.match(useSchedule, /\/schedule\/job\/\$\{id\}\/retry/, 'schedule retry endpoint wired')
assert.match(useSchedule, /canRetry/, 'schedule hook exposes canRetry')
assert.match(scheduleZone, /data-testid='uat-schedule-job-retry'/, 'schedule retry button rendered')
assert.match(useBoq, /\/boq\/job\/\$\{jobId\}`/, 'BOQ poller endpoint unchanged')
assert.match(useBoq, /useRetryBoqJob/, 'BOQ retry hook exported')
assert.match(boqZone, /data-testid='uat-boq-job-retry'/, 'BOQ retry button rendered')
assert.match(boqZone, /useRetryBoqJob\(projectId\)/, 'BOQ zone uses the retry hook')

console.log('background-jobs-ui checks passed')
