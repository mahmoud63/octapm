import { statusIcon } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { ProjectSetupHeadlineEntry } from '../../data/schema'

/**
 * The owner's §33 line — "BOQ imported PASS · Schedule imported PASS ·
 * Mapping 83% (by value) · Unmapped BOQ quantity 1,250 m3 · Critical unmapped
 * activities 4 · Baseline NOT APPROVED · Cost loading INCOMPLETE" — exactly
 * as the readiness engine wrote it (summary.headline). Nothing here is
 * computed: a figure the engine withheld from this viewer (mapping,
 * critical unmapped) reads "—" with the server's reason, never zero, and an
 * entry the engine left out (the bill's quantities and value, for a viewer
 * who may not read the BOQ) is not shown at all.
 */
export function SetupReadinessStrip({ entries }: { entries: ProjectSetupHeadlineEntry[] }) {
  if (entries.length === 0) return null
  return (
    <ul
      className='flex flex-wrap items-center gap-x-1 gap-y-1 text-xs'
      data-testid='setup-guide-strip'
      aria-label='Setup readiness'
    >
      {entries.map((entry, index) => (
        <li
          key={entry.key}
          className='flex items-center gap-1'
          data-testid={`setup-guide-strip-${entry.key}`}
          data-value={entry.value}
          data-withheld={entry.withheld ? 'true' : undefined}
        >
          {index > 0 && (
            <span aria-hidden className='text-muted-foreground'>
              ·
            </span>
          )}
          <span className='text-muted-foreground'>{entry.label}</span>
          <span
            className={cn('octa-numeric font-semibold', statusIcon(entry.tone))}
            title={entry.withheld ? entry.reason : undefined}
          >
            {entry.value}
          </span>
          {/* The engine's share is of the bill's value, not its rows. */}
          {entry.key === 'mapping' && !entry.withheld && (
            <span className='text-[11px] text-muted-foreground'>(by value)</span>
          )}
          {entry.withheld && (
            <span
              className='text-[11px] text-muted-foreground'
              data-testid={`setup-guide-strip-${entry.key}-withheld`}
            >
              ({entry.reason ?? 'unavailable to you'})
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
