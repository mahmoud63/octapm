import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { UserPicker } from '@/components/user-picker'
import { useProjectTeam } from '@/features/permissions/hooks/use-permissions'

/** A list of people picked from the project team, shown as removable chips. */
export function RfiPeopleList({
  projectId,
  label,
  value,
  onChange,
  disabled = false,
  placeholder = 'Add a person',
  testId,
}: {
  projectId: string
  label: string
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
  testId?: string
}) {
  const { data: team } = useProjectTeam(projectId)
  const nameOf = (userId: string) =>
    team?.items.find((member) => member.userId === userId)?.name ?? 'Member'
  return (
    <div className='space-y-1' data-testid={testId}>
      <Label>{label}</Label>
      <div className='flex flex-wrap gap-1'>
        {value.map((userId) => (
          <Badge key={userId} variant='secondary' className='gap-1'>
            {nameOf(userId)}
            {!disabled && (
              <button
                type='button'
                className='rounded hover:text-destructive'
                onClick={() => onChange(value.filter((id) => id !== userId))}
                aria-label={`Remove ${nameOf(userId)}`}
              >
                <X className='h-3 w-3' />
              </button>
            )}
          </Badge>
        ))}
        {value.length === 0 && (
          <span className='text-xs text-muted-foreground'>Nobody yet</span>
        )}
      </div>
      {!disabled && (
        <UserPicker
          projectId={projectId}
          value={null}
          onChange={(userId) => {
            if (userId && !value.includes(userId)) onChange([...value, userId])
          }}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
