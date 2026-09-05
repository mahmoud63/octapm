import { useMemo } from 'react'
import { Building2, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useProjectTeam } from '@/features/permissions/hooks/use-permissions'

const NONE = '__none__'

/**
 * Picks a person from the project team (assignments and party members).
 * Emits the user id, never free text — see OCTA-DATA-REFS-004.
 */
export function UserPicker({
  projectId,
  value,
  onChange,
  placeholder = 'Unassigned',
  disabled,
  id,
  className,
  testId,
  allowNone = true,
}: {
  projectId: string
  value: string | null | undefined
  onChange: (userId: string | null) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  testId?: string
  allowNone?: boolean
}) {
  const { data, isLoading } = useProjectTeam(projectId)
  const groups = useMemo(() => {
    const items = data?.items ?? []
    const internal = items.filter((member) => !member.party)
    const external = items.filter((member) => member.party)
    return { internal, external }
  }, [data])

  const knownIds = new Set((data?.items ?? []).map((member) => member.userId))
  const current = value && knownIds.has(value) ? value : value ? value : NONE

  return (
    <Select
      value={current}
      disabled={disabled || isLoading}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger id={id} data-testid={testId} className={cn(className)}>
        <UserRound className='size-4 text-muted-foreground' />
        <SelectValue placeholder={isLoading ? 'Loading team…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{placeholder}</SelectItem>}
        {value && !knownIds.has(value) && (
          <SelectItem value={value}>Assigned user (not on team)</SelectItem>
        )}
        {groups.internal.length > 0 && (
          <SelectGroup>
            <SelectLabel>Project team</SelectLabel>
            {groups.internal.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
                {member.assignmentRole
                  ? ` · ${member.assignmentRole.replace(/_/g, ' ')}`
                  : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {groups.external.length > 0 && (
          <SelectGroup>
            <SelectLabel>External parties</SelectLabel>
            {groups.external.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
                {member.party?.companyName
                  ? ` · ${member.party.companyName}`
                  : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

/** Picks a company from the project's parties. Emits the company id. */
export function CompanyPicker({
  projectId,
  value,
  onChange,
  placeholder = 'No company',
  disabled,
  id,
  className,
  testId,
}: {
  projectId: string
  value: string | null | undefined
  onChange: (companyId: string | null) => void
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  testId?: string
}) {
  const { data, isLoading } = useProjectTeam(projectId)
  const parties = (data?.parties ?? []).filter((party) => party.companyId)
  const knownIds = new Set(parties.map((party) => party.companyId))

  return (
    <Select
      value={value || NONE}
      disabled={disabled || isLoading}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger id={id} data-testid={testId} className={cn(className)}>
        <Building2 className='size-4 text-muted-foreground' />
        <SelectValue
          placeholder={isLoading ? 'Loading parties…' : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {value && !knownIds.has(value) && (
          <SelectItem value={value}>Assigned company (not a party)</SelectItem>
        )}
        {parties.map((party) => (
          <SelectItem key={party.id} value={party.companyId as string}>
            {party.companyName ?? party.role}
            {` · ${party.role.replace(/_/g, ' ')}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
