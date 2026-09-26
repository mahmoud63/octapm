import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { apiClient } from '@/services/api/client'
import type { WorkspaceMembership } from '@/services/auth/types'
import { ArrowRight, Building2, Check, User } from 'lucide-react'
import { useAuthStore, workspaceSegment } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import { WorkspaceKindBadge } from './workspace-badge'
import { membershipStanding } from './workspace-standing'

/**
 * L1 Home — "My Work" across the identity's workspaces (workspace switching
 * doc §7, §25). The workspaces the person belongs to, with their kind and
 * standing in each, and what needs them in the workspace the session is
 * bound to. The needs-you list is the existing workspace dashboard's "my
 * open items" (the same query, so it is one request and one cache entry);
 * a count for every workspace at once would need the identity-level
 * `GET /me/home` a later wave adds. A personal workspace is only a label
 * here: its dashboard is the same one.
 */

type MyOpenItem = {
  recordType: string
  label: string
  recordId: string
  ref: string | null
  title: string
  status: string
  projectId: string
  projectName: string
  overdue: boolean
  ballInCourt: boolean
  dueDate: string | null
  target: {
    projectId: string | null
    module: string
    child?: string
    status?: string
    source?: string
    recordId?: string
  }
}

type WorkspaceDashboard = {
  myOpenItems?: {
    items: MyOpenItem[]
    summary: { total: number; overdue: number; ballInCourt: number }
  }
  summary?: { totalProjects: number; activeProjects: number }
}

const useWorkspaceDashboard = (enabled: boolean) =>
  useQuery<WorkspaceDashboard>({
    queryKey: ['workspace-dashboard'],
    queryFn: () =>
      apiClient
        .get('/projects/workspace-dashboard')
        .then((response) => response.data.data),
    enabled,
    staleTime: 30_000,
  })

const targetSearch = (target: MyOpenItem['target']) => ({
  module: target.module,
  child: target.child,
  status: target.status,
  source: target.source,
  recordId: target.recordId,
})

function WorkspaceCard({
  membership,
  current,
}: {
  membership: WorkspaceMembership
  current: boolean
}) {
  const segment = workspaceSegment(membership)
  const enterable = membership.status === 'active'
  return (
    <Card
      className={cn('gap-3', current && 'border-primary/50')}
      data-testid={`home-workspace-${segment}`}
    >
      <CardContent className='flex items-start gap-3 pt-0'>
        <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
          {membership.kind === 'personal' ? (
            <User className='size-5 text-muted-foreground' />
          ) : (
            <Building2 className='size-5 text-muted-foreground' />
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='truncate font-semibold'>
              {membership.name ?? segment}
            </span>
            <WorkspaceKindBadge kind={membership.kind} />
            {current && (
              <Badge className='gap-1 rounded-full px-1.5 py-0 text-[10px]'>
                <Check className='size-3' /> Current
              </Badge>
            )}
          </div>
          <p className='text-xs text-muted-foreground'>
            {membershipStanding(membership)}
          </p>
        </div>
        {enterable ? (
          <Button asChild size='sm' variant={current ? 'outline' : 'default'}>
            <Link
              to='/o/$orgSlug'
              params={{ orgSlug: segment }}
              // Hovering must not switch the session: the guard switches on
              // arrival, never on a preload.
              preload={false}
              data-testid={`home-open-${segment}`}
            >
              {current ? 'Dashboard' : 'Open'}
              <ArrowRight className='size-4' />
            </Link>
          </Button>
        ) : (
          <Badge variant='secondary'>{membership.status}</Badge>
        )}
      </CardContent>
    </Card>
  )
}

export function Home() {
  const user = useAuthStore((state) => state.auth.user)
  const workspace = useAuthStore((state) => state.auth.workspace)
  const memberships = useAuthStore((state) => state.auth.memberships)
  const dashboard = useWorkspaceDashboard(Boolean(workspace))
  const open = dashboard.data?.myOpenItems
  const items = open?.items.slice(0, 9) ?? []

  return (
    <Main className='space-y-8' data-testid='home-page'>
      <div className='space-y-1'>
        <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
          My Work
        </h1>
        <p className='text-muted-foreground'>
          {user ? `${user.name} — ` : ''}
          {memberships.length === 1
            ? 'one workspace'
            : `${memberships.length} workspaces`}
          {workspace
            ? `, signed in to ${workspace.name ?? workspace.segment}`
            : ', none open'}
        </p>
      </div>

      <section className='space-y-3' data-testid='home-workspaces'>
        <h2 className='text-lg font-semibold'>Workspaces</h2>
        {memberships.length === 0 ? (
          <Card>
            <CardContent className='py-8 text-center text-sm text-muted-foreground'>
              You are not in any workspace yet. An administrator can add you
              to theirs, or an invitation opens one for you.
            </CardContent>
          </Card>
        ) : (
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {memberships.map((membership) => (
              <WorkspaceCard
                key={membership.orgId}
                membership={membership}
                current={workspace?.orgId === membership.orgId}
              />
            ))}
          </div>
        )}
      </section>

      {workspace && (
        <section className='space-y-3' data-testid='home-needs-you'>
          <div className='flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <h2 className='text-lg font-semibold'>
                Needs you in {workspace.name ?? workspace.segment}
              </h2>
              <p className='text-sm text-muted-foreground'>
                Records where you are owner, reviewer, approver, assignee, or
                hold the ball, in the workspace you are signed in to.
              </p>
            </div>
            {open && (
              <div className='flex flex-wrap gap-2'>
                <Badge variant='outline'>{open.summary.total} open</Badge>
                {open.summary.ballInCourt > 0 && (
                  <Badge>{open.summary.ballInCourt} in your court</Badge>
                )}
                {open.summary.overdue > 0 && (
                  <Badge variant='destructive'>
                    {open.summary.overdue} overdue
                  </Badge>
                )}
              </div>
            )}
          </div>
          {dashboard.isLoading ? (
            <p className='text-sm text-muted-foreground'>Loading…</p>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className='py-8 text-center text-sm text-muted-foreground'>
                Nothing is waiting on you right now.
              </CardContent>
            </Card>
          ) : (
            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {items.map((item) => (
                <Link
                  key={`${item.recordType}-${item.recordId}`}
                  to='/o/$orgSlug/projects/$projectId'
                  params={{
                    orgSlug: workspace.segment,
                    projectId: item.projectId,
                  }}
                  search={targetSearch(item.target)}
                  className={cn(
                    'rounded-md border bg-card p-3 transition-colors hover:bg-muted/40',
                    item.ballInCourt && 'border-primary/50'
                  )}
                >
                  <p className='text-xs text-muted-foreground'>
                    {item.label} · {item.ref}
                  </p>
                  <p className='truncate text-sm font-medium'>{item.title}</p>
                  <p className='truncate text-xs text-muted-foreground'>
                    {item.projectName}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </Main>
  )
}
