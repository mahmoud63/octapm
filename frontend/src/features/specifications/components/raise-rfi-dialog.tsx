import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { workspaceLink } from '@/features/workflows/hooks/use-workflow-engine'
import { useRaiseSpecRfi } from '../hooks/use-specifications'

/** Raises a draft RFI from a conflict or gap; the section code is attached by the server. */
export function RaiseSpecRfiDialog({
  projectId,
  sectionId,
  sectionCode,
  initial,
  open,
  onOpenChange,
}: {
  projectId: string
  sectionId: string
  sectionCode: string
  initial: { subject: string; question: string; priority?: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const raise = useRaiseSpecRfi(projectId)
  const navigate = useNavigate()
  const [subject, setSubject] = useState('')
  const [question, setQuestion] = useState('')
  const [priority, setPriority] = useState<
    'low' | 'normal' | 'high' | 'urgent'
  >('normal')

  useEffect(() => {
    if (!open) return
    setSubject(initial?.subject ?? '')
    setQuestion(initial?.question ?? '')
    setPriority(
      (initial?.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal'
    )
  }, [open, initial])

  const submit = async () => {
    try {
      const result = await raise.mutateAsync({
        sectionId,
        subject: subject.trim(),
        question: question.trim() || null,
        priority,
      })
      onOpenChange(false)
      const link = workspaceLink(result.url)
      toast.success(`${result.record.ref} drafted`, {
        action: link
          ? {
              label: 'Open',
              onClick: () =>
                navigate({
                  to: '/projects/$projectId',
                  params: { projectId: link.projectId },
                  search: link.search,
                }),
            }
          : undefined,
      })
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='uat-spec-rfi-dialog'>
        <DialogHeader>
          <DialogTitle>Raise an RFI on section {sectionCode}</DialogTitle>
          <DialogDescription>
            A draft RFI tagged with the specification section. Edit it before
            sending, as with any RFI.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className='space-y-1'>
            <Label>Question</Label>
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={6}
            />
          </div>
          <div className='space-y-1'>
            <Label>Priority</Label>
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as typeof priority)}
            >
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['low', 'normal', 'high', 'urgent'] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={subject.trim().length < 3 || raise.isPending}
            onClick={submit}
            data-testid='uat-spec-rfi-submit'
          >
            {raise.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Create draft RFI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
