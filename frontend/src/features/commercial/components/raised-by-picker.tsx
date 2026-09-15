import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
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
import { useProjectParties } from '@/features/projects/hooks/use-projects'

const OTHER = '__other__'

/**
 * Who raised the change: a project member or a party company chosen from the
 * project, or "Other" for someone outside it. The record keeps the display
 * name (the model's `raisedBy`), so history is preserved and nothing is
 * retyped for people the system already knows (Phase 22A, UX22-04).
 */
export function RaisedByPicker({
  id,
  projectId,
  value,
  onChange,
}: {
  id?: string
  projectId: string
  value: string
  onChange: (value: string) => void
}) {
  const { data: team } = useProjectTeam(projectId)
  const { data: parties } = useProjectParties(projectId)

  const options = useMemo(() => {
    const people = (team?.items || []).map((member) => ({
      key: `user:${member.userId}`,
      label: member.orgRole
        ? `${member.name} (${member.orgRole.replace(/_/g, ' ')})`
        : member.name,
      name: member.name,
    }))
    const companies = (parties?.items || [])
      .map((party) => ({
        key: `party:${party.id}`,
        label: party.company?.name
          ? `${party.company.name} (${party.roleLabel || party.role})`
          : null,
        name: party.company?.name || null,
      }))
      .filter((row): row is { key: string; label: string; name: string } =>
        Boolean(row.label && row.name)
      )
    return { people, companies }
  }, [team, parties])

  const known = [...options.people, ...options.companies]
  const matched = known.find((row) => row.name === value)
  const [mode, setMode] = useState<'known' | 'other'>(
    value && !matched ? 'other' : 'known'
  )

  return (
    <div className='grid gap-1.5'>
      <Select
        value={mode === 'other' ? OTHER : matched?.key || ''}
        onValueChange={(next) => {
          if (next === OTHER) {
            setMode('other')
            if (matched) onChange('')
            return
          }
          setMode('known')
          onChange(known.find((row) => row.key === next)?.name || '')
        }}
      >
        <SelectTrigger id={id} aria-label='Raised by' data-testid='co-raised-by'>
          <SelectValue placeholder='Choose a person or party' />
        </SelectTrigger>
        <SelectContent>
          {options.people.length > 0 && (
            <SelectGroup>
              <SelectLabel>Project team</SelectLabel>
              {options.people.map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {options.companies.length > 0 && (
            <SelectGroup>
              <SelectLabel>Parties</SelectLabel>
              {options.companies.map((row) => (
                <SelectItem key={row.key} value={row.key}>
                  {row.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>Outside the project</SelectLabel>
            <SelectItem value={OTHER}>Other / external…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {mode === 'other' && (
        <Input
          aria-label='Raised by (other)'
          placeholder='Name of the person or organisation'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}
