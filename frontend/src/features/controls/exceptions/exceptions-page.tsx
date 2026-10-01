import { useState } from 'react'
import { AlertOctagon } from 'lucide-react'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ControlsDetailHost } from '../components/controls-detail-drawers'
import { formatDate } from '../lib/detail-format'
import { useProjectExceptions, type ProjectException } from './api'
import {
  ExceptionActionDialog,
  type ExceptionDialogMode,
} from './exception-action-dialog'
import {
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  STATUS_LABEL,
  detectedText,
  groupLabels,
  kindLabel,
} from './exception-format'
import {
  MeasuredVsLimit,
  SeverityChip,
  StatusBadge,
  WithheldNote,
} from './exception-parts'
import {
  ChangeEventLink,
  ExceptionActionButtons,
  SubjectLink,
} from './exception-row-parts'
import { RaiseChangeEventDialog } from './raise-change-event-dialog'

/**
 * Project Controls › Exceptions (PC-7b, change intelligence §1, §2, §6).
 * The caller's exceptions as the server lists them: severity, kind, the
 * subject (a BOQ item or activity opens its PC-5 drawer), measured against
 * limit each with its basis, status, and the four actions only where the
 * server granted them. An exception in change links to its change event.
 * Rows the server withheld are not drawn and the list says so with the
 * server's reason — never an empty count beside a withheld marker.
 */

const ALL = '__all__'

function ExceptionRow({
  projectId,
  exception,
  onAction,
  onRaise,
}: {
  projectId: string
  exception: ProjectException
  onAction: (mode: ExceptionDialogMode) => void
  onRaise: () => void
}) {
  const testId = `exception-row-${exception.id}`
  const groups = groupLabels(exception.group)
  return (
    <li
      className='space-y-2 rounded-md border p-3'
      data-testid={testId}
      data-kind={exception.kind}
      data-severity={exception.severity}
      data-status={exception.status}
    >
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0 space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <SeverityChip severity={exception.severity} />
            <span className='font-medium' data-testid={`${testId}-kind`}>
              {kindLabel(exception.kind)}
            </span>
            <StatusBadge status={exception.status} />
            {exception.changeEvent && (
              <ChangeEventLink
                projectId={projectId}
                changeEvent={exception.changeEvent}
                testId={`${testId}-change-event`}
              />
            )}
          </div>
          <p className='text-sm'>
            <SubjectLink
              subject={exception.subject}
              secondary={exception.secondarySubject}
              testId={`${testId}-subject`}
            />
            {exception.secondarySubject?.label && (
              <span className='text-muted-foreground'> · {exception.secondarySubject.label}</span>
            )}
          </p>
          {groups.length > 0 && (
            <p className='text-xs text-muted-foreground'>{groups.join(' · ')}</p>
          )}
        </div>
        <ExceptionActionButtons
          exception={exception}
          onAction={onAction}
          onRaise={onRaise}
          testId={testId}
        />
      </div>
      <MeasuredVsLimit exception={exception} testId={`${testId}-figures`} />
      <p className='text-[11px] text-muted-foreground'>
        {detectedText(exception)}
        {exception.status === 'snoozed' && exception.snoozedUntil
          ? ` · snoozed until ${formatDate(exception.snoozedUntil)}`
          : ''}
      </p>
      {exception.review?.reviewedAt && (
        <p className='text-xs' data-testid={`${testId}-reviewed`}>
          Reviewed {formatDate(exception.review.reviewedAt)}
          {exception.review.reviewedBy ? ` by ${exception.review.reviewedBy}` : ''}
          {exception.review.note ? ` — ${exception.review.note}` : ''}
        </p>
      )}
      {exception.dismissal?.reason && (
        <p className='text-xs text-muted-foreground' data-testid={`${testId}-dismissal`}>
          Dismissed — {exception.dismissal.reason}
        </p>
      )}
    </li>
  )
}

function ExceptionsList({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState(ALL)
  const [severity, setSeverity] = useState(ALL)
  const { data, isLoading, error } = useProjectExceptions(projectId, {
    status: status === ALL ? undefined : status,
    severity: severity === ALL ? undefined : severity,
  })
  const [dialog, setDialog] = useState<{ exception: ProjectException; mode: ExceptionDialogMode } | null>(null)
  const [raising, setRaising] = useState<ProjectException | null>(null)

  const items = data?.items ?? []
  const withheld = data?.state === 'ok' ? data.withheld : null

  return (
    <div className='space-y-3' data-testid='exceptions-page'>
      <div className='flex flex-wrap items-center gap-2'>
        <AlertOctagon className='h-5 w-5' />
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>Exceptions</p>
          <p className='text-xs text-muted-foreground'>
            Overruns and data gaps the controls engine found in the figures their owning
            services state. Each is a signal to review — never a change order, a budget or a
            schedule change. Raise a change event from one to price it.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className='h-8 w-[150px]' data-testid='exceptions-filter-status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Current</SelectItem>
            {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((value) => (
              <SelectItem key={value} value={value}>
                {STATUS_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className='h-8 w-[140px]' data-testid='exceptions-filter-severity'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All severities</SelectItem>
            {SEVERITY_ORDER.map((value) => (
              <SelectItem key={value} value={value}>
                {SEVERITY_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className='space-y-2'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-20 w-full' />
        </div>
      ) : error ? (
        <p className='text-sm text-destructive' data-testid='exceptions-error'>
          {getServerErrorMessage(error, 'Exceptions could not be read.')}
        </p>
      ) : data?.state === 'not-on-server' ? (
        <p className='text-sm text-muted-foreground' data-testid='exceptions-not-on-server'>
          — Exceptions are not available on this server yet.
        </p>
      ) : (
        <>
          <p className='text-xs text-muted-foreground' data-testid='exceptions-count'>
            {items.length
              ? `${items.length.toLocaleString()} shown`
              : withheld
                ? 'None you may see'
                : 'No exceptions match'}
          </p>
          {withheld && (
            <WithheldNote withheld={withheld} hasVisible={items.length > 0} testId='exceptions-withheld' />
          )}
          {items.length > 0 && (
            <ul className='space-y-2' data-testid='exceptions-list'>
              {items.map((exception) => (
                <ExceptionRow
                  key={exception.id}
                  projectId={projectId}
                  exception={exception}
                  onAction={(mode) => setDialog({ exception, mode })}
                  onRaise={() => setRaising(exception)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <ExceptionActionDialog
        key={dialog ? `${dialog.exception.id}:${dialog.mode}` : 'closed'}
        projectId={projectId}
        exception={dialog?.exception ?? null}
        mode={dialog?.mode ?? null}
        onClose={() => setDialog(null)}
      />
      <RaiseChangeEventDialog
        projectId={projectId}
        source={raising ? { type: 'exception', id: raising.id } : null}
        open={Boolean(raising)}
        onOpenChange={(open) => !open && setRaising(null)}
      />
    </div>
  )
}

export function ExceptionsPage({ projectId }: { projectId: string }) {
  return (
    <ControlsDetailHost projectId={projectId}>
      <ExceptionsList projectId={projectId} />
    </ControlsDetailHost>
  )
}
