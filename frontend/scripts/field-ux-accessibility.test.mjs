import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const repoRoot = resolve(root, '..')
const readFrontend = (path) => readFileSync(resolve(root, path), 'utf8')
const readRepo = (path) => readFileSync(resolve(repoRoot, path), 'utf8')

const assertions = [
  {
    file: 'src/features/site-reporting/components/site-reporting-dashboard.tsx',
    source: readFrontend(
      'src/features/site-reporting/components/site-reporting-dashboard.tsx'
    ),
    checks: [
      "accept='image/*,.heic,.heif'",
      "capture='environment'",
      "htmlFor='daily-report-photo-input'",
      "id='daily-report-photo-input'",
      "aria-describedby='daily-report-photo-status'",
      "id='daily-report-photo-status'",
      "htmlFor='site-diary-photo-input'",
      "id='site-diary-photo-input'",
      "aria-describedby='site-diary-photo-status'",
      "id='site-diary-photo-status'",
      "aria-label='Activity progress percent'",
      "aria-label='Activity progress percent value'",
      "inputMode='numeric'",
      "className='min-h-11 flex-col gap-1 py-2 text-xs sm:flex-row sm:text-sm'",
      "className='min-h-10 w-full sm:w-auto'",
      "className='size-10 sm:size-9'",
      'Offline draft mode',
      'No photos selected',
    ],
  },
  {
    file: 'src/features/quality/components/quality-dashboard.tsx',
    source: readFrontend(
      'src/features/quality/components/quality-dashboard.tsx'
    ),
    checks: [
      'useUploadWorkflowAttachments',
      'closeoutEvidenceAccept',
      "capture='environment'",
      "htmlFor='quality-closeout-evidence'",
      "id='quality-closeout-evidence'",
      "aria-describedby='quality-closeout-evidence-status'",
      "id='quality-closeout-evidence-status'",
      "htmlFor='quality-closeout-responsible'",
      "htmlFor='quality-closeout-due-date'",
      "htmlFor='quality-closeout-comment'",
      "className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'",
      "className='grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-fit sm:flex-wrap'",
      "className='min-h-10 w-full sm:w-auto'",
      "aria-label='New NCR description'",
      "aria-label='Incident title'",
      "aria-label='Material test type'",
      'Upload & submit',
    ],
  },
  {
    file: 'src/features/quality/hooks/use-quality.ts',
    source: readFrontend('src/features/quality/hooks/use-quality.ts'),
    checks: [
      'WorkflowAttachmentUpload',
      'useUploadWorkflowAttachments',
      '/projects/${projectId}/workflow/uploads',
      "fd.append('files', file)",
      "'Content-Type': 'multipart/form-data'",
    ],
  },
  {
    file: '../e2e/uat/manifest.json',
    source: readRepo('e2e/uat/manifest.json'),
    checks: [
      '/projects/{projectId}?module=siteReporting',
      '/projects/{projectId}?module=quality&child=ncr',
      '/projects/{projectId}?module=quality&child=safety',
      '"tablet"',
      '"mobile"',
    ],
  },
]

for (const assertion of assertions) {
  for (const check of assertion.checks) {
    if (!assertion.source.includes(check)) {
      throw new Error(`${assertion.file} is missing ${check}`)
    }
  }
}

console.log('Field UX accessibility assertions passed')
