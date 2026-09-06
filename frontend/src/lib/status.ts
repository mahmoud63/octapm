/**
 * OctaPM semantic status system.
 *
 * Status colour carries meaning product-wide, so it is defined once here rather
 * than chosen per screen:
 *
 *   done      completed, approved, healthy      green
 *   review    warning, pending, attention       amber
 *   blocked   failed, critical, rejected        red
 *   info      informational, active process     blue
 *   brand     primary system / navigation       indigo
 *   accent    special active highlight          turquoise
 *   neutral   inactive, draft, not started      light gray
 *
 * Every class below resolves to a design token, never a Tailwind palette
 * colour, so the brand moves in one place.
 */

export type StatusTone =
  | 'done'
  | 'review'
  | 'blocked'
  | 'info'
  | 'brand'
  | 'accent'
  | 'neutral'

type ToneStyles = {
  /** Badge or pill: soft ground, accessible text, matching hairline. */
  badge: string
  /** A 2px status stripe down the leading edge of a card or row. */
  stripe: string
  /** Icon or dot only. */
  icon: string
  /** Solid fill, for the rare case a status needs real weight. */
  solid: string
}

const TONES: Record<StatusTone, ToneStyles> = {
  done: {
    badge: 'border-success/30 bg-success-soft text-success-foreground',
    stripe: 'bg-success',
    icon: 'text-success',
    solid: 'bg-success text-white',
  },
  review: {
    badge: 'border-warning/40 bg-warning-soft text-warning-foreground',
    stripe: 'bg-warning',
    icon: 'text-warning-foreground',
    solid: 'bg-warning text-octa-charcoal',
  },
  blocked: {
    badge: 'border-error/30 bg-error-soft text-error-foreground',
    stripe: 'bg-error',
    icon: 'text-error',
    solid: 'bg-error text-white',
  },
  info: {
    badge: 'border-info/30 bg-info-soft text-info-foreground',
    stripe: 'bg-info',
    icon: 'text-info',
    solid: 'bg-info text-white',
  },
  brand: {
    badge: 'border-primary/25 bg-accent text-accent-foreground',
    stripe: 'bg-primary',
    icon: 'text-primary',
    solid: 'bg-primary text-primary-foreground',
  },
  accent: {
    badge: 'border-brand-accent/40 bg-brand-accent-soft text-success-foreground',
    stripe: 'bg-brand-accent',
    icon: 'text-brand-accent',
    solid: 'bg-brand-accent text-octa-charcoal',
  },
  neutral: {
    badge: 'border-border bg-muted text-muted-foreground',
    stripe: 'bg-border',
    icon: 'text-muted-foreground',
    solid: 'bg-muted text-foreground',
  },
}

export const statusBadge = (tone: StatusTone) => TONES[tone].badge
export const statusStripe = (tone: StatusTone) => TONES[tone].stripe
export const statusIcon = (tone: StatusTone) => TONES[tone].icon
export const statusSolid = (tone: StatusTone) => TONES[tone].solid

/**
 * Maps the words the backend actually uses onto a tone, so a status string can
 * be styled without every screen inventing its own mapping.
 */
export function toneForStatus(status: string | null | undefined): StatusTone {
  const value = String(status ?? '').toLowerCase().replace(/[\s-]+/g, '_')

  if (/^(done|complete|completed|approved|closed|ready|healthy|active|executed|paid|passed)$/.test(value)) {
    return 'done'
  }
  if (/^(review|pending|pending_review|submitted|in_review|warning|at_risk|awaiting|on_hold|processing|in_progress)$/.test(value)) {
    return 'review'
  }
  if (/^(blocked|failed|rejected|critical|overdue|void|cancelled|canceled|error|delayed|breach)$/.test(value)) {
    return 'blocked'
  }
  if (/^(info|open|new|scheduled|planned|queued|running)$/.test(value)) {
    return 'info'
  }
  if (/^(draft|inactive|archived|not_started|todo|n_a|none)$/.test(value)) {
    return 'neutral'
  }
  return 'brand'
}

/**
 * Financial variance. Never colour alone — pair with a sign or an arrow, so the
 * meaning survives for a colour-blind reader and in print.
 */
export function varianceTone(value: number, favourable: 'positive' | 'negative' = 'positive'): StatusTone {
  if (!Number.isFinite(value) || value === 0) return 'neutral'
  const good = favourable === 'positive' ? value > 0 : value < 0
  return good ? 'done' : 'blocked'
}
