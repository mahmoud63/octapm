import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileSpreadsheet, Plus } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Main } from '@/components/layout/main'
import { useProjects } from '@/features/projects/hooks/use-projects'
import { ReportAsk } from './components/report-ask'
import {
  ReportEditor,
  blankDefinition,
  definitionFrom,
} from './components/report-editor'
import {
  useReport,
  useReports,
  type ReportDefinition,
  type ReportDefinitionInput,
} from './hooks/use-report-builder'

const VISIBILITY_LABEL = {
  private: 'Only me',
  project: 'Project',
  org: 'Organisation',
} as const

/**
 * Reports (OCTA-RPT-BUILDER-023): saved reports on the left, the builder on
 * the right. `?reportId=` opens a report; `?runId=` highlights a delivery.
 */
export function ReportBuilderPage({
  reportId,
  runId,
}: {
  reportId?: string | null
  runId?: string | null
}) {
  const navigate = useNavigate()
  const { data, isLoading } = useReports()
  const { data: selected } = useReport(reportId ?? null)
  const { data: projectsData } = useProjects()
  const canCreate = useCanPerform('report', 'create')
  const [draftKey, setDraftKey] = useState(0)
  const [newSource, setNewSource] = useState<string | null>(null)
  const [seed, setSeed] = useState<{
    definition: ReportDefinitionInput
    key: number
  } | null>(null)
  const sources = data?.sources ?? []
  const projects = useMemo(
    () =>
      (projectsData?.items ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        currency: project.currency,
      })),
    [projectsData]
  )
  const open = (id: string | null) =>
    navigate({ to: '/reports', search: id ? { reportId: id } : {} })
  const isNew = !reportId
  const source =
    sources.find((item) => item.key === (newSource ?? sources[0]?.key)) ?? null

  return (
    <Main>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Reports
          </h1>
          <p className='text-muted-foreground'>
            Build a report on any register — columns, filters, grouping, chart —
            then export it, share it or have it delivered on a schedule.
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => {
              setDraftKey((value) => value + 1)
              setSeed(null)
              open(null)
            }}
            data-testid='uat-report-new'
          >
            <Plus className='mr-1 h-4 w-4' /> New report
          </Button>
        )}
      </div>
      <Separator className='my-4' />
      <div className='grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]'>
        <aside className='space-y-2' data-testid='uat-report-list'>
          {isLoading && (
            <p className='text-sm text-muted-foreground'>Loading reports…</p>
          )}
          {!isLoading && !(data?.items.length ?? 0) && (
            <p className='rounded-md border border-dashed p-3 text-sm text-muted-foreground'>
              No saved reports yet.
            </p>
          )}
          {(data?.items ?? []).map((report: ReportDefinition) => (
            <button
              key={report.id}
              type='button'
              onClick={() => open(report.id)}
              className={cn(
                'w-full rounded-md border p-2 text-left text-sm hover:bg-muted',
                report.id === reportId && 'border-primary bg-primary/5'
              )}
              data-testid='uat-report-item'
            >
              <p className='flex items-center gap-2 font-medium'>
                <FileSpreadsheet className='h-4 w-4 text-muted-foreground' />
                <span className='truncate'>{report.name}</span>
              </p>
              <p className='mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground'>
                <span>{report.sourceLabel}</span>
                <span>· {report.project?.name ?? 'all projects'}</span>
                <Badge variant='outline' className='h-4 px-1 text-[10px]'>
                  {VISIBILITY_LABEL[report.visibility]}
                </Badge>
                {report.scheduleCount > 0 && (
                  <Badge variant='secondary' className='h-4 px-1 text-[10px]'>
                    scheduled
                  </Badge>
                )}
              </p>
            </button>
          ))}
        </aside>
        <section className='min-w-0'>
          {isNew ? (
            sources.length ? (
              <div className='space-y-3'>
                <ReportAsk
                  projects={projects}
                  onUse={(definition) => {
                    setNewSource(definition.source)
                    setSeed({ definition, key: Date.now() })
                  }}
                />
                <div
                  className='flex flex-wrap gap-1'
                  data-testid='uat-report-source-picker'
                >
                  {sources.map((item) => (
                    <Button
                      key={item.key}
                      size='sm'
                      variant={item.key === source?.key ? 'default' : 'outline'}
                      className='h-7'
                      onClick={() => setNewSource(item.key)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <ReportEditor
                  key={`new-${draftKey}-${seed?.key ?? ''}-${source?.key ?? ''}`}
                  sources={sources}
                  projects={projects}
                  initial={
                    seed && seed.definition.source === source?.key
                      ? seed.definition
                      : blankDefinition(source)
                  }
                  report={null}
                  onSaved={(saved) => open(saved.id)}
                  onDeleted={() => open(null)}
                />
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>Loading sources…</p>
            )
          ) : selected && sources.length ? (
            <ReportEditor
              key={`${selected.id}-${selected.updatedAt ?? ''}`}
              sources={sources}
              projects={projects}
              initial={definitionFrom(selected)}
              report={selected}
              highlightRunId={runId}
              onSaved={(saved) => open(saved.id)}
              onDeleted={() => open(null)}
            />
          ) : (
            <p className='text-sm text-muted-foreground'>Loading report…</p>
          )}
        </section>
      </div>
    </Main>
  )
}
