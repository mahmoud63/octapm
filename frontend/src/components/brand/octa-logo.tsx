import { cn } from '@/lib/utils'

/**
 * The OctaPM brand mark and wordmark.
 *
 * The mark is eight octagons in a ring — the same eight-sided module repeated,
 * leaving a negative space at the centre that reads as the letter O. The
 * wordmark is the brand's custom octagonal lettering, not a font: both are the
 * real vectors from the supplied Illustrator artwork, carried across exactly.
 *
 * Do not redraw either by hand, and do not set "octapm" in Space Grotesk as a
 * substitute — the letterforms are chamfered from the octagon and a text
 * fallback loses the identity. Copies also live as standalone assets in
 * `public/images/` for the favicon and anything outside React.
 *
 * Everything paints with `currentColor`, so a mark on the indigo shell, in a
 * dark footer, or on white needs no recolouring — only the height varies.
 */

/** The ring, on its own bounding box. */
const MARK_W = 587.21
const MARK_H = 584.26
const MARK_D =
  'M473.31 386.72L434.41 386.72L389.66 431.47L389.66 472.17L348.93 431.45L238.3 431.45L197.71 472.04L197.71 431.47L152.95 386.72L113.93 386.72L152.99 347.81L152.99 237.17L113.22 197.57L152.99 197.57L197.42 152.81L197.42 111.93L238.3 152.81L348.93 152.81L389.66 112.09L389.66 152.81L434.41 197.57L474.01 197.57L434.4 237.17L434.4 347.81ZM587.21 347.81L587.21 237.17L542.32 192.42L502.86 192.42L542.47 152.81L542.47 89.51L497.71 44.88L434.41 44.88L393.69 85.49L393.69 44.5L348.93 0L238.3 0L193.54 44.5L193.54 85.61L152.99 44.88L89.36 44.88L44.9 89.51L44.9 152.81L84.25 192.42L44.9 192.42L0 237.17L0 347.81L44.9 392.57L83.8 392.57L44.89 431.47L44.89 494.77L89.65 539.4L152.95 539.4L193.54 498.93L193.54 539.76L238.3 584.26L348.93 584.26L393.69 539.76L393.69 498.79L434.41 539.4L497.71 539.4L542.47 494.77L542.47 431.47L503.56 392.57L542.32 392.57Z'

