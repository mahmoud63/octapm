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
 *
 * The schedule entries follow the engine's three states (R5-4): "Schedule
 * No schedule yet", "Schedule imported PASS (waiting for activation)" for a
 * staged revision, what the engine judges for a staged one it fails
 * ("Imported — revision rejected, resubmit", "Imported — no activities"),
 * PASS / FAIL for an active one — and "Critical unmapped activities" is a
 * count only on an active schedule with a critical path; until then the
 * engine says "Waiting for active schedule" or "No critical path yet"
 * (data-waiting), and so does the strip. With no bill the mapping entries
 * wait the same way ("Waiting for the BOQ"): a waiting share is no share
 * of the bill's value, so it carries no "(by value)".
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
          data-tone={entry.tone}
          data-withheld={entry.withheld ? 'true' : undefined}
          data-waiting={entry.waiting ? 'true' : undefined}
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
          {entry.key === 'mapping' && !entry.withheld && !entry.waiting && (
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
