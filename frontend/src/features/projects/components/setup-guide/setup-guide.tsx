import { useCallback, useState } from 'react'
import { ChevronDown, ChevronUp, Compass } from 'lucide-react'
import { statusBadge } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { ProjectSetupReadiness, ProjectSetupTarget } from '../../data/schema'
import { useSetupGuide } from '../../hooks/use-setup-guide'
import { STAGE_STATUS_LABEL, STAGE_TONE } from '../../lib/setup-stages'
import { SetupGuideStage } from './setup-guide-stage'
import { SetupReadinessStrip } from './setup-readiness-strip'

const OPEN_KEY = 'octa.project.setup-guide.open'

/** Open or closed per browser; storage throws in private windows. */
function useGuideOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === 'true'
    } catch {
      return false
    }
  })
  const set = useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, String(next))
    } catch {
      // A per-viewer convenience; losing it is not worth surfacing.
    }
  }, [])
  return [open, set] as const
}

type Props = {
  projectId: string
  readiness?: ProjectSetupReadiness
  onNavigate: (target: ProjectSetupTarget) => void
  canNavigate?: (target: ProjectSetupTarget) => boolean
}

/**
 * Guided setup (PC-8): the Overview readiness area's expanded mode. It walks
 * the ten stages of §32 over the readiness engine's one answer — the same
 * steps, gates and §33 headline the Setup Readiness card reads — and adds no
 * check, figure or request of its own.
 */
export function SetupGuide({ projectId, readiness, onNavigate, canNavigate = () => true }: Props) {
  const [open, setOpen] = useGuideOpen()
  const guide = useSetupGuide(readiness)
  if (!readiness) return null
  const current = guide.stages[guide.currentIndex]

  return (
    <section className='rounded-md border bg-card shadow-[var(--shadow-card)]' data-testid='setup-guide'>
      <button
        type='button'
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-testid='setup-guide-toggle'
        className='flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2.5 text-start hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      >
        <Compass className='h-4 w-4 shrink-0 text-primary' />
        <span className='text-sm font-semibold text-foreground'>Guided setup</span>
        {current && (
          <span className='text-xs text-muted-foreground' data-testid='setup-guide-current'>
            Stage {current.number} of {guide.stages.length}: {current.label}
          </span>
        )}
        {open ? (
          <ChevronUp className='ms-auto h-4 w-4 text-muted-foreground' />
        ) : (
          <ChevronDown className='ms-auto h-4 w-4 text-muted-foreground' />
        )}
      </button>

      {open && (
        <div className='space-y-3 border-t px-3 pt-3 pb-3'>
          <SetupReadinessStrip entries={readiness.summary.headline ?? []} />

          <ol className='flex flex-wrap gap-1.5' data-testid='setup-guide-stepper' aria-label='Setup stages'>
            {guide.stages.map((stage, index) => {
              const isCurrent = index === guide.currentIndex
              const isSelected = index === guide.selectedIndex
              return (
                <li key={stage.key}>
                  <button
                    type='button'
                    onClick={() => guide.select(stage.key)}
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-pressed={isSelected}
                    data-testid={`setup-guide-stage-${stage.key}`}
                    data-status={stage.status}
                    data-current={isCurrent ? 'true' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent/60',
                      isSelected && 'ring-2 ring-ring',
                      isCurrent && 'font-semibold'
                    )}
                  >
                    <span className='octa-numeric text-muted-foreground'>{stage.number}</span>
                    <span className='text-foreground'>{stage.label}</span>
                    <span className={cn('rounded px-1 text-[10px]', statusBadge(STAGE_TONE[stage.status]))}>
                      {STAGE_STATUS_LABEL[stage.status]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          {guide.selected && (
            <SetupGuideStage
              projectId={projectId}
              readiness={readiness}
              stage={guide.selected}
              isLast={guide.selectedIndex === guide.stages.length - 1}
              onContinue={() => guide.continueFrom(guide.selectedIndex)}
              onNavigate={onNavigate}
              canNavigate={canNavigate}
            />
          )}
        </div>
      )}
    </section>
  )
}
