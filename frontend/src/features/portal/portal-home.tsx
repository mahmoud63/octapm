import { Link, Navigate, useParams } from '@tanstack/react-router'
import { ArrowRight, FolderOpen } from 'lucide-react'
import { surfaceHref } from '@/lib/domains'
import { Main } from '@/components/layout/main'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjects } from '@/features/projects/hooks/use-projects'

/**
 * The External Collaboration Portal's landing page (portal.octapm.com/o/{workspace}):
 * the projects this person works on as an external party (a consultant, a
 * project-party member). One project opens straight into it — its review
 * workspace is the external party's first module. A contractor who opens the
 * portal finds nothing of theirs here and is pointed back to the application:
 * the portal gives no one an external party's standing they do not have.
 */
export function PortalHome() {
  const { orgSlug } = useParams({ strict: false }) as { orgSlug: string }
  const projects = useProjects()
  const external = (projects.data?.items ?? []).filter(
    (project) =>
      (project.projectAccess?.effectiveRole ?? project.effectiveRole) === 'external_party'
  )

  if (projects.isLoading) {
    return (
      <Main>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='mt-6 h-24 w-full' />
      </Main>
    )
  }
  if (external.length === 1) {
    return (
      <Navigate
        to='/o/$orgSlug/projects/$projectId'
        params={{ orgSlug, projectId: external[0].id }}
        replace
      />
    )
  }
  return (
    <Main>
      <div className='space-y-6' data-testid='portal-home'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Your project reviews</h1>
          <p className='text-sm text-muted-foreground'>
            The projects you collaborate on. Open one to see what is waiting for your review.
          </p>
        </div>
        {external.length ? (
          <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {external.map((project) => (
              <li key={project.id}>
                <Link
                  to='/o/$orgSlug/projects/$projectId'
                  params={{ orgSlug, projectId: project.id }}
                  className='flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted'
                >
                  <FolderOpen className='size-5 text-muted-foreground' aria-hidden />
                  <span className='min-w-0 flex-1 truncate font-medium'>{project.name}</span>
                  <ArrowRight className='size-4 text-muted-foreground' aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className='rounded-lg border bg-card p-6 text-sm' data-testid='portal-home-empty'>
            <p className='font-medium'>No project reviews here.</p>
            <p className='mt-1 text-muted-foreground'>
              The portal is for consultants and other external project parties. If you work
              for the contractor, your projects are in the OctaPM application.
            </p>
            <a className='mt-3 inline-flex text-primary hover:underline' href={surfaceHref('app', '/')}>
              Open the OctaPM application
            </a>
          </div>
        )}
      </div>
    </Main>
  )
}
