import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/meetings/components/meetings-dashboard.tsx',
    checks: [
      'MeetingsDashboard',
      'Minutes Register',
      'Action Items',
      'Distribution',
      'useCreateMeeting',
      'useUpdateMeeting',
      'useDistributeMeeting',
      'useAddMeetingComment',
      "'meeting'",
      'meeting.distribute',
      'meeting.comment',
      'task.taskNumber',
    ],
  },
  {
    file: 'src/features/meetings/hooks/use-meetings.ts',
    checks: [
      '/projects/${projectId}/meetings',
      '/projects/${projectId}/meetings/${meetingId}/distribute',
      '/projects/${projectId}/meetings/${meetingId}/comments',
      "queryKey: ['meetings', projectId]",
      "queryKey: ['tasks']",
    ],
  },
  {
    file: 'src/features/projects/components/project-detail.tsx',
    checks: ['MeetingsDashboard', "{ key: 'meetings', label: 'Meetings' }"],
  },
  {
    file: 'src/features/projects/lib/project-modules.ts',
    checks: ["| 'meetings'", "meetings: 'meetings'"],
  },
  {
    file: '../shared/permissions.json',
    checks: ['"meeting"', '"meeting.distribute"', '"meeting.comment"'],
  },
]

for (const assertion of assertions) {
  const source = read(assertion.file)
  for (const check of assertion.checks) {
    if (!source.includes(check)) {
      throw new Error(`${assertion.file} is missing ${check}`)
    }
  }
}

console.log('meetings-ui assertions passed')
