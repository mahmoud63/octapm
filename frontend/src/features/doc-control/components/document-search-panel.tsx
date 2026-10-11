import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ExternalLink,
  FileSearch,
  FileText,
  FileWarning,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { DocumentAsk, type DocumentAskPreset } from '@/features/ai/components/document-ask'
import {
  useDocumentIndexStatus,
  useDocumentSearch,
  useReindexDocuments,
  type DocumentSearchHit,
} from '../hooks/use-document-search'

const DEBOUNCE_MS = 350

const RECORD_LABELS: Record<string, string> = {
  rfi: 'RFI',
  submittal: 'Submittal',
  drawing: 'Drawing',
  transmittal: 'Transmittal',
  correspondence: 'Correspondence',
  ncr: 'NCR',
  itp: 'ITP',
  defect: 'Defect',
  safety_incident: 'Safety',
  material_test: 'Material test',
  change_order: 'Change order',
  ipc: 'IPC',
  ipc_certificate: 'IPC',
  sub_valuation: 'Sub valuation',
  eot: 'EOT',
  risk: 'Risk',
  task: 'Task',
  meeting: 'Meeting',
  daily_report: 'Daily report',
  site_diary: 'Site diary',
}

const recordLabel = (recordType: string) =>
  RECORD_LABELS[recordType] ??
  recordType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const formatBytes = (value: number) => {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const fileKind = (mimeType: string, fileName: string) => {
  const lower = `${mimeType} ${fileName}`.toLowerCase()
  if (lower.includes('pdf')) return 'PDF'
  if (lower.includes('word') || lower.endsWith('.docx')) return 'Word'
  if (
    lower.includes('sheet') ||
    lower.includes('excel') ||
    /\.xlsx?$/.test(lower)
  )
    return 'Excel'
  if (lower.includes('presentation') || lower.endsWith('.pptx')) return 'Slides'
  if (
    lower.includes('text') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.csv')
  )
    return 'Text'
  return 'File'
}

/** Renders a `[[match]]` headline with the matches emphasised. */
function Snippet({ value }: { value: string | null }) {
  if (!value) return null
  const parts = value.split(/(\[\[[^\]]*\]\])/g)
  return (
    <p className='text-sm text-muted-foreground'>
      {parts.map((part, index) =>
        part.startsWith('[[') && part.endsWith(']]') ? (
          <mark
            key={index}
            className='rounded bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30'
          >
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </p>
  )
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

function RecordChip({
  recordType,
  recordId,
  path,
  suffix,
}: {
  recordType: string
  recordId: string
  path: string | null
  suffix?: ReactNode
}) {
  const label = (
    <>
      {recordLabel(recordType)}
      {suffix}
    </>
  )
  if (!path) {
    return (
      <Badge variant='outline' className='font-normal' title={recordId}>
        {label}
      </Badge>
    )
  }
  return (
    <Link to={path} title={recordId}>
      <Badge variant='outline' className='font-normal hover:bg-accent'>
        {label}
      </Badge>
    </Link>
  )
}

// One-click document questions (AI-6); typing in the box is Find Clause / Topic.
const SUMMARIZE_PRESET: DocumentAskPreset = {
  label: 'Summarize',
  question: 'Summarize this document: its purpose, key requirements, quantities, dates and obligations.',
  mode: 'summary',
}
const COMPARE_PRESET: DocumentAskPreset = {
  label: 'Compare Documents',
  question: 'Compare these documents: where they agree, where they differ, and any requirement one states that the other contradicts or omits.',
  mode: 'compare',
}

function HitCard({
  hit,
  projectId,
  selected,
  onSelect,
}: {
  hit: DocumentSearchHit
  projectId: string
  selected: boolean
  onSelect: (selected: boolean) => void
}) {
  const [asking, setAsking] = useState(false)
  return (
    <li
      data-testid='uat-document-search-hit'
      className='space-y-2 rounded-md border bg-background p-3'
    >
      <div className='flex flex-wrap items-start gap-2'>
        <FileText className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium'>{hit.title}</p>
          <p className='truncate text-xs text-muted-foreground'>
            {[
              hit.documentNumber,
              hit.fileName,
              fileKind(hit.mimeType, hit.fileName),
              formatBytes(hit.sizeBytes),
              hit.text?.pageCount ? `${hit.text.pageCount} pages` : null,
              hit.uploadedAt
                ? new Date(hit.uploadedAt).toLocaleDateString()
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className='flex items-center gap-1'>
          {hit.semanticScore !== null && (
            <Badge
              variant='secondary'
              className='gap-1 font-normal'
              title='Meaning match from embeddings'
            >
              <Sparkles className='h-3 w-3' />
              {Math.round(hit.semanticScore * 100)}%
            </Badge>
          )}
          <label className='flex items-center gap-1 px-1 text-xs text-muted-foreground'>
            <input
              type='checkbox'
              checked={selected}
              onChange={(event) => onSelect(event.target.checked)}
              data-testid='uat-document-compare-select'
            />
            Compare
          </label>
          <Button
            size='sm'
            variant={asking ? 'secondary' : 'ghost'}
            onClick={() => setAsking((value) => !value)}
            aria-expanded={asking}
            data-testid='uat-document-ask-toggle'
          >
            <Sparkles className='mr-1.5 h-3.5 w-3.5 text-primary' />
            Ask This Document
          </Button>
          <Button asChild size='sm' variant='outline'>
            <a href={hit.fileUrl} target='_blank' rel='noreferrer'>
              <ExternalLink className='mr-2 h-4 w-4' />
              Open file
            </a>
          </Button>
        </div>
      </div>
      <Snippet value={hit.snippet} />
      {asking && (
        <DocumentAsk
          projectId={projectId}
          documentId={hit.documentId}
          documentTitle={`${hit.title} — find a clause or topic`}
          presets={[SUMMARIZE_PRESET]}
        />
      )}
      {(hit.revision || hit.records.length > 0) && (
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-xs text-muted-foreground'>Linked to</span>
          {hit.revision && (
            <RecordChip
              recordType={hit.revision.recordType}
              recordId={hit.revision.recordId}
              path={hit.path}
              suffix={
                <span className='ml-1 text-muted-foreground'>
                  rev {hit.revision.revision}
                </span>
              }
            />
          )}
          {hit.records.map((record) => (
            <RecordChip
              key={`${record.recordType}:${record.recordId}`}
              recordType={record.recordType}
              recordId={record.recordId}
              path={record.path}
            />
          ))}
        </div>
      )}
    </li>
  )
}

function CoverageCard({ projectId }: { projectId: string }) {
  const canReindex = useCanPerform('document_control', 'update')
  const { data, isLoading } = useDocumentIndexStatus(projectId)
  const reindex = useReindexDocuments(projectId)

  const run = (force: boolean) =>
    reindex.mutate(
      { force },
      {
        onSuccess: (result) =>
          toast.success(
            `${result.queued} document${result.queued === 1 ? '' : 's'} queued for text extraction` +
              (result.unsupported
                ? ` (${result.unsupported} without a text layer)`
                : '')
          ),
        onError: (error) => toast.error(getServerErrorMessage(error)),
      }
    )

  return (
    <div
      className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm'
      data-testid='uat-document-index-status'
    >
      <FileSearch className='h-4 w-4 shrink-0 text-muted-foreground' />
      {isLoading || !data ? (
        <span className='text-muted-foreground'>Checking index coverage…</span>
      ) : (
        <>
          <span>
            <span className='font-medium'>{data.counts.ready}</span>
            <span className='text-muted-foreground'>
              {' '}
              of {data.documents} searchable
            </span>
          </span>
          {data.counts.pending > 0 && (
            <span className='inline-flex items-center gap-1 text-muted-foreground'>
              <Loader2 className='h-3.5 w-3.5 animate-spin' />
              {data.counts.pending} extracting
            </span>
          )}
          {data.counts.unsupported > 0 && (
            <span
              className='inline-flex items-center gap-1 text-muted-foreground'
              title='Scanned PDFs, images and other files without a text layer'
            >
              <FileWarning className='h-3.5 w-3.5' />
              {data.counts.unsupported} without text
            </span>
          )}
          {data.counts.failed > 0 && (
            <span className='text-destructive'>
              {data.counts.failed} failed
            </span>
          )}
          <span className='text-xs text-muted-foreground'>
            {data.embeddings.enabled
              ? `Meaning search on (${data.embeddings.provider})`
              : 'Meaning search off — set an embeddings key to enable'}
          </span>
        </>
      )}
      {canReindex && (
        <div className='ml-auto flex items-center gap-1'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={reindex.isPending}
            onClick={() => run(false)}
            data-testid='uat-document-reindex'
          >
            <RefreshCw
              className={cn(
                'mr-2 h-4 w-4',
                reindex.isPending && 'animate-spin'
              )}
            />
            Index missing
          </Button>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={reindex.isPending}
            onClick={() => run(true)}
            title='Re-extract every document'
          >
            Rebuild
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Doc control › Search: full-text search inside document contents, with
 * highlighted snippets and links to the records each document belongs to.
 */
export function DocumentSearchPanel({ projectId }: { projectId: string }) {
  const [term, setTerm] = useState('')
  const [semantic, setSemantic] = useState(false)
  const debouncedTerm = useDebounced(term, DEBOUNCE_MS)
  const { data: status } = useDocumentIndexStatus(projectId)
  const embeddingsEnabled = Boolean(status?.embeddings.enabled)
  const { data, isFetching, isError, error } = useDocumentSearch(
    projectId,
    debouncedTerm,
    { semantic: semantic && embeddingsEnabled }
  )
  const items = useMemo(() => data?.items ?? [], [data?.items])
  const hasQuery = debouncedTerm.trim().length > 0
  // Documents chosen for Compare Documents (AI-6).
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const toggleCompare = (documentId: string, selected: boolean) => {
    setComparing(false)
    setCompareIds((ids) =>
      selected ? [...new Set([...ids, documentId])].slice(0, 10) : ids.filter((id) => id !== documentId)
    )
  }

  return (
    <div className='space-y-3' data-testid='uat-document-search'>
      <CoverageCard projectId={projectId} />
      {/* Document Q&A inside the Documents module (AI-6). */}
      <DocumentAsk projectId={projectId} className='rounded-md border p-3' />
      {compareIds.length >= 2 && (
        <div className='space-y-2 rounded-md border p-3' data-testid='uat-document-compare'>
          <div className='flex items-center gap-2'>
            <Button size='sm' onClick={() => setComparing(true)} disabled={comparing}>
              <Sparkles className='mr-1.5 h-3.5 w-3.5' />
              Compare Documents ({compareIds.length})
            </Button>
            <Button size='sm' variant='ghost' onClick={() => { setCompareIds([]); setComparing(false) }}>
              Clear
            </Button>
          </div>
          {comparing && (
            <DocumentAsk projectId={projectId} documentIds={compareIds} autoRun={COMPARE_PRESET} documentTitle='the selected documents' />
          )}
        </div>
      )}
      <div className='flex flex-wrap items-end gap-3'>
        <div className='min-w-[240px] flex-1 space-y-1'>
          <Label htmlFor='document-search-term'>Search inside documents</Label>
          <div className='relative'>
            <Search className='pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              id='document-search-term'
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder='e.g. "rebar spacing", curing -formwork, C40 OR C45'
              className='pl-8'
              data-testid='uat-document-search-input'
              autoComplete='off'
            />
          </div>
        </div>
        {embeddingsEnabled && (
          <div className='flex items-center gap-2 pb-2'>
            <Switch
              id='document-search-semantic'
              checked={semantic}
              onCheckedChange={setSemantic}
              data-testid='uat-document-search-semantic'
            />
            <Label
              htmlFor='document-search-semantic'
              className='flex items-center gap-1'
            >
              <Sparkles className='h-3.5 w-3.5' />
              Search by meaning
            </Label>
          </div>
        )}
      </div>

      {!hasQuery ? (
        <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
          Type a word or phrase to search inside PDFs, Word, Excel and
          PowerPoint files on this project. Use quotes for exact phrases, OR
          between alternatives, and a leading minus to exclude a word.
        </p>
      ) : isError ? (
        <p className='rounded-md border p-4 text-sm text-destructive'>
          {getServerErrorMessage(error)}
        </p>
      ) : items.length === 0 && !isFetching ? (
        <p className='rounded-md border p-4 text-sm text-muted-foreground'>
          No documents mention “{debouncedTerm.trim()}”. Files still extracting
          or without a text layer are not searchable yet.
        </p>
      ) : (
        <div className='space-y-2'>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            {isFetching && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
            <span>
              {items.length} match{items.length === 1 ? '' : 'es'}
              {data?.meta.mode === 'hybrid' ? ' · text + meaning' : ''}
            </span>
          </div>
          <ul className='space-y-2'>
            {items.map((hit) => (
              <HitCard
                key={hit.documentId}
                hit={hit}
                projectId={projectId}
                selected={compareIds.includes(hit.documentId)}
                onSelect={(selected) => toggleCompare(hit.documentId, selected)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
