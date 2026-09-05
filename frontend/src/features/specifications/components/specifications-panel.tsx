import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ClipboardCheck, Loader2, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import {
  useIndexSpecifications,
  useSpecDocuments,
  useSpecSections,
} from '../hooks/use-specifications'
import { ScopeGapsCard } from './scope-gaps-card'
import { SpecSectionDetail } from './spec-section-detail'

const ALL_DIVISIONS = 'all'

function DocumentsCard({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const { data, isLoading } = useSpecDocuments(projectId)
  const index = useIndexSpecifications(projectId)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const items = data?.items ?? []

  const run = async (ids: string[] | null) => {
    try {
      const result = await index.mutateAsync(ids)
      const failed = result.documents.filter((row) => row.error)
      toast.success(
        `${result.sections} section${result.sections === 1 ? '' : 's'} indexed from ${result.documents.length - failed.length} document${result.documents.length - failed.length === 1 ? '' : 's'}` +
          (failed.length ? ` · ${failed.length} failed` : '')
      )
      setSelected(new Set())
      if (result.sections > 0) onClose()
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <div
      className='space-y-2 rounded-md border p-3'
      data-testid='uat-spec-documents'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <p className='text-sm font-medium'>Specification documents</p>
        <span className='text-xs text-muted-foreground'>
          Documents with extracted text. Likely specifications are listed first;
          index the ones that are.
        </span>
        <Button
          size='sm'
          variant='outline'
          className='ml-auto'
          disabled={index.isPending}
          onClick={() => run(null)}
          title='Index every document whose text reads like a specification'
          data-testid='uat-spec-scan'
        >
          {index.isPending ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <ScanSearch className='mr-2 h-4 w-4' />
          )}
          Find and index
        </Button>
        <Button
          size='sm'
          disabled={!selected.size || index.isPending}
          onClick={() => run([...selected])}
          data-testid='uat-spec-index-selected'
        >
          Index selected ({selected.size})
        </Button>
      </div>
      {isLoading ? (
        <Loader2 className='h-4 w-4 animate-spin' />
      ) : items.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          No document has extracted text yet. Upload the specification and run
          the document index from Doc control › Search.
        </p>
      ) : (
        <ul className='max-h-72 space-y-1 overflow-auto text-sm'>
          {items.map((document) => (
            <li key={document.id} className='flex items-center gap-2'>
              <Checkbox
                checked={selected.has(document.id)}
                onCheckedChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (checked) next.add(document.id)
                    else next.delete(document.id)
                    return next
                  })
                }
              />
              <span className='min-w-0 flex-1 truncate'>
                {document.title}
                {document.documentNumber ? ` · ${document.documentNumber}` : ''}
              </span>
              {document.likelySpec && document.sections === 0 && (
                <Badge variant='secondary' className='text-[10px]'>
                  looks like a spec
                </Badge>
              )}
              {document.sections > 0 && (
                <Badge variant='outline' className='text-[10px]'>
                  {document.sections} section
                  {document.sections === 1 ? '' : 's'}
                </Badge>
              )}
              <span className='text-xs text-muted-foreground'>
                {document.pageCount
                  ? `${document.pageCount} p`
                  : `${document.wordCount} w`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Doc control › Specifications: the section index of the specification,
 * what each section relates to across the project, scope gaps and the
 * spec-vs-drawing conflict check.
 */
export function SpecificationsPanel({
  projectId,
  initialTarget,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
}) {
  const canIndex = useCanPerform('document_control', 'update')
  const [q, setQ] = useState('')
  const [division, setDivision] = useState<string>(ALL_DIVISIONS)
  const { data, isLoading } = useSpecSections(
    projectId,
    q,
    division === ALL_DIVISIONS ? null : division
  )
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTarget?.source === 'spec_section' && initialTarget.recordId
      ? initialTarget.recordId
      : null
  )
  const [view, setView] = useState<'section' | 'gaps'>(
    selectedId ? 'section' : 'gaps'
  )
  const [documentsOpen, setDocumentsOpen] = useState(false)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>()
    for (const section of items) {
      const key = section.division
        ? `${section.division} · ${section.divisionLabel ?? ''}`.trim()
        : 'Other'
      map.set(key, [...(map.get(key) ?? []), section])
    }
    return [...map.entries()]
  }, [items])

  // With nothing indexed yet, open the documents card so the first step is obvious.
  useEffect(() => {
    if (!isLoading && total === 0 && canIndex) setDocumentsOpen(true)
  }, [isLoading, total, canIndex])

  return (
    <div className='space-y-3' data-testid='uat-specifications'>
      <div className='flex flex-wrap items-center gap-2'>
        <BookOpen className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Specifications</p>
          <p className='text-xs text-muted-foreground'>
            {total
              ? `${total} section${total === 1 ? '' : 's'} across ${data?.divisions.filter((row) => row.division).length ?? 0} division${(data?.divisions.length ?? 0) === 1 ? '' : 's'}`
              : 'Index the specification documents to browse sections, see what each covers and check them against the drawings.'}
          </p>
        </div>
        <Button
          size='sm'
          variant={view === 'gaps' ? 'default' : 'outline'}
          onClick={() => setView('gaps')}
          data-testid='uat-spec-view-gaps'
        >
          <ClipboardCheck className='mr-2 h-4 w-4' /> Scope coverage
        </Button>
        {canIndex && (
          <Button
            size='sm'
            variant='outline'
            onClick={() => setDocumentsOpen((value) => !value)}
            data-testid='uat-spec-documents-toggle'
          >
            Documents
          </Button>
        )}
      </div>

      {documentsOpen && canIndex && (
        <DocumentsCard
          projectId={projectId}
          onClose={() => setDocumentsOpen(false)}
        />
      )}

      <div className='grid gap-3 lg:grid-cols-[320px_1fr]'>
        <div className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Code or title'
              value={q}
              onChange={(event) => setQ(event.target.value)}
              data-testid='uat-spec-search'
            />
            <Select value={division} onValueChange={setDivision}>
              <SelectTrigger className='w-28'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DIVISIONS}>All</SelectItem>
                {(data?.divisions ?? [])
                  .filter((row) => row.division)
                  .map((row) => (
                    <SelectItem key={row.division!} value={row.division!}>
                      {row.division} · {row.count}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div
            className='max-h-[70vh] overflow-auto rounded-md border'
            data-testid='uat-spec-sections'
          >
            {isLoading ? (
              <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' /> Loading…
              </div>
            ) : items.length === 0 ? (
              <p className='p-3 text-sm text-muted-foreground'>
                {total ? 'No section matches.' : 'No section indexed yet.'}
              </p>
            ) : (
              grouped.map(([group, sections]) => (
                <div key={group}>
                  <p className='sticky top-0 bg-muted/80 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur'>
                    {group}
                  </p>
                  <ul>
                    {sections.map((section) => (
                      <li key={section.id}>
                        <button
                          type='button'
                          className={cn(
                            'flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50',
                            selectedId === section.id &&
                              view === 'section' &&
                              'bg-muted'
                          )}
                          onClick={() => {
                            setSelectedId(section.id)
                            setView('section')
                          }}
                        >
                          <span className='font-mono text-xs'>
                            {section.code}
                          </span>
                          <span className='min-w-0 flex-1 truncate'>
                            {section.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>

        <div className='min-w-0'>
          {view === 'gaps' || !selectedId ? (
            <ScopeGapsCard
              projectId={projectId}
              onOpenSection={(sectionId) => {
                setSelectedId(sectionId)
                setView('section')
              }}
            />
          ) : (
            <SpecSectionDetail projectId={projectId} sectionId={selectedId} />
          )}
        </div>
      </div>
    </div>
  )
}
