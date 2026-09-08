import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { apiClient } from '@/services/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * What needs this person today.
 *
 * The API has answered this since the records module landed
 * (`/assignments/mine`), and nothing ever asked it — so a buyer with thirty
 * orders to send and a QS with seventy-three commitments to raise both opened
 * the project to a health dashboard and had to go looking, module by module,
 * for their own work (OCTA-UX-ACTION-098).
 *
 * It is deliberately the *existing* action centre rather than a second task
 * list. Two kinds of work arrive through it: records that name a person (an
 * NCR's assignee, an RFI's ball-in-court) and records where the workflow
 * implies one (a draft commitment is the QS's move). Both are the same
 * question to the reader, so they are the same list.
 */

type OpenItem = {
  recordType: string
  label: string
  recordId: string
  ref: string | null
  title: string
  status: string
  projectId: string
  overdue: boolean
  dueDate: string | null
  target: {
    projectId: string
    module: string
    child: string | null
    recordType: string
    /** What the workspace expects in ?source= — not always the record type. */
    source?: string
    recordId: string
  }
}

type OpenItems = {
  items: OpenItem[]
  summary: { total: number; overdue: number; ballInCourt: number }
}

/** Straight to the record, not to the module it lives in. */
const hrefFor = (item: OpenItem) => {
  const { projectId, module, child, recordType, source, recordId } = item.target
  const base = child
    ? `/projects/${projectId}/${module}/${child}`
    : `/projects/${projectId}/${module}`
  return `${base}?recordId=${encodeURIComponent(recordId)}&source=${encodeURIComponent(source || recordType)}`
}

const STATUS_WORDS: Record<string, string> = {
  planned: 'to send for approval',
  draft: 'to send',
  pending_approval: 'to approve',
  pending: 'to approve',
  approved: 'to issue',
  acknowledged: 'to receive',
  partial: 'part-delivered',
  received: 'awaiting the invoice',
  closed: 'to award',
  submitted: 'to certify',
  under_review: 'to certify',
  open: 'out to bidders',
}

export function NeedsYouPanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['assignments-mine', projectId],
    queryFn: (): Promise<OpenItems> =>
      apiClient
        .get(`/projects/${projectId}/assignments/mine`)
        .then((r) => r.data.data),
    staleTime: 30_000,
  })

  if (isLoading) return null

  const items = data?.items ?? []
  const shown = items.slice(0, 8)

  return (
    <Card data-testid='uat-needs-you'>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-3'>
        <CardTitle className='text-base'>Needs you</CardTitle>
        <span
          className='text-muted-foreground text-xs tabular-nums'
          data-testid='uat-needs-you-count'
        >
          {items.length === 0
            ? 'nothing waiting'
            : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
      </CardHeader>
      <CardContent className='pt-0'>
        {shown.length === 0 ? (
          <p className='text-muted-foreground py-4 text-center text-sm'>
            Nothing is waiting on you here.
          </p>
        ) : (
          <ul className='divide-border divide-y'>
            {shown.map((item) => (
              <li key={`${item.recordType}-${item.recordId}`}>
                <a
                  href={hrefFor(item)}
                  className='hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2'
                  data-testid={`uat-needs-you-${item.recordType}-${item.recordId}`}
                >
                  <span className='text-muted-foreground w-32 shrink-0 truncate text-xs'>
                    {item.label}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-sm'>
                    {item.ref && (
                      <span className='mr-2 font-mono text-xs'>{item.ref}</span>
                    )}
                    {item.title}
                  </span>
                  <span
                    className={
                      item.overdue
                        ? 'text-destructive shrink-0 text-xs'
                        : 'text-muted-foreground shrink-0 text-xs'
                    }
                  >
                    {/* The status in the reader's words, not the database's. */}
                    {STATUS_WORDS[item.status] ?? item.status.replace(/_/g, ' ')}
                  </span>
                  <ArrowRight className='text-muted-foreground h-3.5 w-3.5 shrink-0' />
                </a>
              </li>
            ))}
          </ul>
        )}
        {items.length > shown.length && (
          <p className='text-muted-foreground pt-2 text-xs'>
            and {items.length - shown.length} more
          </p>
        )}
      </CardContent>
    </Card>
  )
}
