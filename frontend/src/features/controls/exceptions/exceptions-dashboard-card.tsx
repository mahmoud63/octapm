import { Link } from '@tanstack/react-router'
import { AlertOctagon } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { SeverityCounts } from './api'
import { SeverityCountChips, WithheldNote } from './exception-parts'

/**
 * The workspace dashboard's "open exceptions" tile (PC-7b, change
 * intelligence §6; §35 rule 2: an org-wide read), drawn from the workspace
 * dashboard's `openExceptions` as the API sends it: `total` and
 * `bySeverity` (open = not in a live change event, not snoozed), `inChange`,
 * `snoozed`, `basis`, and — when some kinds are not counted on some
 * projects — `withheld { reason, modules, projects: [{ projectId, name,
 * reason }] }`, which names those projects and why, never with a count.
 * Every number is the server's; none is added up here.
 */

export type WorkspaceOpenExceptions = {
  total?: number | null
  bySeverity?: SeverityCounts
  inChange?: number | null
  snoozed?: number | null
  basis?: string | null
  withheld?: {
    reason: string
    modules?: string[]
    projects?: Array<{ projectId: string; name?: string | null; reason: string; modules?: string[] }>
  } | null
}

export function OpenExceptionsCard({ data }: { data: WorkspaceOpenExceptions }) {
  const withheldProjects = data.withheld?.projects ?? []
  const others = [
    typeof data.inChange === 'number' ? `${data.inChange.toLocaleString()} in change` : null,
    typeof data.snoozed === 'number' ? `${data.snoozed.toLocaleString()} snoozed` : null,
  ].filter(Boolean)
  return (
    <Card data-testid='dashboard-open-exceptions'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <AlertOctagon className='h-4 w-4' /> Open exceptions
          <span className='octa-numeric text-base' data-testid='dashboard-open-exceptions-total'>
            {data.total == null || (data.withheld && data.total === 0) ? '—' : data.total.toLocaleString()}
          </span>
        </CardTitle>
        <CardDescription>
          Overruns and data gaps the controls engine found, per severity, across the projects you
          may read. Each is a signal to review, never a change.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <SeverityCountChips counts={data.bySeverity ?? {}} testId='dashboard-open-exceptions-severity' />
        {others.length > 0 && (
          <p className='text-xs text-muted-foreground' data-testid='dashboard-open-exceptions-others'>
            {others.join(' · ')}
          </p>
        )}
        {data.basis && (
          <p className='text-[11px] text-muted-foreground' data-testid='dashboard-open-exceptions-basis'>
            {data.basis}
          </p>
        )}
        {data.withheld && (
          <WithheldNote withheld={data.withheld} hasVisible testId='dashboard-open-exceptions-withheld' />
        )}
        {withheldProjects.length > 0 && (
          <ul className='space-y-1 text-sm'>
            {withheldProjects.map((project) => (
              <li
                key={project.projectId}
                className='flex flex-wrap items-center justify-between gap-2'
                data-testid={`dashboard-open-exceptions-project-${project.projectId}`}
              >
                <Link
                  to='/projects/$projectId/$module/$child'
                  params={{ projectId: project.projectId, module: 'controls', child: 'exceptions' }}
                  className='min-w-0 truncate text-primary underline-offset-2 hover:underline'
                >
                  {project.name ?? 'Project'}
                </Link>
                <span className='text-xs text-muted-foreground' title={project.reason} data-withheld='true'>
                  — {project.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
