import { useState } from 'react'
import { Boxes, Upload } from 'lucide-react'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useBim5dOverview } from '../hooks/use-bim-5d'
import { ImportModelDialog } from './bim-5d-import'

/**
 * The BIM / 5D summary on the Project Overview: current revision, mapping
 * coverage and the commercial flags, each from the BIM/5D overview. Shown to
 * someone who can read BIM; the BOQ-based figures only to a BOQ reader.
 */
export function Bim5dSummaryCard({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const canRead = useCanPerform('bim', 'read')
  const canCreate = useCanPerform('bim', 'create')
  const { data, isError } = useBim5dOverview(projectId, canRead)
  const [importing, setImporting] = useState<{ base: string | null } | null>(null)
  if (!canRead || isError || !data) return null
  const dialog = (
    <ImportModelDialog projectId={projectId} open={importing !== null} baseModelId={importing?.base ?? null} onClose={() => setImporting(null)} />
  )
  if (!data.models.count) {
    // No model yet: worth a card only for someone who can import one.
    if (!canCreate) return null
    return (
      <Card data-testid='uat-bim5d-summary-card'>
        <CardHeader className='flex flex-row items-center justify-between gap-2 space-y-0 pb-2'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Boxes className='h-4 w-4 text-muted-foreground' aria-hidden />
            BIM / 5D
          </CardTitle>
          <Button size='sm' onClick={() => setImporting({ base: null })} data-testid='uat-bim5d-summary-upload'>
            <Upload className='h-4 w-4' /> Upload Model
          </Button>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>No BIM model yet. Import the project's IFC model to map its elements to locations, activities and BOQ items and reconcile its quantities.</p>
        </CardContent>
        {dialog}
      </Card>
    )
  }
  const alert = (key: string) => data.alerts.find((row) => row.key === key)?.count ?? 0
  const changed = alert('BIM_CHANGED_AFTER_CERTIFICATION')
  const recon = data.reconciliation
  const stats: Array<{ label: string; value: React.ReactNode; tone?: string; testId: string }> = [
    { label: 'Revision', value: data.models.current.map((model) => `${model.name} ${model.revision}`).join(', ') || '—', testId: 'revision' },
    { label: 'Mapped', value: `${data.elements.mappedPct}%`, testId: 'mapped' },
    { label: 'Unmapped', value: data.elements.unmapped, tone: data.elements.unmapped ? 'text-amber-700 dark:text-amber-400' : undefined, testId: 'unmapped' },
    ...(recon
      ? [
          { label: 'Potential variations', value: recon.potentialVariations, tone: recon.potentialVariations ? 'text-amber-700 dark:text-amber-400' : undefined, testId: 'variations' },
          { label: 'Changed after certification', value: changed, tone: changed ? 'text-red-700 dark:text-red-400' : undefined, testId: 'changed' },
          { label: 'Reconciliation', value: `${recon.MATCHED} matched · ${recon.OVER_CONTRACT + recon.UNDER_CONTRACT + recon.BELOW_CERTIFIED + recon.RULE_ISSUES} to review · ${recon.UNMAPPED} unmapped`, testId: 'reconciliation' },
        ]
      : []),
  ]
  return (
    <Card data-testid='uat-bim5d-summary-card'>
      <CardHeader className='flex flex-row items-center justify-between gap-2 space-y-0 pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Boxes className='h-4 w-4 text-muted-foreground' aria-hidden />
          BIM / 5D
        </CardTitle>
        <div className='flex flex-wrap gap-2'>
          {canCreate && (
            <Button size='sm' variant='ghost' onClick={() => setImporting({ base: data.models.current[0]?.id ?? null })} data-testid='uat-bim5d-summary-upload'>
              <Upload className='h-4 w-4' /> Upload New Revision
            </Button>
          )}
          <Button size='sm' variant='outline' onClick={onOpen} data-testid='uat-bim5d-summary-open'>
            Open BIM / 5D
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6'>
          {stats.map((stat) => (
            <div key={stat.label} className='min-w-0' data-testid={`uat-bim5d-summary-${stat.testId}`}>
              <dt className='text-xs text-muted-foreground'>{stat.label}</dt>
              <dd className={cn('font-semibold tabular-nums break-words', stat.tone)}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      {dialog}
    </Card>
  )
}
