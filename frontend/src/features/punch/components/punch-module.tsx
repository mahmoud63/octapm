import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProjectSetupTarget } from '@/features/projects/data/schema'
import type { PunchFilters, PunchKind } from '../hooks/use-punch'
import type { PunchFormValue } from '../lib/form'
import { PunchCreateDialog } from './punch-create-dialog'
import { PunchDistributeDialog } from './punch-distribute-dialog'
import { PunchItemDetail } from './punch-item-detail'
import { PunchList } from './punch-list'

/**
 * Quality › Punch list. Deep links: `?recordId=<item>` opens the item;
 * `?source=sheet_qr&recordId=<sheet>` (from a printed sheet QR code) opens
 * quick-create with that drawing pre-selected and the list filtered to it.
 * The legacy defect register stays reachable underneath.
 */
export function PunchModule({
  projectId,
  initialTarget,
  legacy,
  kind = 'punch',
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
  legacy?: ReactNode
  /** Observations (OCTA-QA-OBS-015) reuse the module with a second kind. */
  kind?: PunchKind
}) {
  const fromSheetQr =
    initialTarget?.source === 'sheet_qr' && Boolean(initialTarget.recordId)
  const [detailId, setDetailId] = useState<string | null>(
    !fromSheetQr && initialTarget?.recordId ? initialTarget.recordId : null
  )
  const [create, setCreate] = useState<{
    open: boolean
    seed: number
    initial?: Partial<PunchFormValue>
  }>({
    open: fromSheetQr,
    seed: 0,
    initial: fromSheetQr ? { sheetId: initialTarget?.recordId } : undefined,
  })
  const [distribute, setDistribute] = useState<{
    open: boolean
    seed: number
    itemIds: string[]
    companyIds: string[]
  }>({ open: false, seed: 0, itemIds: [], companyIds: [] })
  const [showLegacy, setShowLegacy] = useState(false)

  const initialFilters: Partial<PunchFilters> = {
    status:
      initialTarget?.source === 'punch' && initialTarget.status
        ? initialTarget.status
        : undefined,
    sheetId: fromSheetQr ? initialTarget?.recordId : undefined,
  }

  return (
    <div className='space-y-4' data-testid='uat-punch-module' data-kind={kind}>
      <PunchList
        projectId={projectId}
        kind={kind}
        initialFilters={initialFilters}
        onOpenItem={setDetailId}
        onCreate={() =>
          setCreate((current) => ({
            open: true,
            seed: current.seed + 1,
            initial: fromSheetQr
              ? { sheetId: initialTarget?.recordId }
              : undefined,
          }))
        }
        onDistribute={({ itemIds, companyId }) =>
          setDistribute((current) => ({
            open: true,
            seed: current.seed + 1,
            itemIds,
            companyIds: companyId ? [companyId] : [],
          }))
        }
      />

      <PunchCreateDialog
        key={`create-${create.seed}`}
        projectId={projectId}
        kind={kind}
        open={create.open}
        onOpenChange={(open) => setCreate((current) => ({ ...current, open }))}
        initial={create.initial}
        onCreated={(items) => {
          if (items.length === 1) setDetailId(items[0].id)
        }}
      />

      <PunchDistributeDialog
        key={`distribute-${distribute.seed}`}
        projectId={projectId}
        kind={kind}
        open={distribute.open}
        onOpenChange={(open) =>
          setDistribute((current) => ({ ...current, open }))
        }
        itemIds={distribute.itemIds}
        defaultCompanyIds={distribute.companyIds}
      />

      <PunchItemDetail
        projectId={projectId}
        itemId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
      />

      {legacy ? (
        <div className='rounded border border-dashed'>
          <Button
            variant='ghost'
            size='sm'
            className='w-full justify-start text-muted-foreground'
            onClick={() => setShowLegacy((value) => !value)}
            data-testid='uat-punch-legacy-toggle'
          >
            {showLegacy ? (
              <ChevronDown className='mr-2 h-4 w-4' />
            ) : (
              <ChevronRight className='mr-2 h-4 w-4' />
            )}
            Legacy defect register
          </Button>
          {showLegacy && (
            <div className='space-y-2 border-t p-3'>
              <p className='text-xs text-muted-foreground'>
                Existing defects were copied into the punch list above; this
                register is kept for reference.
              </p>
              {legacy}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
