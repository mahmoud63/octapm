import { useMemo, useState } from 'react'
import {
  Check,
  FileUp,
  Grid3X3,
  List,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useActivities } from '@/features/activities/hooks/use-activities'
import {
  useActivityBoqAllocations,
  useApproveActivityBoqAllocation,
  useSubmitActivityBoqAllocation,
} from '@/features/boq/hooks/use-boq'
import {
  useProject,
  useProjectSetupReadiness,
} from '@/features/projects/hooks/use-projects'
import {
  useAllocationCoverage,
  useMappingSuggestions,
  type CoverageGroupBy,
  type MappingAllocation,
} from '../hooks/use-mapping'
import { CoveragePanel } from './coverage-panel'
import { MappingImportDialog } from './mapping-import-dialog'
import { MappingList } from './mapping-list'
import { MappingMatrix, type CellMode } from './mapping-matrix'

/**
 * Project Controls › Mapping (PC-3): where the bill meets the programme.
 *
 * Matrix or list, grouped by WBS / section / location / cost code /
 * package, with the coverage figures beside it, a mapping-file import, and
 * rule-based suggestions as ghost cells. Approvals are the allocation
 * workflow's own: submit the drafts, approve or reject the submitted rows.
 * Nothing here is authorisation — the buttons follow the permission the API
 * enforces.
 */

type View = 'matrix' | 'list'

/**
 * Allocations go to the ACTIVE activities (owner decision D5): with a
 * revision staged, the matrix says what the schedule is waiting on — its
 * review and approval, or its activation — and where that is done.
 */
const stagedScheduleMessage = (
  revision: { status: string; isActive: boolean } | null | undefined
) => {
  if (!revision || revision.isActive) return undefined
  if (revision.status === 'approved') {
    return 'The approved schedule revision is not active yet. Activate it on Schedule › Revisions, then map the BOQ rows to its activities here.'
  }
  if (['draft', 'under_review', 'rejected'].includes(revision.status)) {
    return 'The schedule revision is not active yet. Submit it for review, approve it and activate it on Schedule › Revisions, then map the BOQ rows to its activities here.'
  }
  return undefined
}

const groupByOptions: Array<{ value: CoverageGroupBy; label: string }> = [
  { value: 'none', label: 'No grouping' },
  { value: 'wbs', label: 'By WBS' },
  { value: 'section', label: 'By section' },
  { value: 'location', label: 'By location' },
  { value: 'costCode', label: 'By cost code' },
  { value: 'package', label: 'By package' },
]

