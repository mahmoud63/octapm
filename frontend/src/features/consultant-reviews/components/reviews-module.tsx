import { useEffect, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Loader2, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AiAction } from '@/features/ai/components/ai-action'
import { downloadFromApi } from '@/features/bim/hooks/use-bim-5d'
import { type ReviewFilters, type ReviewRow, type ReviewSummary, reviewExportUrl, useIsExternalParty, useReviewPerformance, useReviewQueue } from '../hooks/use-external-reviews'
import { formatDay, formatDuration, formatStamp, tick } from '../lib/duration'
import { ConsultantsPanel } from './consultants-panel'
import { Pill, ReviewSheet, STATUS_TONE } from './review-sheet'

const MODULES: Array<[string, string]> = [['rfi', 'RFIs'], ['submittal', 'Submittals'], ['progress_report', 'Reports'], ['itp', 'Inspections'], ['ncr', 'NCRs'], ['closeout_deliverable', 'Closeout']]
const ALL = '__all__'

function Card({ label, value, hint, tone, onClick, testId }: { label: string; value: React.ReactNode; hint?: string; tone?: string; onClick?: () => void; testId?: string }) {
  return (
    <button type='button' onClick={onClick} disabled={!onClick} className={cn('rounded-md border bg-card px-3 py-2 text-left', onClick && 'hover:bg-muted/40')} data-testid={testId}>
      <p className='text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>{label}</p>
      <p className={cn('mt-0.5 text-2xl font-semibold tabular-nums', tone)}>{value}</p>
      {hint && <p className='text-[11px] text-muted-foreground'>{hint}</p>}
    </button>
  )
}

