import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useProjectTeam } from '@/features/permissions/hooks/use-permissions'
import { useDistributePunchItems } from '../hooks/use-punch'

/**
 * Emails the list to subcontractors (every active member of the company on
 * this project) and/or named people, and stamps the items as distributed.
 */
export function PunchDistributeDialog({
  projectId,
  open,
  onOpenChange,
  itemIds,
  defaultCompanyIds = [],
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Specific items; when empty every open item for the chosen companies goes. */
  itemIds?: string[]
  defaultCompanyIds?: string[]
}) {
  const { data: team, isLoading } = useProjectTeam(projectId, {
    enabled: open,
  })
  const [companyIds, setCompanyIds] = useState<string[]>(defaultCompanyIds)
  const [userIds, setUserIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const distribute = useDistributePunchItems(projectId)

  const companies = (team?.parties ?? []).filter((party) => party.companyId)
  const members = team?.items ?? []
  const toggle = (
    list: string[],
    setList: (next: string[]) => void,
    id: string,
    checked: boolean
  ) =>
    setList(
      checked ? [...new Set([...list, id])] : list.filter((x) => x !== id)
    )

  const submit = async () => {
    try {
      const result = await distribute.mutateAsync({
        itemIds: itemIds?.length ? itemIds : undefined,
        companyIds,
        userIds,
        message: message.trim() || null,
      })
      const delivered = result.recipients.filter((r) => r.delivered).length
      toast.success(
        `${result.items} item${result.items === 1 ? '' : 's'} sent to ${delivered} of ${result.recipients.length} recipient${result.recipients.length === 1 ? '' : 's'}`
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const scope = itemIds?.length
    ? `${itemIds.length} selected item${itemIds.length === 1 ? '' : 's'}`
    : 'every open item assigned to the chosen companies'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-lg'
        data-testid='uat-punch-distribute-dialog'
      >
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Send className='h-4 w-4' /> Send the punch list
          </DialogTitle>
          <DialogDescription>
            Emails {scope} with a link back here, and records who received what
            on each item.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Loading the team…
          </div>
        ) : (
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>Companies</Label>
              {companies.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  No companies are set up as project parties yet.
                </p>
              ) : (
                <ul className='max-h-40 space-y-1 overflow-y-auto rounded border p-2'>
                  {companies.map((party) => (
                    <li key={party.id}>
                      <label className='flex items-center gap-2 text-sm'>
                        <Checkbox
                          checked={companyIds.includes(party.companyId!)}
                          onCheckedChange={(checked) =>
                            toggle(
                              companyIds,
                              setCompanyIds,
                              party.companyId!,
                              checked === true
                            )
                          }
                          data-testid='uat-punch-distribute-company'
                        />
                        <span className='flex-1'>
                          {party.companyName ?? 'Unnamed company'}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {party.role.replace(/_/g, ' ')} · {party.memberCount}{' '}
                          member{party.memberCount === 1 ? '' : 's'}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className='space-y-2'>
              <Label>People</Label>
              <ul className='max-h-40 space-y-1 overflow-y-auto rounded border p-2'>
                {members.map((member) => (
                  <li key={member.userId}>
                    <label className='flex items-center gap-2 text-sm'>
                      <Checkbox
                        checked={userIds.includes(member.userId)}
                        onCheckedChange={(checked) =>
                          toggle(
                            userIds,
                            setUserIds,
                            member.userId,
                            checked === true
                          )
                        }
                      />
                      <span className='flex-1'>{member.name}</span>
                      <span className='text-xs text-muted-foreground'>
                        {member.party?.companyName ??
                          member.assignmentRole?.replace(/_/g, ' ') ??
                          ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <div className='space-y-1'>
              <Label htmlFor='punch-distribute-message'>Message</Label>
              <Textarea
                id='punch-distribute-message'
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={3}
                placeholder='e.g. Please close these before the handover walk on Friday.'
                maxLength={2000}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              distribute.isPending ||
              (companyIds.length === 0 && userIds.length === 0)
            }
            data-testid='uat-punch-distribute-send'
          >
            {distribute.isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <Send className='mr-2 h-4 w-4' />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
