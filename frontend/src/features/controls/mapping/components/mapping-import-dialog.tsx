import { useRef, useState } from 'react'
import { FileUp, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import {
  useMappingImport,
  useUndoMappingImport,
  type ImportReport,
  type ImportReportRow,
} from '../hooks/use-mapping'

/**
 * Mapping-file import: pick a workbook, see what an apply would do (rows
 * matched, codes nobody has, pairs already allocated, capacity breaches,
 * rows on not-applicable items), then apply it as import drafts under one
 * batch — which the same dialog can undo.
 */

type Props = {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
}

const fmtMoney = (currency: string, value: number) =>
  `${currency} ${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`

function ReportRows({
  title,
  rows,
  tone,
}: {
  title: string
  rows: ImportReportRow[]
  tone?: string
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <h4 className={`text-xs font-medium uppercase tracking-wide ${tone ?? 'text-muted-foreground'}`}>
        {title} ({rows.length})
      </h4>
      <ul className='mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs'>
        {rows.slice(0, 20).map((row, index) => (
          <li key={`${row.rowIndex}-${index}`} className='flex gap-2'>
            <span className='w-10 shrink-0 text-muted-foreground'>
              row {row.rowIndex}
            </span>
            <span className='truncate'>
              {row.boqCode ?? ''} → {row.activityCode ?? ''}{' '}
              {row.basis ? `(${row.basis})` : ''}{' '}
              <span className='text-muted-foreground'>
                {row.reason ?? row.message ?? row.code ?? ''}
              </span>
            </span>
          </li>
        ))}
        {rows.length > 20 && (
          <li className='text-muted-foreground'>… and {rows.length - 20} more</li>
        )}
      </ul>
    </div>
  )
}

export function MappingImportDialog({
  projectId,
  open,
  onOpenChange,
  currency,
}: Props) {
  const importMapping = useMappingImport(projectId)
  const undoImport = useUndoMappingImport(projectId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [lastBatchId, setLastBatchId] = useState<string | null>(null)

  const reset = () => {
    setFile(null)
    setReport(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const run = async (dryRun: boolean) => {
    if (!file) return
    const result = await importMapping.mutateAsync({ file, dryRun })
    setReport(result)
    if (!dryRun && result.batchId) {
      setLastBatchId(result.batchId)
    }
  }

  const undo = async () => {
    if (!lastBatchId) return
    await undoImport.mutateAsync(lastBatchId)
    setLastBatchId(null)
    setReport(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className='max-w-2xl' data-testid='uat-mapping-import-dialog'>
        <DialogHeader>
          <DialogTitle>Import a mapping file</DialogTitle>
          <DialogDescription>
            A workbook with <code>boq_code</code>, <code>activity_code</code>{' '}
            and one of <code>quantity</code>, <code>amount</code> or{' '}
            <code>weight</code> per row. Preview first; apply creates import
            drafts you can undo as one batch.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <Input
            ref={fileInput}
            type='file'
            accept='.xlsx,.xls,.csv'
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setReport(null)
            }}
            data-testid='uat-mapping-import-file'
          />

          {report && (
            <div className='space-y-3 rounded-md border p-3' data-testid='uat-mapping-import-report'>
              <div className='flex flex-wrap items-center gap-1'>
                <Badge variant={report.dryRun ? 'secondary' : 'default'}>
                  {report.dryRun ? 'Preview' : 'Applied'}
                </Badge>
                <Badge variant='outline'>{report.rowCount} rows</Badge>
                <Badge variant='outline'>{report.summary.matched} matched</Badge>
                {report.summary.existing > 0 && (
                  <Badge variant='outline'>{report.summary.existing} existing</Badge>
                )}
                {report.summary.unmatched > 0 && (
                  <Badge variant='destructive'>{report.summary.unmatched} unmatched</Badge>
                )}
                {report.summary.breaches > 0 && (
                  <Badge variant='destructive'>{report.summary.breaches} over capacity</Badge>
                )}
                {report.summary.notApplicable > 0 && (
                  <Badge variant='outline'>{report.summary.notApplicable} n/a</Badge>
                )}
                {report.summary.invalid > 0 && (
                  <Badge variant='destructive'>{report.summary.invalid} invalid</Badge>
                )}
                {!report.dryRun && (
                  <Badge>{report.summary.created} created</Badge>
                )}
                <span className='ml-auto text-xs text-muted-foreground'>
                  {fmtMoney(currency, report.summary.totalAmount)} matched value
                </span>
              </div>
              <ReportRows title='Matched' rows={report.matched} tone='text-emerald-600' />
              <ReportRows title='Already allocated' rows={report.existing} />
              <ReportRows title='Not found' rows={report.unmatched} tone='text-destructive' />
              <ReportRows title='Over capacity' rows={report.breaches} tone='text-destructive' />
              <ReportRows title='Not applicable items' rows={report.notApplicable} />
              <ReportRows title='Invalid rows' rows={report.invalid} tone='text-destructive' />
              <ReportRows title='Refused on write' rows={report.failed} tone='text-destructive' />
            </div>
          )}
        </div>

        <DialogFooter className='flex-wrap gap-2'>
          {lastBatchId && (
            <Button
              variant='outline'
              onClick={() => void undo()}
              disabled={undoImport.isPending}
              className='mr-auto'
              data-testid='uat-mapping-import-undo'
            >
              <Undo2 className='h-4 w-4' />
              Undo last batch
            </Button>
          )}
          <Button
            variant='outline'
            onClick={() => void run(true)}
            disabled={!file || importMapping.isPending}
            data-testid='uat-mapping-import-preview'
          >
            Preview
          </Button>
          <Button
            onClick={() => void run(false)}
            disabled={!file || importMapping.isPending || (report !== null && !report.dryRun)}
            data-testid='uat-mapping-import-apply'
          >
            <FileUp className='h-4 w-4' />
            Apply as drafts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
