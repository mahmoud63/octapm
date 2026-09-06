import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from '@/components/ui/textarea'
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  useCreateConversation,
  type ConversationKind,
} from '../hooks/use-conversations'
import { PeoplePicker } from './people-picker'

const ORG = '__org__'

/** Start a direct or group conversation, organisation-wide or on a project. */
export function NewConversationDialog({
  open,
  onOpenChange,
  defaultProjectId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string | null
  onCreated: (id: string) => void
}) {
  const create = useCreateConversation()
  const { data: projectsData } = useProjects()
  const [kind, setKind] = useState<ConversationKind>('direct')
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? ORG)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!open) return
    setKind('direct')
    setProjectId(defaultProjectId ?? ORG)
    setTitle('')
    setMessage('')
  }, [open, defaultProjectId])

  const submit = async (userIds: string[]) => {
    try {
      const created = await create.mutateAsync({
        kind,
        projectId: projectId === ORG ? null : projectId,
        title: kind === 'group' ? title.trim() || null : null,
        memberUserIds: userIds,
        message: message.trim() || null,
      })
      onOpenChange(false)
      onCreated(created.id)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-conversation-new'>
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>
            A direct thread with one person, or a group. Scope it to a project
            to keep it with the project's team.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>Kind</Label>
            <div className='flex rounded-md border p-0.5'>
              {(['direct', 'group'] as ConversationKind[]).map((value) => (
                <button
                  key={value}
                  type='button'
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-sm capitalize',
                    kind === value
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  )}
                  onClick={() => setKind(value)}
                  data-testid={`uat-conversation-kind-${value}`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className='space-y-1'>
            <Label>Where</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ORG}>Whole organisation</SelectItem>
                {(projectsData?.items ?? []).map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind === 'group' && (
            <div className='space-y-1 sm:col-span-2'>
              <Label>Title</Label>
              <Input
                value={title}
                maxLength={200}
                placeholder='e.g. L1 slab pour'
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          )}
        </div>
        <PeoplePicker
          key={`${kind}-${projectId}`}
          projectId={projectId === ORG ? null : projectId}
          single={kind === 'direct'}
          onConfirm={submit}
          confirmLabel='Start'
          pending={create.isPending}
        >
          <div className='space-y-1'>
            <Label>First message (optional)</Label>
            <Textarea
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              data-testid='uat-conversation-first-message'
            />
          </div>
        </PeoplePicker>
      </DialogContent>
    </Dialog>
  )
}
