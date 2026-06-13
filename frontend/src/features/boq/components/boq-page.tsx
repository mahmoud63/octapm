import { Main } from '@/components/layout/main'
import { AuditHistoryPanel } from '@/features/audit/components/audit-history-panel'
import { useProject } from '@/features/projects/hooks/use-projects'
import { useProjectBoq } from '../hooks/use-boq'
import { BoqUploadZone } from './boq-upload-zone'
import { BoqAllocationPanel } from './boq-allocation-panel'
import { BoqEditableGrid } from './boq-editable-grid'
import { BoqFinancialSummary } from './boq-financial-summary'

interface Props {
  projectId: string
  embedded?: boolean
}

function BoqContent({ projectId }: { projectId: string }) {
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: boq, isLoading: boqLoading, refetch } = useProjectBoq(projectId)

  if (projectLoading || boqLoading) {
    return (
      <div className='flex items-center justify-center py-16 text-muted-foreground'>
        Loading…
      </div>
    )
  }

  return (
    <div className='flex flex-1 flex-col gap-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>BOQ Management</h2>
        <p className='text-sm text-muted-foreground'>
          Bill of Quantities - draft activity suggestions, allocation approval, and official EV/IPC value
        </p>
      </div>

      {!boq?.hasUploadedBoq ? (
        <BoqUploadZone
          projectId={projectId}
          project={{
            name: project?.name,
            startDate: project?.startDate,
            duration: project?.duration,
          }}
          baseline={boq?.baseline}
          onUploadSuccess={() => refetch()}
        />
      ) : (
        <>
          <BoqUploadZone
            projectId={projectId}
            project={{
              name: project?.name,
              startDate: project?.startDate,
              duration: project?.duration,
            }}
            hasExistingBoq
            baseline={boq.baseline}
            onUploadSuccess={() => refetch()}
          />
          <BoqEditableGrid
            projectId={projectId}
            items={boq.items}
            financial={boq.financial}
            currency={project?.currency ?? 'USD'}
            baselineLocked={Boolean(boq.baseline?.locked)}
            onDataChange={() => refetch()}
          />
          <BoqAllocationPanel
            projectId={projectId}
            items={boq.items}
            currency={project?.currency ?? 'USD'}
          />
          {boq.financial && (
            <BoqFinancialSummary
              financial={boq.financial}
              currency={project?.currency ?? 'USD'}
            />
          )}
          <div className='grid gap-3 lg:grid-cols-2'>
            <AuditHistoryPanel
              projectId={projectId}
              entityType='boq_revision'
              title='BOQ Revision History'
              limit={8}
            />
            <AuditHistoryPanel
              projectId={projectId}
              entityType='boq_item'
              title='BOQ Row History'
              limit={8}
            />
          </div>
        </>
      )}
    </div>
  )
}

export function BoqPage({ projectId, embedded = false }: Props) {
  if (embedded) {
    return <BoqContent projectId={projectId} />
  }

  return (
    <Main className='flex flex-1 flex-col gap-6'>
      <BoqContent projectId={projectId} />
    </Main>
  )
}
