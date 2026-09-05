import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  formatWorkflowDate,
  useMyWorkflowSteps,
  useRespondWorkflow,
  workspaceLink,
  type MyWorkflowStep,
} from '../hooks/use-workflow-engine'
import { WorkflowResponseForm } from './workflow-instance-panel'

function StepCard({ item }: { item: MyWorkflowStep }) {
  const respond = useRespondWorkflow(item.projectId)
  const link = workspaceLink(item.path)
  return (
    <div
      className={cn(
        'space-y-2 rounded-md border bg-card p-3',
        item.overdue && 'border-destructive/50'
      )}
      data-testid='uat-my-workflow-step'
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='text-xs text-muted-foreground'>
            {item.toolLabel}
            {item.recordRef ? ` · ${item.recordRef}` : ''}
          </p>
          <p className='truncate text-sm font-medium'>
            {item.recordTitle ?? item.recordRef ?? 'Record'}
          </p>
          <p className='truncate text-xs text-muted-foreground'>
            {item.project?.name ?? '—'} · {item.stepName}
            {item.template ? ` · ${item.template.name}` : ''}
          </p>
        </div>
        <div className='flex shrink-0 flex-col items-end gap-1'>
          {item.overdue ? (
            <Badge variant='destructive'>Overdue</Badge>
          ) : item.dueAt ? (
            <Badge variant='outline'>
              Due {formatWorkflowDate(item.dueAt)}
            </Badge>
          ) : null}
          {link && (
            <Button asChild size='sm' variant='ghost' className='h-7 px-2'>
              <Link
                to='/projects/$projectId'
                params={{ projectId: link.projectId }}
                search={link.search}
              >
                Open
                <ArrowUpRight className='ml-1 h-3 w-3' />
              </Link>
            </Button>
          )}
        </div>
      </div>
      <WorkflowResponseForm
        responses={item.responses}
        isPending={respond.isPending}
        compact
        onRespond={async (response, comment) => {
          await respond.mutateAsync({
            instanceId: item.instanceId,
            response,
            comment,
          })
          toast.success('Response recorded')
        }}
      />
    </div>
  )
}

/** Dashboard block: workflow decisions waiting on the signed-in user. */
export function MyWorkflowStepsSection({
  projectId = null,
  hideWhenEmpty = true,
}: {
  projectId?: string | null
  hideWhenEmpty?: boolean
}) {
  const { data, isLoading } = useMyWorkflowSteps(projectId)
  const items = data ?? []
  if (isLoading || (hideWhenEmpty && items.length === 0)) return null
  const overdue = items.filter((item) => item.overdue).length

  return (
    <section className='space-y-3' data-testid='uat-my-workflow-steps'>
      <div className='flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between'>
        <div>
          <h2 className='flex items-center gap-2 text-lg font-semibold'>
            <Workflow className='h-5 w-5' />
            Decisions waiting on you
          </h2>
          <p className='text-sm text-muted-foreground'>
            Workflow steps assigned to you. Answer here or open the record.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Badge variant='outline'>{items.length} waiting</Badge>
          {overdue > 0 && (
            <Badge variant='destructive'>{overdue} overdue</Badge>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <Card>
          <CardContent className='py-8 text-center text-sm text-muted-foreground'>
            No workflow step is waiting on you.
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {items.slice(0, 12).map((item) => (
            <StepCard key={item.assignmentId} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
