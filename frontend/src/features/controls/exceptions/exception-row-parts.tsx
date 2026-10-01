import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FileDiff } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { DrawerLink } from '../components/detail-parts'
import { useControlsDetailOpener } from '../hooks/use-controls-detail'
import type { ExceptionSubject, ProjectException } from './api'
import type { ExceptionDialogMode } from './exception-action-dialog'

/**
 * A subject that is a BOQ item or an activity opens its PC-5 drawer in
 * place; an allocation opens the drawer of the item or activity the server
 * names beside it. Any other subject is its label.
 */
export function SubjectLink({
  subject,
  secondary,
  testId,
}: {
  subject: ExceptionSubject
  secondary?: ExceptionSubject | null
  testId?: string
}) {
  const opener = useControlsDetailOpener()
  const label = subject.label ?? subject.type.replace(/_/g, ' ')
  const target =
    subject.type === 'boq_item' || subject.type === 'activity'
      ? subject
      : secondary && (secondary.type === 'boq_item' || secondary.type === 'activity')
        ? secondary
        : null
  if (!opener || !target) {
    return (
      <span data-testid={testId} data-subject-type={subject.type}>
        {label}
      </span>
    )
  }
  return (
    <DrawerLink
      testId={testId}
      onClick={() =>
        target.type === 'boq_item' ? opener.openBoqItem(target.id) : opener.openActivity(target.id)
      }
    >
      {label}
    </DrawerLink>
  )
}

/**
 * A link to one of the project's pages inside the open workspace —
 * `/o/{segment}/projects/…`, as every server-built link in a drawer is —
 * never a legacy `/projects/…` path while a workspace is open (spec 50).
 * Without a workspace (an identity token) the legacy path, which the route
 * tree redirects.
 */
export function ProjectPageLink({
  projectId,
  module,
  child,
  search,
  className,
  testId,
  data,
  children,
}: {
  projectId: string
  module: string
  child: string
  search?: { recordId: string; source: string }
  className?: string
  testId?: string
  data?: Record<`data-${string}`, string>
  children: ReactNode
}) {
  const orgSlug = useAuthStore((state) => state.auth.workspace?.segment ?? '')
  if (orgSlug) {
    return (
      <Link
        to='/o/$orgSlug/projects/$projectId/$module/$child'
        params={{ orgSlug, projectId, module, child }}
        search={search}
        className={className}
        data-testid={testId}
        {...data}
      >
        {children}
      </Link>
    )
  }
  return (
    <Link
      to='/projects/$projectId/$module/$child'
      params={{ projectId, module, child }}
      search={search}
      className={className}
      data-testid={testId}
      {...data}
    >
      {children}
    </Link>
  )
}

/** An exception in change: its change event, linked to where it lives. */
export function ChangeEventLink({
  projectId,
  changeEvent,
  testId,
}: {
  projectId: string
  changeEvent: NonNullable<ProjectException['changeEvent']>
  testId?: string
}) {
  return (
    <ProjectPageLink
      projectId={projectId}
      module='commercial'
      child='change-events'
      search={{ recordId: changeEvent.id, source: 'change_event' }}
      className='inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline'
      testId={testId}
      data={{ 'data-change-event-id': changeEvent.id }}
    >
      <FileDiff className='h-3 w-3' aria-hidden />
      {changeEvent.ref} · {changeEvent.status.replace(/_/g, ' ')}
    </ProjectPageLink>
  )
}

/**
 * The actions the server granted THIS caller on this row — each drawn only
 * when its boolean is true. The browser never decides a person may act.
 */
export function ExceptionActionButtons({
  exception,
  onAction,
  onRaise,
  testId,
}: {
  exception: ProjectException
  onAction: (mode: ExceptionDialogMode) => void
  onRaise: () => void
  testId: string
}) {
  const { actions } = exception
  return (
    <div className='flex flex-wrap justify-end gap-1'>
      {actions?.review === true && (
        <Button size='sm' variant='outline' className='h-7' onClick={() => onAction('review')} data-testid={`${testId}-review`}>
          Review
        </Button>
      )}
      {actions?.raiseChangeEvent === true && (
        <Button size='sm' className='h-7' onClick={onRaise} data-testid={`${testId}-raise`}>
          Raise change event
        </Button>
      )}
      {actions?.associateChangeEvent === true && (
        <Button size='sm' variant='outline' className='h-7' onClick={() => onAction('associate')} data-testid={`${testId}-associate`}>
          Associate event
        </Button>
      )}
      {actions?.snooze === true && (
        <Button size='sm' variant='ghost' className='h-7' onClick={() => onAction('snooze')} data-testid={`${testId}-snooze`}>
          Snooze
        </Button>
      )}
      {actions?.dismiss === true && (
        <Button size='sm' variant='ghost' className='h-7 text-destructive' onClick={() => onAction('dismiss')} data-testid={`${testId}-dismiss`}>
          Dismiss
        </Button>
      )}
    </div>
  )
}
