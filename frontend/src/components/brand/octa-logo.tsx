import { cn } from '@/lib/utils'

/**
 * The OctaPM brand mark and wordmark.
 *
 * The mark is two octagonal blocks offset on the diagonal, reading as modular
 * construction units locking together. It lives as an asset at
 * `public/images/octapm-mark.svg`, redrawn from the supplied brand reference —
 * replace that file with the official vector and nothing here changes.
 *
 * The wordmark is set in Space Grotesk, the brand typeface, lowercase, at the
 * tight tracking the brand material uses. It is never stretched: only the
 * height varies and the mark keeps its aspect ratio.
 */

type Props = {
  /** Which surface it sits on, so the mark takes the right colour. */
  surface?: 'light' | 'dark'
  /** Mark only, for the collapsed rail and small spaces. */
  markOnly?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const MARK_SIZE = { sm: 'h-5', md: 'h-6', lg: 'h-8' } as const
const TEXT_SIZE = { sm: 'text-sm', md: 'text-base', lg: 'text-xl' } as const

export function OctaLogo({
  surface = 'light',
  markOnly = false,
  size = 'md',
  className,
}: Props) {
  const onDark = surface === 'dark'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2',
        onDark ? 'text-white' : 'text-primary',
        className
      )}
    >
      {/* Inline rather than <img>, so the mark follows the surface colour
          instead of needing a filter. The .svg asset stays for the favicon and
          anything outside React. */}
      <OctaMark className={cn(MARK_SIZE[size], 'w-auto')} />
      {!markOnly && (
        <span
          className={cn(
            'font-display truncate leading-none font-bold tracking-[-0.02em]',
            TEXT_SIZE[size]
          )}
        >
          octapm
        </span>
      )}
      <span className='sr-only'>OctaPM</span>
    </span>
  )
}

/**
 * The mark as inline SVG, for places that need it to follow `currentColor` —
 * the indigo rail, a hover state, a dark banner. Same geometry as the asset.
 */
export function OctaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 120 100'
      className={cn('size-6 shrink-0', className)}
      aria-hidden
      focusable='false'
    >
      <g
        fill='none'
        stroke='currentColor'
        strokeWidth={13}
        strokeLinejoin='miter'
      >
        <path
          d='M18.5 8.5h29L64 25v29L47.5 70.5h-29L2 54V25z'
          transform='translate(6.5 6.5) scale(0.86)'
        />
        <path
          d='M18.5 8.5h29L64 25v29L47.5 70.5h-29L2 54V25z'
          transform='translate(50 34) scale(0.86)'
        />
      </g>
    </svg>
  )
}
