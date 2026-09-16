import { useEffect, useRef, useState, type SyntheticEvent } from 'react'

/**
 * The film reel behind the landing hero.
 *
 * The hero keeps its gradient and octagon overlay; the reel sits between the
 * two, softened and tinted, so the headline and the product frame read exactly
 * as before: a blur takes the detail out of the footage (it is atmosphere, not
 * content) and a slight scale keeps the blur's soft edge outside the frame.
 *
 * VITE_LANDING_VIDEO_URL names one film, or several separated by commas. With
 * several, each holds the screen for a few seconds and then cross-fades into
 * the next across two stacked layers; only the film about to appear is
 * fetched, so the page never pays for the whole reel at once. A build that
 * names no film paints the brand ground and requests nothing. People who ask
 * for less motion get a still frame. A film that fails to load drops out of
 * the reel rather than leaving a hole, and if every film fails the reel steps
 * aside altogether.
 */
const SOURCES = (
  (import.meta.env.VITE_LANDING_VIDEO_URL as string | undefined) ?? ''
)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
const POSTER =
  (import.meta.env.VITE_LANDING_VIDEO_POSTER as string | undefined)?.trim() ||
  undefined

/** Screen time per film, and the cross-fade that ends it (also its head start). */
const HOLD_MS = 7000
const FADE_MS = 1600

export function HeroVideo() {
  const layerOne = useRef<HTMLVideoElement>(null)
  const layerTwo = useRef<HTMLVideoElement>(null)
  const lost = useRef(new Set<string>())
  const skip = useRef<() => void>(() => {})
  const [front, setFront] = useState(0)
  const [still, setStill] = useState(false)
  const [gone, setGone] = useState(SOURCES.length === 0)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setStill(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const one = layerOne.current
    const two = layerTwo.current
    if (gone || !one || !two) return

    let stopped = false
    let timer = 0
    let showing = 0 // the film in view, as a position in SOURCES
    let view = 0 // the layer it is playing on

    const left = () => SOURCES.filter((film) => !lost.current.has(film)).length
    const after = (position: number) => {
      for (let step = 1; step <= SOURCES.length; step += 1) {
        const candidate = (position + step) % SOURCES.length
        if (!lost.current.has(SOURCES[candidate])) return candidate
      }
      return -1
    }

    const roll = (film: string, el: HTMLVideoElement) => {
      // every film loops: the reel swaps it out on time, and a film shorter than its
      // turn would otherwise freeze on its last frame part-way through the fade
      el.loop = true
      if (el.dataset.film !== film) {
        el.dataset.film = film
        el.src = film
        el.load()
      }
      try {
        el.currentTime = 0
      } catch {
        // nothing loaded yet, so it begins at the first frame regardless
      }
      if (still) el.pause()
      else void el.play().catch(() => undefined)
    }

    const next = (now = false) => {
      if (stopped) return
      const upcoming = after(showing)
      // a single film needs no reel: it is already looping
      if (upcoming < 0 || upcoming === showing) return
      const back = view === 0 ? 1 : 0
      // start it behind the film in view, so the fade opens on moving picture
      roll(SOURCES[upcoming], back === 0 ? one : two)
      timer = window.setTimeout(
        () => {
          if (stopped) return
          showing = upcoming
          view = back
          setFront(back)
          timer = window.setTimeout(next, HOLD_MS - FADE_MS)
        },
        now ? 0 : FADE_MS
      )
    }

    skip.current = () => {
      window.clearTimeout(timer)
      next(true)
    }

    showing = lost.current.has(SOURCES[0]) ? after(0) : 0
    if (showing < 0) {
      setGone(true)
      return
    }
    setFront(0)
    roll(SOURCES[showing], one)
    if (!still && left() > 1) timer = window.setTimeout(next, HOLD_MS - FADE_MS)

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [still, gone])

  const stumbled = (event: SyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget
    if (el.dataset.film) lost.current.add(el.dataset.film)
    if (SOURCES.every((film) => lost.current.has(film))) {
      setGone(true)
      return
    }
    if (el === (front === 0 ? layerOne.current : layerTwo.current))
      skip.current()
  }

  if (gone) return null

  return (
    <div
      aria-hidden
      data-testid='uat-landing-hero-video'
      className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'
    >
      {[0, 1].map((layer) => (
        <video
          key={layer}
          ref={layer === 0 ? layerOne : layerTwo}
          data-testid={`uat-landing-hero-film-${layer}`}
          className='absolute inset-0 h-full w-full scale-[1.06] object-cover opacity-0 blur-[3px] brightness-[0.95] saturate-[0.95] transition-opacity ease-linear motion-reduce:transition-none'
          style={{
            opacity: front === layer ? 1 : 0,
            transitionDuration: `${FADE_MS}ms`,
          }}
          muted
          playsInline
          preload={layer === 0 ? 'auto' : 'none'}
          poster={layer === 0 ? POSTER : undefined}
          onError={stumbled}
          tabIndex={-1}
        />
      ))}
      {/* the brand ground, kept at strength over the reel so the colour stays OctaPM's */}
      <div className='octa-hero absolute inset-0 opacity-[0.38]' />
      {/* and a scrim weighted to the copy column, which is where contrast has to hold */}
      <div className='absolute inset-0 bg-[linear-gradient(180deg,rgba(7,14,48,0.68)_0%,rgba(7,14,48,0.4)_50%,rgba(7,14,48,0.68)_100%)] md:bg-[linear-gradient(100deg,rgba(7,14,48,0.86)_0%,rgba(7,14,48,0.5)_46%,rgba(7,14,48,0.08)_78%)]' />
    </div>
  )
}
