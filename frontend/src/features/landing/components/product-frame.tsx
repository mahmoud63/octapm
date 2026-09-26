import { useEffect, useRef, useState } from 'react'

/**
 * The product frame in the hero: a short, silent film of the workspace itself.
 *
 * It used to be a drawing of a dashboard, captioned to say the figures were
 * examples. A recording of the real screens says the same thing without asking
 * to be believed — so the frame now shows the workspace being used, on a loop,
 * and the caption only has to name the project as a demonstration one.
 *
 * It behaves like a picture, not a player: silent, looping, no controls,
 * nothing to click, and hidden from screen readers behind the caption. A
 * poster still sits underneath, which is what people who ask for less motion
 * keep, what a browser that will not play WebM shows, and what fills the frame
 * until the film has arrived. The film is small and sits at the top of the
 * page, so it loads with it; a viewer who wants less motion is never sent it
 * at all.
 *
 * VITE_PRODUCT_FILM_URL / _POSTER move both files elsewhere (a bucket, a CDN)
 * without touching this file; VITE_LANDING_VIDEO_BASE, which the hero reel
 * already uses, is honoured for the same reason. A build that names no film
 * shows the still alone.
 */

const BASE = ((import.meta.env.VITE_LANDING_VIDEO_BASE as string | undefined) ?? '')
  .trim()
  .replace(/\/+$/, '')

/** A name already carrying its own host is left alone; the rest hang off BASE. */
const locate = (file: string) =>
  !BASE || /^(https?:)?\/\//i.test(file) ? file : `${BASE}/${file.replace(/^\/+/, '')}`

const FILM = (
  (import.meta.env.VITE_PRODUCT_FILM_URL as string | undefined) ?? '/media/product-tour.webm'
).trim()
const POSTER = (
  (import.meta.env.VITE_PRODUCT_FILM_POSTER as string | undefined) ??
  '/media/product-tour-poster.png'
).trim()

/** The project the film was recorded on, named in the window bar and the caption. */
const PROJECT = 'Marina Bay Residences'

export function ProductFrame() {
  const film = useRef<HTMLVideoElement>(null)
  const [still, setStill] = useState(false)
  const [lost, setLost] = useState(!FILM)

  // Someone who asks for less motion gets the still, and changing that
  // preference takes effect without a reload.
  useEffect(() => {
    const asked = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      setStill(asked.matches)
      const el = film.current
      if (!el) return
      if (asked.matches) el.pause()
      else void el.play().catch(() => undefined)
    }
    apply()
    asked.addEventListener('change', apply)
    return () => asked.removeEventListener('change', apply)
  }, [])

  return (
    <figure className='m-0' data-testid='uat-landing-product-frame'>
      <div
        className='octa-notch bg-white/15 p-px shadow-[0_40px_90px_-20px_rgba(5,10,40,0.55)]'
        style={{ '--notch': '22px' } as React.CSSProperties}
      >
        <div
          className='octa-notch bg-[#0a1030]'
          style={{ '--notch': '21px' } as React.CSSProperties}
        >
          {/* Window chrome, so it reads as an application rather than a video. */}
          <div className='flex items-center gap-2 border-b border-white/10 px-4 py-2.5'>
            <span className='size-2 rounded-full bg-white/25' />
            <span className='size-2 rounded-full bg-white/25' />
            <span className='size-2 rounded-full bg-white/25' />
            <span className='flex-1 text-center font-mono text-[10px] text-white/45'>
              app.octapm.com — {PROJECT}
            </span>
          </div>

          {/* 1280x800, the size it was filmed at, so the frame never jumps. */}
          <div className='relative aspect-[8/5] w-full overflow-hidden bg-[#0a1030]'>
            <img
              src={locate(POSTER)}
              alt=''
              aria-hidden
              className='absolute inset-0 size-full object-cover object-top'
            />
            {!lost && !still && (
              <video
                ref={film}
                data-testid='uat-landing-product-film'
                className='absolute inset-0 size-full object-cover object-top'
                src={locate(FILM)}
                poster={locate(POSTER)}
                muted
                loop
                autoPlay
                playsInline
                preload='auto'
                aria-hidden
                tabIndex={-1}
                onError={() => setLost(true)}
              />
            )}
          </div>
        </div>
      </div>
      <figcaption className='mt-3 text-center text-[11px] text-white/50'>
        The workspace, recorded on a demonstration project.
      </figcaption>
    </figure>
  )
}
