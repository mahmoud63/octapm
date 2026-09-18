import type { AssignmentItem } from '@/api/types'
import { RecordRow } from '@/design-system'
import { dueState, humanise } from '@/utilities/format'

/**
 * One thing that needs the person: what it is, where it stands, and when.
 * Ball-in-court items say so, because that is the one word a field person
 * scans for.
 */
export function AssignmentRow({ item, showProject, onPress }: { item: AssignmentItem; showProject?: boolean; onPress?: () => void }) {
  const due = item.dueDate ? dueState(item.dueDate) : null
  const parts = [item.label, showProject ? item.projectName : null, item.ballInCourt ? 'Ball in court' : null].filter(Boolean)
  return (
    <RecordRow
      reference={item.ref ?? humanise(item.recordType)}
      title={item.title}
      status={item.status}
      meta={parts.join(' · ')}
      trailing={due?.label}
      trailingTone={item.overdue ? 'error' : (due?.tone ?? 'muted')}
      onPress={onPress}
    />
  )
}
