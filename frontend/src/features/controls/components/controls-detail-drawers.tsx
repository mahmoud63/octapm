import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRecordInUrl } from '@/hooks/use-record-in-url'
import { BoqDetailDrawer } from '@/features/boq/components/boq-detail-drawer'
import { ActivityDetailDrawer } from '@/features/schedule/components/activity-detail-drawer'
import {
  ControlsDetailContext,
  useControlsDetailOpener,
  type ControlsDetailOpener,
} from '../hooks/use-controls-detail'

type Crumb = { kind: 'boq_item' | 'activity'; id: string }

const BACK_LABEL: Record<Crumb['kind'], string> = {
  boq_item: 'BOQ item',
  activity: 'activity',
}

/**
 * The BOQ item and activity drawers as one story (PC-5). A page that hosts
 * them (the BOQ grid, the Gantt, the activity register, Mapping) wraps its
 * content in ControlsDetailHost: every opener below finds it through context.
 *
 * The open record lives in the address bar (`?recordId=&source=boq_item` or
 * `source=activity`), so a readiness item, a notification or a copied link
 * lands on its drawer, and a refresh keeps it. Only these two sources are
 * claimed — the schedule's other record sources stay with their registers.
 *
 * Walking from a BOQ item to one of its activities keeps a trail, so the
 * activity drawer offers "Back to BOQ item", and the other way round.
 */
function useControlsDetailDrawers(projectId: string) {
  const [itemId, setItemId] = useRecordInUrl('boq_item')
  const [activityId, setActivityId] = useRecordInUrl('activity')
  const [trail, setTrail] = useState<Crumb[]>([])

  const show = useCallback(
    (crumb: Crumb | null) => {
      setItemId(crumb?.kind === 'boq_item' ? crumb.id : null)
      setActivityId(crumb?.kind === 'activity' ? crumb.id : null)
    },
    [setItemId, setActivityId]
  )

  const current: Crumb | null = itemId
    ? { kind: 'boq_item', id: itemId }
    : activityId
      ? { kind: 'activity', id: activityId }
      : null

  // From a register: a fresh story. From inside a drawer: one more step.
  const opener = useMemo<ControlsDetailOpener>(
    () => ({
      openBoqItem: (id) => {
        setTrail([])
        show({ kind: 'boq_item', id })
      },
      openActivity: (id) => {
        setTrail([])
        show({ kind: 'activity', id })
      },
    }),
    [show]
  )
  const step = (next: Crumb) => {
    if (current && (current.kind !== next.kind || current.id !== next.id)) {
      setTrail((previous) => [...previous, current])
    }
    show(next)
  }
  const previous = trail.length ? trail[trail.length - 1] : null
  const back = previous
    ? {
        label: BACK_LABEL[previous.kind],
        onBack: () => {
          setTrail((list) => list.slice(0, -1))
          show(previous)
        },
      }
    : null
  const close = () => {
    setTrail([])
    show(null)
  }

  const drawers = (
    <>
      <BoqDetailDrawer
        projectId={projectId}
        itemId={itemId}
        onClose={close}
        onOpenActivity={(id) => step({ kind: 'activity', id })}
        back={itemId ? back : null}
      />
      <ActivityDetailDrawer
        projectId={projectId}
        activityId={itemId ? null : activityId}
        onClose={close}
        onOpenBoqItem={(id) => step({ kind: 'boq_item', id })}
        onOpenActivity={(id) => step({ kind: 'activity', id })}
        back={itemId ? null : back}
      />
    </>
  )

  return { opener, drawers }
}

/** Hosts the two drawers around a page's content, and gives its openers the way in. */
export function ControlsDetailHost({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const { opener, drawers } = useControlsDetailDrawers(projectId)
  return (
    <ControlsDetailContext.Provider value={opener}>
      {children}
      {drawers}
    </ControlsDetailContext.Provider>
  )
}

/**
 * A register row's way into the detail drawer. Drawn only inside a page
 * that hosts the drawers; it stops the click from also selecting the row.
 */
export function OpenDetailButton({
  kind,
  id,
  label,
  testId,
  className,
}: {
  kind: 'boq_item' | 'activity'
  id: string
  label: string
  testId?: string
  className?: string
}) {
  const opener = useControlsDetailOpener()
  if (!opener) return null
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
      onClick={(event) => {
        event.stopPropagation()
        if (kind === 'boq_item') opener.openBoqItem(id)
        else opener.openActivity(id)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <PanelRightOpen className='h-3.5 w-3.5' />
    </button>
  )
}
