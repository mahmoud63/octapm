import { ArrowRight, Ban, CheckCircle2, ShieldAlert } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { statusBadge, statusSolid, type StatusTone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { roleLabel } from '@/lib/permissions'
import type {
  ProjectSetupIssue,
  ProjectSetupItem,
  ProjectSetupReadiness,
  ProjectSetupTarget,
} from '../../data/schema'
import {
  STAGE_STATUS_LABEL,
  STAGE_TONE,
  type SetupStage,
} from '../../lib/setup-stages'
import { BoqRevisionActions, ScheduleRevisionActions } from './setup-guide-actions'

const NOT_OFFERED = 'This page is not offered to you'
const ITEMS_SHOWN = 5

/** The module page an address under the project opens, to offer only pages this member may open. */
function targetOfHref(href: string): ProjectSetupTarget | null {
  const match = /\/projects\/[^/?#]+\/([^/?#]+)(?:\/([^/?#]+))?/.exec(href)
  if (!match) return null
  return match[2] ? { module: match[1], child: match[2] } : { module: match[1] }
}

/**
 * A record behind an issue, linked to where it lives: the engine's href
 * already carries the workspace (/o/{slug}/projects/…) and the record in the
 * URL (recordId, status, source), so the router follows it as it stands.
 */
function ItemLink({
  item,
  canNavigate,
}: {
  item: ProjectSetupItem
  canNavigate: (target: ProjectSetupTarget) => boolean
}) {
  const navigate = useNavigate()
  const name = [item.code, item.label].filter(Boolean).join(' · ') || item.type
  const target = item.href ? targetOfHref(item.href) : null
  const testId = `setup-guide-item-${item.type}-${item.id ?? item.code ?? 'project'}`
  if (!item.href || (target && !canNavigate(target))) {
    return (
      <span data-testid={testId} data-inert='true' title={item.href ? NOT_OFFERED : undefined} className='text-xs'>
        <span className='font-medium'>{name}</span>
        <span className='text-muted-foreground'> — {item.missing}</span>
      </span>
    )
  }
  const href = item.href
  return (
    <a
      href={href}
      data-testid={testId}
      className='text-xs underline-offset-2 hover:underline'
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        void navigate({ href })
      }}
    >
      <span className='font-medium'>{name}</span>
      <span className='text-muted-foreground'> — {item.missing}</span>
    </a>
  )
}

