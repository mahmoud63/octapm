import { useEffect, useRef, useState } from 'react'

/**
 * A film behind the landing hero.
 *
 * The hero keeps its gradient and octagon overlay; the film sits between the
 * two, tinted, so the headline and the product frame read exactly as before.
 * It plays only when a source is configured (VITE_LANDING_VIDEO_URL), so a
 * build without a film paints the brand ground and requests nothing. People
 * who ask for less motion see the poster (or the ground) instead, and a film
 * that fails to load steps aside rather than leaving a hole.
 */
const SOURCE = (import.meta.env.VITE_LANDING_VIDEO_URL as string | undefined)?.trim() || ''
const POSTER = (import.meta.env.VITE_LANDING_VIDEO_POSTER as string | undefined)?.trim() || undefined

const mimeFor = (url: string) => {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mov') return 'video/quicktime'
  return 'video/mp4'
}

export function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const [still, setStill] = useState(false)

  useEffect(() => {
    if (!SOURCE) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      setStill(query.matches)
      const el = video.current
      if (!el) return
      if (query.matches) el.pause()
      else void el.play().catch(() => setStill(true))
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  if (!SOURCE || failed) return null

  return (
    <div
      aria-hidden
      data-testid='uat-landing-hero-video'
      className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'
    >
      <video
        ref={video}
        className='h-full w-full object-cover'
        autoPlay={!still}
        muted
        loop
        playsInline
        preload='metadata'
        poster={POSTER}
        onError={() => setFailed(true)}
        tabIndex={-1}
      >
        <source src={SOURCE} type={mimeFor(SOURCE)} />
      </video>
      {/* the brand ground, kept at strength over the film so the type stays legible */}
      <div className='octa-hero absolute inset-0 opacity-[0.72]' />
    </div>
  )
}