/** The six letters of "octapm", on their own bounding box. */
const WORD_W = 1683.35
const WORD_H = 371.66
const WORD_D = [
  'M205.44 246.32L56.72 246.32C53.73 246.32 51.31 243.89 51.31 240.9L51.31 131.25C51.31 128.26 53.73 125.84 56.72 125.84L205.44 125.84C208.43 125.84 210.86 128.26 210.86 131.25L210.86 240.9C210.86 243.89 208.43 246.32 205.44 246.32M262.16 130.63L206.06 74.53L56.1 74.53L0 130.63L0 241.52L56.1 297.62L206.06 297.62L262.16 241.52Z',
  'M366.44 125.84L506.74 125.84L506.65 74.53L365.82 74.53L309.71 130.63L309.71 241.52L365.82 297.62L506.65 297.62L506.74 246.32L366.44 246.32C363.45 246.32 361.02 243.89 361.02 240.9L361.02 131.25C361.02 128.26 363.45 125.84 366.44 125.84',
  'M727.26 297.62L727.34 246.32L613.83 246.32C610.84 246.32 608.42 243.89 608.42 240.9L608.42 131.25C608.42 128.26 610.84 125.84 613.83 125.84L703.14 125.84L703.05 74.53L613.83 74.53C610.84 74.53 608.42 72.1 608.42 69.11L608.42 0.01L557.11 0.01L557.11 241.52L613.21 297.62Z',
  'M1022.79 131.19L966.03 74.43L825.36 74.53L825.36 126.49L965.22 126.49C968.21 126.49 970.64 128.91 970.64 131.91L970.64 241.34C970.64 244.33 968.21 246.75 965.22 246.75L824.13 246.75C821.14 246.75 818.71 244.33 818.71 241.34L818.71 210.32C818.71 207.32 821.14 204.9 824.13 204.9L941.02 204.9L941.02 154.6L823.41 154.6L768.41 209.6L768.41 241.28L824.42 297.29L966.7 297.29L1022.79 241.19Z',
  'M1297.19 130.57L1241.07 74.45L1125.97 74.45L1069.88 130.54L1071.54 371.66L1122.85 371.66L1121.18 131.21C1121.16 128.2 1123.59 125.76 1126.6 125.76L1240.46 125.76C1243.42 125.76 1245.83 128.13 1245.87 131.09L1247.56 240.82C1247.61 243.84 1245.17 246.32 1242.14 246.32L1151.11 246.32L1151.11 297.62L1242.77 297.62L1298.85 241.54Z',
  'M1626.63 120.91C1629.62 120.91 1632.04 123.33 1632.04 126.32L1632.04 297.62L1683.35 297.62L1683.35 125.7L1627.25 69.6L1545.42 69.6L1514.98 100.04L1484.53 69.6L1402.71 69.6L1346.61 125.7L1346.61 297.62L1397.92 297.62L1397.92 126.32C1397.92 123.33 1400.34 120.91 1403.33 120.91L1483.91 120.91C1486.9 120.91 1489.33 123.33 1489.33 126.32L1489.32 297.62L1540.64 297.62L1540.63 126.4C1540.63 123.41 1543.05 120.99 1546.04 120.99Z',
]

/** The gap between mark and wordmark, measured from the supplied lockup. */
const GAP = 127.52
const LOCKUP_W = MARK_W + GAP + WORD_W
const WORD_Y = (MARK_H - WORD_H) / 2

type Props = {
  /** Which surface it sits on, so the mark takes the right colour. */
  surface?: 'light' | 'dark'
  /** Mark only, for the collapsed rail and small spaces. */
  markOnly?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE = { sm: 'h-5', md: 'h-6', lg: 'h-8' } as const

export function OctaLogo({
  surface = 'light',
  markOnly = false,
  size = 'md',
  className,
}: Props) {
  if (markOnly) {
    return (
      <OctaMark
        className={cn(
          SIZE[size],
          'w-auto',
          surface === 'dark' ? 'text-white' : 'text-primary',
          className
        )}
      />
    )
  }

  return (
    <svg
      viewBox={`0 0 ${LOCKUP_W} ${MARK_H}`}
      className={cn(
        SIZE[size],
        'w-auto shrink-0',
        surface === 'dark' ? 'text-white' : 'text-primary',
        className
      )}
      fill='currentColor'
      role='img'
      aria-label='OctaPM'
    >
      <path fillRule='nonzero' d={MARK_D} />
      <g transform={`translate(${MARK_W + GAP} ${WORD_Y})`}>
        {WORD_D.map((d) => (
          <path key={d.slice(0, 24)} fillRule='nonzero' d={d} />
        ))}
      </g>
    </svg>
  )
}

/** The ring alone, for favicons, avatars, the collapsed rail and loading states. */
export function OctaMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${MARK_W} ${MARK_H}`}
      className={cn('size-6 shrink-0', className)}
      fill='currentColor'
      aria-hidden
      focusable='false'
    >
      <path fillRule='nonzero' d={MARK_D} />
    </svg>
  )
}

/** The wordmark alone, where the mark already appears alongside. */
export function OctaWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WORD_W} ${WORD_H}`}
      className={cn('h-4 w-auto shrink-0', className)}
      fill='currentColor'
      role='img'
      aria-label='OctaPM'
    >
      {WORD_D.map((d) => (
        <path key={d.slice(0, 24)} fillRule='nonzero' d={d} />
      ))}
    </svg>
  )
}
