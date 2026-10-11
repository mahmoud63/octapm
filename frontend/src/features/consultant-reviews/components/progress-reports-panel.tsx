import { useEffect, useState } from 'react'
import { FilePlus2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { AttachmentPanel } from '@/features/attachments/components/attachment-panel'
import { type ProgressReport, useCreateProgressReport, useIsExternalParty, useProgressReports, useUpdateProgressReport } from '../hooks/use-external-reviews'
import { formatDay } from '../lib/duration'
import { ExternalReviewPanel } from './submit-to-consultant'

const thisMonth = () => new Date().toISOString().slice(0, 7)

function ReportSheet({ projectId, report, onClose }: { projectId: string; report: ProgressReport; onClose: () => void }) {
  const update = useUpdateProgressReport(projectId)
  const canUpdateReport = useCanPerform('report', 'update')
  const external = useIsExternalParty()
  const canEdit = canUpdateReport && !external
  const [title, setTitle] = useState(report.title)
  const [summary, setSummary] = useState(report.summary || '')
  const [preview, setPreview] = useState(false)
  useEffect(() => {
    setTitle(report.title)
    setSummary(report.summary || '')
  }, [report])
  const dirty = title !== report.title || summary !== (report.summary || '')
  return (
    <Sheet open onOpenChange={(value) => !value && onClose()}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-2xl' data-testid='uat-progress-report-sheet'>
        <SheetHeader>
          <SheetTitle>{report.ref} · {report.title}</SheetTitle>
          <SheetDescription>Revision {report.revision} · {report.status === 'issued' ? 'Issued for review' : 'Draft'} · period {report.period}</SheetDescription>
        </SheetHeader>
        <div className='space-y-4 px-4 pb-8'>
          <ExternalReviewPanel projectId={projectId} sourceType='progress_report' sourceId={report.id} label={report.title} />
          <div className='flex gap-2'>
            <Button size='sm' variant={preview ? 'outline' : 'default'} onClick={() => setPreview(false)} disabled={!canEdit}>Edit</Button>
            <Button size='sm' variant={preview ? 'default' : 'outline'} onClick={() => setPreview(true)}>Preview</Button>
          </div>
          {preview || !canEdit ? (
            <article className='space-y-2 rounded-md border p-4'>
              <h3 className='text-lg font-semibold'>{title}</h3>
              <p className='text-xs text-muted-foreground'>Revision {report.revision} · {report.period}</p>
              <p className='text-sm whitespace-pre-wrap'>{summary || 'No content yet.'}</p>
            </article>
          ) : (
            <div className='space-y-3'>
              <div className='space-y-1.5'><Label htmlFor='report-title'>Title</Label><Input id='report-title' value={title} onChange={(event) => setTitle(event.target.value)} /></div>
              <div className='space-y-1.5'><Label htmlFor='report-body'>Report content</Label><Textarea id='report-body' rows={14} value={summary} onChange={(event) => setSummary(event.target.value)} /></div>
              <Button size='sm' disabled={!dirty || update.isPending} onClick={async () => {
                try {
                  await update.mutateAsync({ id: report.id, title, summary })
                  toast.success('Report saved')
                } catch (error) {
                  toast.error(getServerErrorMessage(error))
                }
              }}>{update.isPending && <Loader2 className='h-4 w-4 animate-spin' />} Save</Button>
              <p className='text-[11px] text-muted-foreground'>An issued revision cannot be edited: create a revision on its consultant review first.</p>
            </div>
          )}
          <AttachmentPanel projectId={projectId} recordType='progress_report' recordId={report.id} compact />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Progress reports the contractor issues to the consultant (Reports module). */
export function ProgressReportsPanel({ projectId, initialRecordId = null }: { projectId: string; initialRecordId?: string | null }) {
  const canRead = useCanPerform('report', 'read')
  const canCreateReport = useCanPerform('report', 'create')
  const external = useIsExternalParty()
  const canCreate = canCreateReport && !external
  const { data } = useProgressReports(projectId, canRead)
  const create = useCreateProgressReport(projectId)
  const [openId, setOpenId] = useState<string | null>(initialRecordId)
  const [creating, setCreating] = useState(false)
  const [period, setPeriod] = useState(thisMonth())
  if (!canRead) return null
  const open = data?.items.find((row) => row.id === openId) ?? null
  return (
    <section className='space-y-2 rounded-md border p-3' data-testid='uat-progress-reports'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='text-sm font-semibold'>Progress reports</h3>
        <span className='text-xs text-muted-foreground'>Monthly reports issued to the consultant for review, with every revision kept.</span>
        {canCreate && <Button size='sm' variant='outline' className='ms-auto h-7 text-xs' onClick={() => setCreating(true)}><FilePlus2 className='h-3.5 w-3.5' /> New monthly report</Button>}
      </div>
      {!data?.items.length ? (
        <p className='text-xs text-muted-foreground'>No progress report yet.</p>
      ) : (
        <ul className='divide-y rounded-md border'>
          {data.items.map((report) => (
            <li key={report.id}>
              <button type='button' className='flex w-full flex-wrap items-center gap-x-3 px-3 py-2 text-left text-sm hover:bg-muted/40' onClick={() => setOpenId(report.id)} data-testid={`uat-progress-report-${report.ref}`}>
                <span className='font-mono text-xs'>{report.ref}</span>
                <span className='font-medium'>{report.title}</span>
                <span className='text-xs text-muted-foreground'>revision {report.revision} · {report.status === 'issued' ? 'issued' : 'draft'} · updated {formatDay(report.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ReportSheet projectId={projectId} report={open} onClose={() => setOpenId(null)} />}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New monthly progress report</DialogTitle><DialogDescription>Write it, attach the files, then submit it to the consultant from the report.</DialogDescription></DialogHeader>
          <div className='space-y-1.5'><Label htmlFor='report-period'>Month</Label><Input id='report-period' type='month' value={period} onChange={(event) => setPeriod(event.target.value)} /></div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreating(false)}>Cancel</Button>
            <Button disabled={!period || create.isPending} onClick={async () => {
              try {
                const created = await create.mutateAsync({ period })
                setCreating(false)
                setOpenId(created.id)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
