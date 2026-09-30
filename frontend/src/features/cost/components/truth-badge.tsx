import { FIGURE_TRUTH, parseTruth } from '@/lib/financial-terms'
import { cn } from '@/lib/utils'

/**
 * Says whether a figure is a source fact, derived, or a projection (PC-7a,
 * control model §3). Takes the server's label ("source", "derived",
 * "projection:<basis>") so the screen states what the API states.
 */
export function TruthBadge({
  truth,
  className,
}: {
  truth: string | null | undefined
  className?: string
}) {
  const parsed = parseTruth(truth)
  if (!parsed) return null
  const meta = FIGURE_TRUTH[parsed.kind]
  const basis = parsed.basis ? ` Basis: ${parsed.basis.replace(/_/g, ' ')}.` : ''
  return (
    <span
      className={cn(
        'ms-1 inline-flex items-center rounded border px-1 text-[10px] leading-4 font-medium',
        parsed.kind === 'source' && 'border-emerald-300 text-emerald-700',
        parsed.kind === 'derived' && 'border-sky-300 text-sky-700',
        parsed.kind === 'projection' &&
          'border-amber-300 border-dashed text-amber-700',
        className
      )}
      title={`${meta.hint}.${basis}`}
      data-truth={parsed.kind}
    >
      {meta.label}
    </span>
  )
}
