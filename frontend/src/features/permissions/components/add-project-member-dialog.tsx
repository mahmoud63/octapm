import * as React from 'react'
import { Loader2, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { roleLabel } from '@/lib/permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useAddProjectMember,
  useAssignableUsers,
  type AssignableUser,
} from '../hooks/use-permissions'

/**
 * Put a colleague who already has an account onto this project.
 *
 * This is the half of the team screen that did not exist. OctaPM could tell
 * somebody "assign the user to the project before setting a permission
 * template" and then offer no way to do it — the only route onto a project was
 * an email invitation the person had to accept, which is the wrong shape
 * entirely for someone sitting two desks away who logged in this morning. A
 * newly created project therefore had a team of one and refused everybody else
 * with PROJECT_ACCESS_DENIED (OCTA-UX-TEAM-093).
 *
 * The two journeys are deliberately separate and say which is which:
 *
 *   an existing colleague  →  pick them from this list
 *   somebody with no account  →  invite them by email
 *
 * Nothing is retyped. Picking a name is the whole interaction; their email,
 * company and role are already known, and the role they will hold *here*
 * defaults to the one they carry in the company.
 */

/** What somebody can do on a project. Their company role is the default. */
const PROJECT_ROLES = [
  'pm',
  'planning_eng',
  'qs',
  'cost_controller',
  'procurement',
  'warehouse',
  'site_engineer',
  'quality_engineer',
  'finance',
] as const

export function AddProjectMemberDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState<AssignableUser | null>(null)
  const [role, setRole] = React.useState<string>('')

  const { data: users = [], isLoading } = useAssignableUsers(projectId, search, {
    enabled: open,
  })
  const add = useAddProjectMember(projectId)

  const reset = () => {
    setSearch('')
    setSelected(null)
    setRole('')
  }

  const choose = (user: AssignableUser) => {
    setSelected(user)
    // Their company role, unless the person adding them says otherwise.
    setRole(user.orgRole)
  }

  const submit = async () => {
    if (!selected) return
    try {
      const result = await add.mutateAsync({ userId: selected.userId, role: role || null })
      toast.success(
        result.alreadyOnProject
          ? `${result.name} is now a ${roleLabel(result.assignmentRole).toLowerCase()} on this project.`
          : `${result.name} added to the project as ${roleLabel(result.assignmentRole).toLowerCase()}.`
      )
      setOpen(false)
      reset()
    } catch (err) {
      toast.error(getServerErrorMessage(err))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size='sm' data-testid='uat-team-add-open'>
          <UserPlus className='mr-1 size-4' /> Add existing user
        </Button>
      </DialogTrigger>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Add someone from your company</DialogTitle>
          <DialogDescription>
            Pick a colleague who already has an OctaPM account. They get access
            straight away, with the permissions their project role carries.
            Somebody without an account is invited by email instead.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label htmlFor='team-search'>Search</Label>
            <div className='relative'>
              <Search className='text-muted-foreground absolute top-2.5 left-2 size-4' />
              <Input
                id='team-search'
                className='pl-8'
                placeholder='Name or email'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                data-testid='uat-team-add-search'
              />
            </div>
          </div>

          <div className='max-h-64 overflow-y-auto rounded-md border'>
            {isLoading ? (
              <p className='text-muted-foreground p-4 text-center text-sm'>
                <Loader2 className='mr-1 inline size-4 animate-spin' /> Loading…
              </p>
            ) : users.length === 0 ? (
              <p className='text-muted-foreground p-4 text-center text-sm'>
                Nobody in your company matches that.
              </p>
            ) : (
              <ul className='divide-border divide-y'>
                {users.map((user) => (
                  <li key={user.userId}>
                    <button
                      type='button'
                      // Somebody already here stays listed and is not
                      // selectable: "are they on this job?" is the question,
                      // and a missing name does not answer it.
                      disabled={user.onProject}
                      onClick={() => choose(user)}
                      className={
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left ' +
                        (user.onProject
                          ? 'cursor-not-allowed opacity-60'
                          : selected?.userId === user.userId
                            ? 'bg-primary/10'
                            : 'hover:bg-muted/60')
                      }
                      data-testid={`uat-team-add-candidate-${user.email}`}
                    >
                      <span className='min-w-0'>
                        <span className='block truncate text-sm font-medium'>
                          {user.name}
                        </span>
                        <span className='text-muted-foreground block truncate text-xs'>
                          {user.email}
                        </span>
                      </span>
                      <span className='flex shrink-0 items-center gap-2'>
                        <Badge variant='outline'>{roleLabel(user.orgRole)}</Badge>
                        {user.onProject && (
                          <Badge variant='secondary'>Already on project</Badge>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <div className='space-y-1' data-testid='uat-team-add-role'>
              <Label htmlFor='team-role'>Role on this project</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id='team-role'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_ROLES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {roleLabel(value)}
                      {value === selected.orgRole ? ' (their company role)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-muted-foreground text-xs'>
                What {selected.name.split(' ')[0]} does here. Changing it does
                not change who they are on other projects.
              </p>
            </div>
          )}
        </div>

        <div className='flex justify-end gap-2 pt-2'>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!selected || add.isPending}
            data-testid='uat-team-add-submit'
          >
            {add.isPending && <Loader2 className='mr-1 size-4 animate-spin' />}
            Add to project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
