import type { OfficialInstalled } from '@/features/boq/data/schema'
import { formatQuantity } from '../lib/detail-format'

/**
 * The official installed figure beside the installed figure (PC-6;
 * OCTAPM_PROGRESS_MEASUREMENT §5.1). Installed is Σ the approved quantity
 * entries; where the activity's latest approved progress carries a legacy
 * typed quantity as its floor, the official row stands above that Σ — earlier
 * progress was typed, not entered — and where that latest approved progress
 * is itself a typed figure with no entry minted behind it (installedBasis
 * 'client', 2026-10-01) the official row stands above the Σ too. The server
 * states both figures and why they differ; this draws the official one as it
 * was sent, under the installed figure, with the reason the server's
 * installedBasis names, so a reader sees the two and why. Nothing is computed
 * here, and a reader the server withholds the figure from is sent no note at
 * all.
 */
const OFFICIAL_REASON_TYPED = 'the latest approved progress was typed rather than entered'
const OFFICIAL_REASON_LEGACY_FLOOR = 'earlier progress was typed, not entered'

export function OfficialInstalledNote({
  official,
  testId,
}: {
  official: OfficialInstalled | null | undefined
  testId: string
}) {
  if (!official || official.value == null) return null
  const unit = official.unitCode ?? ''
  const reason =
    official.installedBasis === 'client'
      ? OFFICIAL_REASON_TYPED
      : OFFICIAL_REASON_LEGACY_FLOOR
  return (
    <p
      className='text-[11px] leading-snug text-amber-700 dark:text-amber-300'
      data-testid={testId}
      data-official-installed={official.value}
      data-official-unit={unit}
      data-official-basis={official.installedBasis ?? ''}
      title={official.basis ?? undefined}
    >
      Official installed:{' '}
      <span className='font-medium tabular-nums'>
        {formatQuantity(official.value)}
        {unit ? ` ${unit}` : ''}
      </span>
      {official.basis ? ` — ${official.basis}` : ''}. The approved entries add
      up to less because {reason}.
    </p>
  )
}