function IssueList({
  title,
  issues,
  tone,
  testId,
  canNavigate,
}: {
  title: string
  issues: ProjectSetupIssue[]
  tone: StatusTone
  testId: string
  canNavigate: (target: ProjectSetupTarget) => boolean
}) {
  if (issues.length === 0) return null
  return (
    <div className='space-y-1.5' data-testid={testId}>
      <p className='text-xs font-semibold text-foreground'>{title}</p>
      <ul className='space-y-2'>
        {issues.map((issue, index) => {
          const items = issue.items ?? []
          const more = (issue.count ?? items.length) - Math.min(items.length, ITEMS_SHOWN)
          return (
            <li key={`${issue.code}-${index}`} data-testid={`${testId}-${issue.code}`} className='space-y-1'>
              <div className='flex items-start gap-1.5'>
                <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusSolid(tone))} />
                <span className='text-xs text-muted-foreground'>{issue.message}</span>
              </div>
              {items.length > 0 && (
                <ul className='ms-3 space-y-0.5'>
                  {items.slice(0, ITEMS_SHOWN).map((item, itemIndex) => (
                    <li key={`${item.type}-${item.id ?? item.code ?? itemIndex}`}>
                      <ItemLink item={item} canNavigate={canNavigate} />
                    </li>
                  ))}
                  {more > 0 && <li className='text-[11px] text-muted-foreground'>and {more} more</li>}
                </ul>
              )}
              {/* What the server withheld from this viewer is said, never shown as zero. */}
              {(issue.mappingDetailsWithheld || issue.boqDetailsWithheld || issue.itemsWithheld) && (
                <p className='ms-3 text-[11px] text-muted-foreground' data-testid={`${testId}-${issue.code}-withheld`}>
                  {issue.mappingDetailsWithheld
                    ? 'Mapping details unavailable to you.'
                    : issue.boqDetailsWithheld
                      ? `${issue.reason ?? 'BOQ details unavailable to you'}.`
                      : 'The BOQ records behind this are listed for people who can open the BOQ.'}
                </p>
              )}
              {issue.scheduleItemsWithheld && (
                <p className='ms-3 text-[11px] text-muted-foreground'>
                  {issue.scheduleReason ?? 'Schedule records are listed for people who can open the schedule'}.
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

type ScheduleCheck = { key: string; label?: string; passed: boolean; severity?: string; message?: string }

/** The schedule's own checks, as the engine's context carries them (stage 8). */
function scheduleChecksOf(readiness: ProjectSetupReadiness): ScheduleCheck[] {
  const scheduleReadiness = readiness.context?.scheduleReadiness as { checks?: unknown } | null | undefined
  return Array.isArray(scheduleReadiness?.checks) ? (scheduleReadiness.checks as ScheduleCheck[]) : []
}

type Props = {
  projectId: string
  readiness: ProjectSetupReadiness
  stage: SetupStage
  isLast: boolean
  onContinue: () => void
  onNavigate: (target: ProjectSetupTarget) => void
  canNavigate: (target: ProjectSetupTarget) => boolean
}

/** One stage: its member checks, blockers and warnings, its actions and its Continue. */
export function SetupGuideStage({
  projectId,
  readiness,
  stage,
  isLast,
  onContinue,
  onNavigate,
  canNavigate,
}: Props) {
  const tone = STAGE_TONE[stage.status]
  const checks = stage.key === 'validation' ? scheduleChecksOf(readiness) : []
  const progressGate = readiness.gates.progress
  const reportingGate = readiness.gates.reporting
  const executionAction = stage.steps.find((view) => view.step.key === 'progress_readiness')?.step.action

  return (
    <div
      className='space-y-3 rounded-md border bg-background p-3'
      data-testid='setup-guide-panel'
      data-stage={stage.key}
      data-status={stage.status}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='text-sm font-semibold text-foreground'>
          {stage.number}. {stage.label}
        </h4>
        <Badge variant='outline' className={cn('text-[11px]', statusBadge(tone))} data-testid='setup-guide-panel-status'>
          {STAGE_STATUS_LABEL[stage.status]}
        </Badge>
        {!stage.gated && stage.steps.length > 0 && (
          <span className='text-[11px] text-muted-foreground'>Advisory — no gate depends on it</span>
        )}
      </div>

      {stage.steps.length === 0 ? (
        <p className='text-xs text-muted-foreground' data-testid='setup-guide-not-checked'>
          The readiness check does not check this stage yet, so it is not shown as done.
        </p>
      ) : (
        <ul className='space-y-1' data-testid='setup-guide-members'>
          {stage.steps.map((view) => (
            <li
              key={`${view.step.key}-${view.guide?.key ?? ''}`}
              className='flex flex-wrap items-baseline gap-2 text-xs'
              data-testid={`setup-guide-member-${view.step.key}${view.guide ? `-${view.guide.key}` : ''}`}
              data-status={view.status}
            >
              <span className={cn('font-semibold', statusBadge(STAGE_TONE[view.status]), 'rounded px-1')}>
                {STAGE_STATUS_LABEL[view.status]}
              </span>
              <span className='font-medium text-foreground'>{view.guide?.label ?? view.step.label}</span>
              <span className='text-muted-foreground'>{view.guide?.detail ?? view.step.message}</span>
            </li>
          ))}
        </ul>
      )}

      {checks.length > 0 && (
        <ul className='space-y-0.5' data-testid='setup-guide-schedule-checks'>
          {checks.map((check) => (
            <li key={check.key} className='text-xs' data-testid={`setup-guide-check-${check.key}`} data-passed={String(check.passed)}>
              <span className={cn('font-semibold', check.passed ? 'text-success' : 'text-destructive')}>
                {check.passed ? 'PASS' : 'FAIL'}
              </span>{' '}
              <span className='text-muted-foreground'>{check.label ?? check.key}{check.message ? ` — ${check.message}` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      <IssueList title='Blockers' issues={stage.blockers} tone='blocked' testId='setup-guide-blockers' canNavigate={canNavigate} />
      <IssueList title='Warnings' issues={stage.warnings} tone='review' testId='setup-guide-warnings' canNavigate={canNavigate} />
      <IssueList title='Advisories' issues={stage.advisories} tone='info' testId='setup-guide-advisories' canNavigate={canNavigate} />

      <div className='flex flex-wrap items-center gap-2'>
        {stage.action && (
          <Button
            size='sm'
            variant='outline'
            onClick={() => stage.action && onNavigate(stage.action.target)}
            disabled={!canNavigate(stage.action.target)}
            title={canNavigate(stage.action.target) ? undefined : NOT_OFFERED}
            data-testid='setup-guide-open'
          >
            {stage.action.label}
            <ArrowRight className='h-3.5 w-3.5' />
          </Button>
        )}
        {stage.key === 'boq' && <BoqRevisionActions projectId={projectId} readiness={readiness} />}
        {(stage.key === 'validation' || stage.key === 'baseline') && (
          <ScheduleRevisionActions projectId={projectId} readiness={readiness} stage={stage.key} />
        )}
      </div>

      {stage.continueMode === 'end' ? (
        <div className='space-y-1.5 border-t pt-2 text-xs'>
          {/* Progress is the warn gate: it opens with the warnings shown. */}
          <div
            className='flex flex-wrap items-center gap-2'
            data-testid='setup-guide-gate-progress'
            data-ready={String(progressGate.ready)}
            data-mode={progressGate.mode}
          >
            <span className='font-semibold'>Progress entry:</span>
            <span className='text-muted-foreground'>{progressGate.message}</span>
            {executionAction && (
              <Button
                size='sm'
                onClick={() => onNavigate(executionAction.target)}
                disabled={!canNavigate(executionAction.target)}
                data-testid='setup-guide-continue'
                data-mode={progressGate.ready ? 'continue' : 'warn'}
              >
                {progressGate.ready ? 'Continue to progress' : 'Continue with warning'}
                <ArrowRight className='h-3.5 w-3.5' />
              </Button>
            )}
          </div>
          {reportingGate && (
            // Reporting is a block gate a PM may override with a reason when
            // locking a period (the EV report) — said, not offered here.
            <div
              className='flex flex-wrap items-center gap-2'
              data-testid='setup-guide-gate-reporting'
              data-ready={String(reportingGate.ready)}
              data-mode={reportingGate.mode}
            >
              <span className='font-semibold'>Official reporting:</span>
              {reportingGate.ready ? (
                <span className='inline-flex items-center gap-1 text-success'>
                  <CheckCircle2 className='h-3.5 w-3.5' /> {reportingGate.message}
                </span>
              ) : (
                <span className='inline-flex items-center gap-1 text-muted-foreground'>
                  <ShieldAlert className='h-3.5 w-3.5 text-destructive' />
                  Blocked. {reportingGate.message}
                  {reportingGate.overrideAllowedRoles && reportingGate.overrideAllowedRoles.length > 0 && (
                    <> Override: {reportingGate.overrideAllowedRoles.map(roleLabel).join(' or ')}, with a reason, when locking a period.</>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className='space-y-1.5 border-t pt-2'>
          {stage.continueMode === 'block' ? (
            <div data-testid='setup-guide-blocked' className='space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <Button size='sm' disabled data-testid='setup-guide-continue' data-mode='block'>
                  <Ban className='h-3.5 w-3.5' />
                  Blocked
                </Button>
                <span className='text-xs text-muted-foreground' data-testid='setup-guide-continue-reason'>
                  {stage.continueReason}
                </span>
              </div>
              <IssueList
                title='The gate is waiting on'
                issues={stage.gateBlockers}
                tone='blocked'
                testId='setup-guide-gate-blockers'
                canNavigate={canNavigate}
              />
            </div>
          ) : (
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                size='sm'
                variant={stage.continueMode === 'warn' ? 'outline' : 'default'}
                onClick={onContinue}
                disabled={isLast}
                data-testid='setup-guide-continue'
                data-mode={stage.continueMode}
              >
                {stage.continueMode === 'warn' ? 'Continue with warning' : 'Continue'}
                <ArrowRight className='h-3.5 w-3.5' />
              </Button>
              <span className='text-xs text-muted-foreground' data-testid='setup-guide-continue-reason'>
                {stage.continueReason}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
