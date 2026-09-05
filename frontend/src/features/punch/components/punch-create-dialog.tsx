import { useState } from 'react'
import { ListPlus, Loader2 } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  KIND_LABEL,
  useBulkCreatePunchItems,
  useCreatePunchItem,
  type PunchItem,
  type PunchKind,
} from '../hooks/use-punch'
import {
  emptyPunchForm,
  formToPayload,
  parseBulkTitles,
  type PunchFormValue,
} from '../lib/form'
import { PunchItemForm } from './punch-item-form'

/**
 * Creates one item, or many at once from a list of titles with shared
 * defaults — the walk-through case where an inspector lists thirty things in
 * one room for one subcontractor.
 */
export function PunchCreateDialog({
  projectId,
  open,
  onOpenChange,
  initial,
  onCreated,
  kind = 'punch',
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: Partial<PunchFormValue>
  kind?: PunchKind
  onCreated?: (items: PunchItem[]) => void
}) {
  const [tab, setTab] = useState<'single' | 'bulk'>('single')
  const [form, setForm] = useState<PunchFormValue>(() =>
    emptyPunchForm(initial)
  )
  const [bulkText, setBulkText] = useState('')
  const [openNow, setOpenNow] = useState(true)
  const createOne = useCreatePunchItem(projectId)
  const createMany = useBulkCreatePunchItems(projectId)
  const busy = createOne.isPending || createMany.isPending
  const bulkItems = parseBulkTitles(bulkText)

  const submit = async () => {
    try {
      if (tab === 'single') {
        const item = await createOne.mutateAsync({
          ...formToPayload(form, { mode: 'create', kind }),
          kind,
          status: openNow ? 'open' : 'draft',
        })
        toast.success(`${item.ref} ${openNow ? 'opened' : 'saved as draft'}`)
        onCreated?.([item])
      } else {
        const result = await createMany.mutateAsync({
          items: bulkItems,
          defaults: {
            ...formToPayload(form, {
              mode: 'create',
              includeTitle: false,
              kind,
            }),
            kind,
            status: openNow ? 'open' : 'draft',
          },
        })
        toast.success(
          `${result.created} item${result.created === 1 ? '' : 's'} ${openNow ? 'opened' : 'saved as drafts'}`
        )
        onCreated?.(result.items)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const canSubmit =
    tab === 'single'
      ? form.title.trim().length > 0
      : bulkItems.length > 0 && bulkItems.length <= 100

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-punch-create'
      >
        <DialogHeader>
          <DialogTitle>New {KIND_LABEL[kind].toLowerCase()}</DialogTitle>
          <DialogDescription>
            {kind === 'observation'
              ? 'Open it now to notify the responsible company, or keep it as a draft until the walk is done.'
              : 'Open it now to notify the company and assignee, or keep it as a draft until the walk-through is done.'}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
          className='space-y-3'
        >
          <TabsList>
            <TabsTrigger value='single'>One item</TabsTrigger>
            <TabsTrigger value='bulk' data-testid='uat-punch-bulk-tab'>
              <ListPlus className='mr-1.5 h-4 w-4' /> Many at once
            </TabsTrigger>
          </TabsList>
          <TabsContent value='single'>
            <PunchItemForm
              projectId={projectId}
              value={form}
              onChange={setForm}
              kind={kind}
              disabled={busy}
            />
          </TabsContent>
          <TabsContent value='bulk' className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='punch-bulk-text'>One item per line</Label>
              <Textarea
                id='punch-bulk-text'
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                rows={6}
                placeholder={
                  'Touch up paint above skirting\nReplace cracked tile at threshold\nAdjust door closer'
                }
                disabled={busy}
                data-testid='uat-punch-bulk-text'
              />
              <p className='text-xs text-muted-foreground'>
                {bulkItems.length} item{bulkItems.length === 1 ? '' : 's'}
                {bulkItems.length > 100 ? ' — at most 100 per batch' : ''}. The
                fields below apply to every one of them.
              </p>
            </div>
            <PunchItemForm
              projectId={projectId}
              value={form}
              onChange={setForm}
              kind={kind}
              hideTitle
              disabled={busy}
              idPrefix='punch-bulk'
            />
          </TabsContent>
        </Tabs>
        <DialogFooter className='items-center gap-3 sm:justify-between'>
          <label className='flex items-center gap-2 text-sm'>
            <Switch
              checked={openNow}
              onCheckedChange={setOpenNow}
              disabled={busy}
              data-testid='uat-punch-open-now'
            />
            Open now and notify
          </label>
          <div className='flex gap-2'>
            <Button variant='ghost' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!canSubmit || busy}
              data-testid='uat-punch-create-submit'
            >
              {busy && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {tab === 'single'
                ? openNow
                  ? 'Open item'
                  : 'Save draft'
                : `Create ${bulkItems.length || ''} item${bulkItems.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