export function MappingPage({ projectId }: { projectId: string }) {
  const { data: project } = useProject(projectId)
  const { data: setupReadiness } = useProjectSetupReadiness(projectId)
  const emptyScheduleMessage = stagedScheduleMessage(
    setupReadiness?.context?.currentRevision
  )
  const currency = project?.currency ?? 'USD'
  const [view, setView] = useState<View>('matrix')
  const [groupBy, setGroupBy] = useState<CoverageGroupBy>('none')
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [mode, setMode] = useState<CellMode>('amount')
  const [showCoverage, setShowCoverage] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const { data: activities = [], isLoading: activitiesLoading } = useActivities(projectId)
  const { data: allocationData, isLoading: allocationsLoading } = useActivityBoqAllocations(projectId)
  const { data: coverage, isLoading: coverageLoading } = useAllocationCoverage(projectId, groupBy)
  const { data: suggestions } = useMappingSuggestions(projectId, showSuggestions)
  const submitAllocation = useSubmitActivityBoqAllocation(projectId)
  const approveAllocation = useApproveActivityBoqAllocation(projectId)
  const canCreate = useCanPerform('boq', 'create', 'allocation.create')
  const canUpdate = useCanPerform('boq', 'update', 'allocation.update')
  const canSubmit = useCanPerform('boq', 'submit', 'allocation.submit')
  const canApprove = useCanPerform('boq', 'approve', 'allocation.approve')

  // The allocation list is typed for the BOQ panel; the mapping views read
  // the PC-3 fields the API now returns beside the old ones.
  const allocations = useMemo(
    () => ((allocationData?.allocations ?? []) as unknown as MappingAllocation[]),
    [allocationData]
  )
  const drafts = useMemo(() => allocations.filter((row) => row.status === 'draft' && row.isActive), [allocations])
  const submitted = useMemo(() => allocations.filter((row) => row.status === 'submitted' && row.isActive), [allocations])
  const [busy, setBusy] = useState(false)

  const runAll = async (rows: MappingAllocation[], action: (id: string) => Promise<unknown>, verb: string) => {
    if (rows.length === 0) return
    setBusy(true)
    let done = 0
    try {
      for (const row of rows) {
        try {
          await action(row.id)
          done += 1
        } catch {
          // The hook already reported the refusal; the rest still go through.
        }
      }
    } finally {
      setBusy(false)
    }
    toast.success(`${done} of ${rows.length} ${verb}`)
  }

  const isLoading = activitiesLoading || allocationsLoading || coverageLoading

  return (
    <div className='space-y-3' data-testid='uat-mapping-page'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='flex rounded-md border'>
          <Button
            variant={view === 'matrix' ? 'secondary' : 'ghost'}
            size='sm'
            className='rounded-r-none'
            onClick={() => setView('matrix')}
            data-testid='uat-mapping-view-matrix'
          >
            <Grid3X3 className='h-4 w-4' />
            Matrix
          </Button>
          <Button
            variant={view === 'list' ? 'secondary' : 'ghost'}
            size='sm'
            className='rounded-l-none'
            onClick={() => setView('list')}
            data-testid='uat-mapping-view-list'
          >
            <List className='h-4 w-4' />
            List
          </Button>
        </div>

        <Select
          value={groupBy}
          onValueChange={(value) => {
            setGroupBy(value as CoverageGroupBy)
            setSelectedGroupKey(null)
          }}
        >
          <SelectTrigger className='w-40' data-testid='uat-mapping-groupby'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groupByOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {view === 'matrix' && (
          <Select value={mode} onValueChange={(value) => setMode(value as CellMode)}>
            <SelectTrigger className='w-32' data-testid='uat-mapping-mode'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='amount'>Cells: amount</SelectItem>
              <SelectItem value='quantity'>Cells: quantity</SelectItem>
            </SelectContent>
          </Select>
        )}

        {view === 'matrix' && (
          <label className='flex items-center gap-2 text-xs'>
            <Switch
              checked={showSuggestions}
              onCheckedChange={setShowSuggestions}
              aria-label='Show suggestions'
              data-testid='uat-mapping-suggestions-toggle'
            />
            <Sparkles className='h-3.5 w-3.5 text-violet-500' />
            Suggestions
            {showSuggestions && suggestions && (
              <span className='text-muted-foreground'>({suggestions.summary.candidates})</span>
            )}
          </label>
        )}

        <div className='ml-auto flex flex-wrap gap-1'>
          {canSubmit && (
            <Button
              size='sm'
              variant='outline'
              disabled={drafts.length === 0 || busy}
              onClick={() => void runAll(drafts, (id) => submitAllocation.mutateAsync(id), 'submitted')}
              data-testid='uat-mapping-submit-all'
            >
              <Send className='h-4 w-4' />
              Submit drafts ({drafts.length})
            </Button>
          )}
          {canApprove && (
            <Button
              size='sm'
              variant='outline'
              disabled={submitted.length === 0 || busy}
              onClick={() => void runAll(submitted, (id) => approveAllocation.mutateAsync(id), 'approved')}
              data-testid='uat-mapping-approve-all'
            >
              <Check className='h-4 w-4' />
              Approve submitted ({submitted.length})
            </Button>
          )}
          {canCreate && (
            <Button size='sm' variant='outline' onClick={() => setImportOpen(true)} data-testid='uat-mapping-import-open'>
              <FileUp className='h-4 w-4' />
              Import
            </Button>
          )}
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setShowCoverage((value) => !value)}
            title={showCoverage ? 'Hide coverage' : 'Show coverage'}
            data-testid='uat-mapping-coverage-toggle'
          >
            {showCoverage ? <PanelRightClose className='h-4 w-4' /> : <PanelRightOpen className='h-4 w-4' />}
          </Button>
        </div>
      </div>

      <div className={cn('grid gap-3', showCoverage && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
        <div className='min-w-0 rounded-lg border bg-card'>
          {isLoading || !coverage ? (
            <div className='space-y-2 p-4'>
              <Skeleton className='h-6 w-full' />
              <Skeleton className='h-6 w-full' />
              <Skeleton className='h-6 w-2/3' />
            </div>
          ) : view === 'matrix' ? (
            <MappingMatrix
              projectId={projectId}
              currency={currency}
              coverage={coverage}
              allocations={allocations}
              activities={activities}
              suggestions={suggestions}
              showSuggestions={showSuggestions}
              selectedGroupKey={selectedGroupKey}
              mode={mode}
              canCreate={canCreate}
              canUpdate={canUpdate}
              emptyScheduleMessage={emptyScheduleMessage}
            />
          ) : (
            <MappingList
              projectId={projectId}
              allocations={allocations}
              currency={currency}
              isLoading={allocationsLoading}
            />
          )}
        </div>
        {showCoverage && (
          <aside className='rounded-lg border bg-card'>
            <CoveragePanel
              projectId={projectId}
              summary={coverage}
              isLoading={coverageLoading}
              groupBy={groupBy}
              currency={currency}
              selectedGroupKey={selectedGroupKey}
              onSelectGroup={setSelectedGroupKey}
            />
          </aside>
        )}
      </div>

      <MappingImportDialog
        projectId={projectId}
        open={importOpen}
        onOpenChange={setImportOpen}
        currency={currency}
      />
    </div>
  )
}
