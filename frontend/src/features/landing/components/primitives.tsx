import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The building blocks the marketing page is made of.
 *
 * All of the geometry here comes from the brand's eight-sided module: panels
 * have two corners chamfered at 45°, chips are full octagons. Nothing uses a
 * plain rounded rectangle, because that is the one shape the identity avoids.
 */

/** Fires once when the element first enters the viewport. */
function useRevealed(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Anyone who has asked for less motion gets the finished state immediately.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])

  return [ref, shown] as const
}

/**
 * Lifts content in as it scrolls into view.
 *
 * It starts visible and only slightly displaced rather than at zero opacity, so
 * a shared link or a thumbnail never captures a blank page.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const [ref, shown] = useRevealed()
  return (
    <div
      ref={ref}
      className={cn(
        'motion-safe:transition-all motion-safe:duration-700',
        className
      )}
      style={{
        opacity: shown ? 1 : 0.001,
        transform: shown ? 'none' : 'translateY(18px)',
        transitionDelay: `${delay}ms`,
        transitionTimingFunction: 'cubic-bezier(.22,1,.36,1)',
      }}
    >
      {children}
    </div>
  )
}

/** Counts up to a figure once it is on screen. */
export function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [ref, shown] = useRevealed(0.4)
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!shown) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to)
      return
    }
    const start = performance.now()
    const duration = 1100
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // Ease out, so it settles rather than stopping dead.
      setValue(Math.round(to * (1 - (1 - t) ** 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [shown, to])

  return (
    <span ref={ref} className='tabular-nums'>
      {value.toLocaleString()}
      {suffix}
    </span>
  )
}

/**
 * A framed surface with the brand's chamfer.
 *
 * `clip-path` cuts the border off with the corner, so the frame is drawn as a
 * filled outer element with a clipped inner one sitting one pixel inside it.
 */
export function Panel({
  children,
  className,
  innerClassName,
  frame = 'border',
  notch = 18,
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
  /** `border` for a hairline frame, `none` for a plain filled panel. */
  frame?: 'border' | 'none' | 'accent'
  notch?: number
}) {
  const style = { '--notch': `${notch}px` } as React.CSSProperties

  if (frame === 'none') {
    return (
      <div className={cn('octa-notch', className)} style={style}>
        {children}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'octa-notch p-px',
        frame === 'accent' ? 'bg-brand-accent' : 'bg-border',
        className
      )}
      style={style}
    >
      <div
        className={cn('octa-notch h-full bg-card', innerClassName)}
        style={{ '--notch': `${notch - 1}px` } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}

const CHIP_TONE = {
  accent: 'bg-brand-accent text-white',
  success: 'bg-success text-white',
  warning: 'bg-warning text-octa-charcoal',
  error: 'bg-error text-white',
  info: 'bg-octa-azure text-white',
  purple: 'bg-octa-purple text-white',
  indigo: 'bg-primary text-white',
  outline: 'bg-transparent text-inherit ring-1 ring-current/25',
} as const

export type ChipTone = keyof typeof CHIP_TONE

/** A full octagon, the way the brand book sets status labels. */
export function OctaChip({
  children,
  tone = 'indigo',
  className,
}: {
  children: ReactNode
  tone?: ChipTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'octa-notch-all inline-flex items-center px-3.5 py-1 text-[11px] font-semibold tracking-wide',
        CHIP_TONE[tone],
        className
      )}
      style={{ '--notch': '8px' } as React.CSSProperties}
    >
      {children}
    </span>
  )
}

/** The eyebrow that opens a section: a rule, then a short label. */
export function Eyebrow({
  children,
  onDark = false,
}: {
  children: ReactNode
  onDark?: boolean
}) {
  return (
    <p
      className={cn(
        'mb-4 inline-flex items-center gap-2.5 text-[11px] font-bold tracking-[0.2em] uppercase',
        onDark ? 'text-white/75' : 'text-interactive'
      )}
    >
      {/* the mark's own shape, small, so the label is anchored rather than adrift */}
      <span
        aria-hidden
        className='octa-notch-all size-2 shrink-0 bg-current'
        style={{ '--notch': '3px' } as React.CSSProperties}
      />
      {children}
    </p>
  )
}

/** A section heading at the page's one display size. */
export function SectionTitle({
  children,
  onDark = false,
  className,
}: {
  children: ReactNode
  onDark?: boolean
  className?: string
}) {
  return (
    <h2
      className={cn(
        'font-display text-3xl leading-[1.15] font-bold tracking-tight text-balance sm:text-4xl',
        onDark ? 'text-white' : 'text-primary',
        className
      )}
    >
      {children}
    </h2>
  )
}

/** Page section with the shared measure and rhythm. */
export function Section({
  children,
  id,
  tone = 'plain',
  className,
}: {
  children: ReactNode
  id?: string
  tone?: 'plain' | 'muted'
  className?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-20',
        tone === 'muted' ? 'bg-surface' : 'bg-background',
        className
      )}
    >
      <div className='mx-auto max-w-6xl px-6 py-20 sm:py-24'>{children}</div>
    </section>
  )
}
