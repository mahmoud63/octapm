import { Link } from '@tanstack/react-router'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { DetailSection, Empty } from '../components/detail-parts'
import { useProjectExceptions } from './api'
import { kindLabel } from './exception-format'
import {
  MeasuredVsLimit,
  SeverityChip,
  StatusBadge,
  WithheldNote,
} from './exception-parts'
import { ChangeEventLink } from './exception-row-parts'

/**
 * The exceptions on one record, in its PC-5 drawer (a BOQ item or an
 * activity): the current ones the server lists for the record — its own,
 * and those on its allocations — each with its severity, measured against
 * limit with their bases, and its change event when it is in change. The
 * actions live on the Exceptions screen, one link away. What the server
 * withheld is said with its reason, never as "none".
 */
export function RecordExceptionsSection({
  projectId,
  recordType,
  recordId,
  testId,
}: {
  projectId: string
  recordType: 'boq_item' | 'activity'
  recordId: string
  testId: string
}) {
  const { data, isLoading, error } = useProjectExceptions(projectId, { recordType, recordId })
  const items = (data?.items ?? []).filter(
    (exception) => exception.status !== 'resolved' && exception.status !== 'dismissed'
  )
  const withheld = data?.state === 'ok' ? data.withheld : null
  return (
    <DetailSection title='Exceptions' testId={testId}>
      {isLoading ? (
        <Empty>Reading exceptions…</Empty>
      ) : error ? (
        <p className='text-sm text-destructive' data-testid={`${testId}-error`}>
          {getServerErrorMessage(error, 'Exceptions could not be read.')}
        </p>
      ) : data?.state === 'not-on-server' ? (
        <p className='text-sm text-muted-foreground' data-testid={`${testId}-not-on-server`}>
          — Exceptions are not available on this server yet.
        </p>
      ) : (
        <>
          {items.length > 0 ? (
            <ul className='space-y-2'>
              {items.map((exception) => (
                <li
                  key={exception.id}
                  className='space-y-1 rounded border p-2'
                  data-testid={`${testId}-${exception.id}`}
                  data-kind={exception.kind}
                  data-status={exception.status}
                >
                  <div className='flex flex-wrap items-center gap-2 text-sm'>
                    <SeverityChip severity={exception.severity} />
                    <span className='font-medium'>{kindLabel(exception.kind)}</span>
                    <StatusBadge status={exception.status} />
                    {exception.changeEvent && (
                      <ChangeEventLink
                        projectId={projectId}
                        changeEvent={exception.changeEvent}
                        testId={`${testId}-${exception.id}-change-event`}
                      />
                    )}
                  </div>
                  <MeasuredVsLimit exception={exception} />
                </li>
              ))}
            </ul>
          ) : withheld ? null : (
            <Empty>No open exception on this record.</Empty>
          )}
          {withheld && (
            <WithheldNote withheld={withheld} hasVisible={items.length > 0} testId={`${testId}-withheld`} />
          )}
          <Link
            to='/projects/$projectId/$module/$child'
            params={{ projectId, module: 'controls', child: 'exceptions' }}
            className='text-xs text-primary underline-offset-2 hover:underline'
            data-testid={`${testId}-open-all`}
          >
            Open Exceptions
          </Link>
        </>
      )}
    </DetailSection>
  )
}
