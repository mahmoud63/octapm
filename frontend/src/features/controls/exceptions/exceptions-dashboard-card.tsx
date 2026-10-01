import { Link } from '@tanstack/react-router'
import { AlertOctagon } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { ExceptionsWithheld, SeverityCounts } from './api'
import { SeverityCountChips, WithheldNote } from './exception-parts'

/**
 * The workspace dashboard's "open exceptions" tile (PC-7b, change
 * intelligence §6; §35 rule 2: an org-wide read). Counts per severity are
 * the server's — over the projects and kinds this person may read — and a
 * project's exceptions the server withheld are said with its reason, never
 * counted as 0. Each project opens its Exceptions page.
 */

export type WorkspaceOpenExceptions = {
  total?: number | null
  bySeverity?: SeverityCounts
  withheld?: ExceptionsWithheld | null
  projects?: Array<{
    projectId: string
    projectName?: string | null
    total?: number | null
    bySeverity?: SeverityCounts
    withheld?: ExceptionsWithheld | null
  }>
}

export function OpenExceptionsCard({ data }: { data: WorkspaceOpenExceptions }) {
  const projects = data.projects ?? []
  return (
    <Card data-testid='dashboard-open-exceptions'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <AlertOctagon className='h-4 w-4' /> Open exceptions
          <span className='octa-numeric text-base' data-testid='dashboard-open-exceptions-total'>
            {data.total == null ? '—' : data.total.toLocaleString()}
          </span>
        </CardTitle>
        <CardDescription>
          Overruns and data gaps the controls engine found, per severity, across the projects you
          may read. Each is a signal to review, never a change.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <SeverityCountChips counts={data.bySeverity ?? {}} testId='dashboard-open-exceptions-severity' />
        {data.withheld && (
          <WithheldNote withheld={data.withheld} hasVisible testId='dashboard-open-exceptions-withheld' />
        )}
        {projects.length > 0 && (
          <ul className='space-y-1 text-sm'>
            {projects.map((project) => (
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
                  {project.projectName ?? 'Project'}
                </Link>
                {project.withheld ? (
                  <span className='text-xs text-muted-foreground' title={project.withheld.reason} data-withheld='true'>
                    — {project.withheld.reason}
                  </span>
                ) : (
                  <SeverityCountChips counts={project.bySeverity ?? {}} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