/** The queue table, the same for both sides; "Open for" is the column that matters and is shown prominently. */
function QueueTable({ rows, now, side, onOpen }: { rows: ReviewRow[]; now: string | undefined; side: 'contractor' | 'consultant'; onOpen: (id: string) => void }) {
  if (!rows.length) return <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>Nothing here.</p>
  return (
    <div className='overflow-x-auto rounded-md border'>
      <table className='w-full text-sm' data-testid='uat-review-queue'>
        <thead className='bg-muted/40 text-xs text-muted-foreground'>
          <tr>
            {['Type', 'Number', 'Subject', side === 'contractor' ? 'Consultant' : 'Submitted by', ...(side === 'contractor' ? ['Responsible reviewer'] : []), 'Submitted', 'Open for', 'Due', 'Status', ...(side === 'contractor' ? ['Current action with'] : [])].map((head) => (
              <th key={head} className={cn('px-3 py-2 text-left font-medium whitespace-nowrap', head === 'Open for' && 'text-foreground')}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const running = row.awaitingConsultant
            return (
              <tr key={row.id} className={cn('cursor-pointer border-t hover:bg-muted/40', row.overdue && 'bg-destructive/5')} onClick={() => onOpen(row.id)} data-testid={`uat-review-row-${row.sourceRef}`}>
                <td className='px-3 py-2 text-xs whitespace-nowrap'>{row.sourceLabel}</td>
                <td className='px-3 py-2 font-mono text-xs whitespace-nowrap'>{row.sourceRef}<span className='block text-[10px] text-muted-foreground'>rev {row.revision} · cycle {row.cycle}</span></td>
                <td className='max-w-[18rem] px-3 py-2'><span className='line-clamp-2'>{row.title}</span></td>
                <td className='px-3 py-2 text-xs whitespace-nowrap'>{side === 'contractor' ? row.party.name : row.submittedBy || 'Main contractor'}</td>
                {side === 'contractor' && <td className='px-3 py-2 text-xs whitespace-nowrap'>{row.responsible.name}</td>}
                <td className='px-3 py-2 text-xs whitespace-nowrap'>{formatDay(row.submittedAt)}</td>
                <td className='px-3 py-2 whitespace-nowrap'>
                  {running ? (
                    <span className={cn('text-base font-bold tabular-nums', row.overdue ? 'text-destructive' : 'text-sky-700 dark:text-sky-400')}>{formatDuration(tick(row.openMs, now, true))}</span>
                  ) : (
                    <span className='text-xs text-muted-foreground'>{row.responseMs !== null ? `answered in ${formatDuration(row.responseMs)}` : '—'}</span>
                  )}
                </td>
                <td className='px-3 py-2 text-xs whitespace-nowrap'>{formatDay(row.dueAt)}</td>
                <td className='px-3 py-2 whitespace-nowrap'>
                  {row.overdue ? <Pill className='bg-destructive/15 text-destructive'><AlertTriangle className='h-3 w-3' /> OVERDUE {formatDuration(tick(row.overdueMs, now, true))}</Pill> : <Pill className={STATUS_TONE[row.status]}>{row.decisionLabel && !running ? row.decisionLabel : row.statusLabel}</Pill>}
                </td>
                {side === 'contractor' && <td className={cn('px-3 py-2 text-xs font-medium whitespace-nowrap', row.actionWith.side === 'consultant' ? 'text-sky-700 dark:text-sky-400' : row.actionWith.side === 'contractor' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>{row.actionWith.side === 'consultant' ? 'Consultant' : row.actionWith.side === 'contractor' ? 'Contractor' : row.actionWith.label}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ContractorRequests({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState<ReviewFilters>({ status: 'open', sort: 'priority' })
  const [q, setQ] = useState('')
  const { data, isLoading, dataUpdatedAt } = useReviewQueue(projectId, { ...filters, q: q.trim() || undefined })
  const canExport = useCanPerform('external_review', 'export')
  const set = (patch: ReviewFilters) => setFilters((value) => ({ ...value, ...patch }))
  const s = data?.summary
  const now = dataUpdatedAt ? new Date(dataUpdatedAt).toISOString() : data?.now
  const parties = [...new Map((data?.items ?? []).map((row) => [row.party.id, row.party.name])).entries()]
  const reviewers = [...new Map((data?.items ?? []).map((row) => [row.responsible.id, row.responsible.name])).entries()]
  return (
    <div className='space-y-3' data-testid='uat-contractor-open-requests'>
      {s && (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
          <Card label='Awaiting consultant' value={s.awaitingConsultant} onClick={() => set({ status: 'awaiting', overdue: undefined })} testId='uat-card-awaiting' />
          <Card label='Due today' value={s.dueToday} tone={s.dueToday ? 'text-amber-700 dark:text-amber-400' : undefined} />
          <Card label='Overdue' value={s.overdue} tone={s.overdue ? 'text-destructive' : undefined} onClick={() => set({ status: 'awaiting', overdue: 'true' })} testId='uat-card-overdue' />
          <Card label='Returned for revision' value={s.returnedToContractor} tone={s.returnedToContractor ? 'text-amber-800 dark:text-amber-300' : undefined} onClick={() => set({ status: 'returned', overdue: undefined })} />
          <Card label='Responded this week' value={s.respondedThisWeek} hint={s.responseReceived ? `${s.responseReceived} to acknowledge` : undefined} onClick={() => set({ status: 'responded', overdue: undefined })} />
          <Card label='Average response' value={formatDuration(s.averageResponseMs)} hint={s.onTimePct !== null ? `${s.onTimePct}% on time` : undefined} />
        </div>
      )}
      {s?.oldestOpen && <p className='text-xs text-muted-foreground'>Oldest open: <button type='button' className='font-medium text-foreground underline' onClick={() => onOpen(s.oldestOpen!.id)}>{s.oldestOpen.ref}</button> — {s.oldestOpen.title} · open {formatDuration(tick(s.oldestOpen.openMs, now, true))}</p>}
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative'>
          <Search className='absolute start-2 top-2 h-4 w-4 text-muted-foreground' />
          <Input className='h-8 w-56 ps-7' placeholder='Reference, subject, consultant…' value={q} onChange={(event) => setQ(event.target.value)} />
        </div>
        <Select value={filters.status || 'open'} onValueChange={(status) => set({ status })}>
          <SelectTrigger className='h-8 w-40'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='open'>All open</SelectItem>
            <SelectItem value='awaiting'>Awaiting consultant</SelectItem>
            <SelectItem value='returned'>Returned for revision</SelectItem>
            <SelectItem value='responded'>Responded</SelectItem>
            <SelectItem value='closed'>Closed / withdrawn</SelectItem>
            <SelectItem value='all'>Everything</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.sourceType || ALL} onValueChange={(value) => set({ sourceType: value === ALL ? undefined : value })}>
          <SelectTrigger className='h-8 w-36'><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All modules</SelectItem>{MODULES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.partyId || ALL} onValueChange={(value) => set({ partyId: value === ALL ? undefined : value })}>
          <SelectTrigger className='h-8 w-44'><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All consultants</SelectItem>{parties.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.reviewerId || ALL} onValueChange={(value) => set({ reviewerId: value === ALL ? undefined : value })}>
          <SelectTrigger className='h-8 w-40'><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>All reviewers</SelectItem>{reviewers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filters.action || ALL} onValueChange={(value) => set({ action: value === ALL ? undefined : value })}>
          <SelectTrigger className='h-8 w-40'><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Action with anyone</SelectItem><SelectItem value='consultant'>With consultant</SelectItem><SelectItem value='contractor'>With contractor</SelectItem></SelectContent>
        </Select>
        <label className='flex items-center gap-1.5 text-xs'><Switch checked={filters.overdue === 'true'} onCheckedChange={(checked) => set({ overdue: checked ? 'true' : undefined })} /> Overdue only</label>
        <Select value={filters.sort || 'priority'} onValueChange={(sort) => set({ sort })}>
          <SelectTrigger className='h-8 w-40'><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value='priority'>Overdue, then due soon</SelectItem><SelectItem value='oldest'>Oldest open</SelectItem><SelectItem value='newest'>Newest</SelectItem><SelectItem value='due'>Due date</SelectItem><SelectItem value='overdue'>Most overdue</SelectItem></SelectContent>
        </Select>
        {canExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size='sm' variant='outline' className='ms-auto h-8'><FileSpreadsheet className='h-4 w-4' /> Export</Button></DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {(['xlsx', 'csv'] as const).map((format) => <DropdownMenuItem key={format} onSelect={() => downloadFromApi(reviewExportUrl(projectId, format, { ...filters, q: q.trim() || undefined }), `consultant-requests.${format}`).catch((error) => toast.error(getServerErrorMessage(error)))}>{format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV'}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {isLoading || !data ? <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading…</p> : <QueueTable rows={data.items} now={now} side='contractor' onOpen={onOpen} />}
      <p className='text-[11px] text-muted-foreground'>Open time runs from the formal submission, in calendar time (not contract working days).</p>
    </div>
  )
}

function Performance({ projectId }: { projectId: string }) {
  const { data, isLoading } = useReviewPerformance(projectId)
  if (isLoading || !data) return <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading…</p>
  const table = (title: string, rows: typeof data.byParty) => (
    <section className='rounded-md border'>
      <h3 className='border-b px-3 py-2 text-sm font-semibold'>{title}</h3>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm tabular-nums'>
          <thead className='text-xs text-muted-foreground'><tr>{['', 'Open', 'Overdue', 'Completed', 'Returned', 'Average response', 'Median response', 'On time'].map((head) => <th key={head} className='px-3 py-1.5 text-left font-medium'>{head}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className='border-t'>
                <td className='px-3 py-1.5 font-medium'>{row.label}</td>
                <td className='px-3 py-1.5'>{row.open}</td>
                <td className={cn('px-3 py-1.5', row.overdue && 'font-semibold text-destructive')}>{row.overdue}</td>
                <td className='px-3 py-1.5'>{row.completed}</td>
                <td className='px-3 py-1.5'>{row.returned}</td>
                <td className='px-3 py-1.5'>{formatDuration(row.averageResponseMs)}</td>
                <td className='px-3 py-1.5'>{formatDuration(row.medianResponseMs)}</td>
                <td className='px-3 py-1.5'>{row.onTimePct === null ? '—' : `${row.onTimePct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
  return (
    <div className='space-y-3' data-testid='uat-review-performance'>
      <div className='flex flex-wrap gap-1.5'>
        <AiAction label='Which Consultant Has the Most Overdue Items?' question='Which consultant has the most overdue items, and how do the consultants compare on response time and on-time responses?' variant='ghost' className='h-7 text-xs' />
        <AiAction label='Summarize Consultant Responses' question='Summarize the recent consultant responses: decisions, the comments that need action, and what is waiting for our acknowledgement or revision.' variant='ghost' className='h-7 text-xs' />
      </div>
      {table('By consultant', data.byParty)}
      {table('By reviewer', data.byReviewer)}
      <p className='text-[11px] text-muted-foreground'>{data.basis}</p>
    </div>
  )
}

function ConsultantWorkspace({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const open = useReviewQueue(projectId, { status: 'open', sort: 'priority' })
  const done = useReviewQueue(projectId, { status: 'responded', sort: 'newest' })
  const s: ReviewSummary | undefined = open.data?.summary
  const now = open.dataUpdatedAt ? new Date(open.dataUpdatedAt).toISOString() : open.data?.now
  const mine = (open.data?.items ?? []).filter((row) => row.awaitingConsultant)
  const back = (open.data?.items ?? []).filter((row) => !row.awaitingConsultant)
  return (
    <div className='space-y-4' data-testid='uat-consultant-workspace'>
      <p className='text-sm text-muted-foreground'>Items submitted to you for review, most urgent first. The clock starts when the contractor submits.</p>
      {s && (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
          <Card label='Awaiting my review' value={s.awaitingConsultant} testId='uat-consultant-awaiting' />
          <Card label='Due today' value={s.dueToday} tone={s.dueToday ? 'text-amber-700 dark:text-amber-400' : undefined} />
          <Card label='Overdue' value={s.overdue} tone={s.overdue ? 'text-destructive' : undefined} testId='uat-consultant-overdue' />
          <Card label='Completed this week' value={s.respondedThisWeek} hint={s.averageResponseMs !== null ? `average ${formatDuration(s.averageResponseMs)}` : undefined} />
        </div>
      )}
      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>Open reviews</h3>
        {open.isLoading ? <p className='text-sm text-muted-foreground'>Loading…</p> : <QueueTable rows={mine} now={now} side='consultant' onOpen={onOpen} />}
      </section>
      {back.length > 0 && (
        <section className='space-y-2'>
          <h3 className='text-sm font-semibold'>Answered — now with the contractor</h3>
          <QueueTable rows={back} now={now} side='consultant' onOpen={onOpen} />
        </section>
      )}
      <section className='space-y-2'>
        <h3 className='text-sm font-semibold'>Recent responses</h3>
        <QueueTable rows={(done.data?.items ?? []).slice(0, 20)} now={now} side='consultant' onOpen={onOpen} />
      </section>
      <p className='text-[11px] text-muted-foreground'>Updated {formatStamp(now)}. Calendar time, not contract working days.</p>
    </div>
  )
}

/**
 * Consultant Reviews (CONSULTANT V1). The contractor sees every request out
 * to consultants — open time, due, overdue, who has the action — with
 * performance and the consultant parties; a consultant sees their own review
 * workspace and nothing of the contractor's.
 */
export function ConsultantReviewsModule({ projectId, initialRecordId = null }: { projectId: string; initialRecordId?: string | null }) {
  const external = useIsExternalParty()
  const canInvite = useCanPerform('external_review', 'update', 'external_review.invite')
  const [openId, setOpenId] = useState<string | null>(initialRecordId)
  const [tab, setTab] = useState('requests')
  const [inviting, setInviting] = useState(false)
  useEffect(() => {
    if (initialRecordId) setOpenId(initialRecordId)
  }, [initialRecordId])
  return (
    <div className='space-y-3' data-testid='uat-consultant-reviews'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='text-lg font-semibold'>{external ? 'My Review Workspace' : 'Consultant Reviews'}</h2>
        {!external && <p className='text-xs text-muted-foreground'>Everything submitted to consultants: who has the action, for how long, and when it is due.</p>}
        {!external && canInvite && <Button size='sm' variant='outline' className='ms-auto' onClick={() => { setTab('consultants'); setInviting(true) }} data-testid='uat-reviews-invite'><UserPlus className='h-4 w-4' /> Invite Consultant</Button>}
      </div>
      {external ? (
        <ConsultantWorkspace projectId={projectId} onOpen={setOpenId} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value='requests'>Open requests</TabsTrigger>
            <TabsTrigger value='performance'>Performance</TabsTrigger>
            <TabsTrigger value='consultants'>Consultants</TabsTrigger>
          </TabsList>
          <TabsContent value='requests'><ContractorRequests projectId={projectId} onOpen={setOpenId} /></TabsContent>
          <TabsContent value='performance'><Performance projectId={projectId} /></TabsContent>
          <TabsContent value='consultants'><ConsultantsPanel projectId={projectId} inviteOpen={inviting} onInviteOpenChange={setInviting} /></TabsContent>
        </Tabs>
      )}
      {openId && <ReviewSheet projectId={projectId} reviewId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
