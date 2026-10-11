import { OctaLogo } from '@/components/brand/octa-logo'
import { currentSurface } from '@/lib/domains'

// What the door says on each OctaPM host (domain architecture §13).
const PROMISE = {
  default: {
    title: ['One Platform,', 'Total Project Control'],
    body: 'Connect planning, execution, and reporting in one intelligent workspace designed to improve visibility, streamline collaboration, and keep every project on track.',
  },
  portal: {
    title: ['OctaPM Portal', 'Project collaboration'],
    body: 'Review submittals, RFIs, reports and inspections you were invited to, respond to the project team and keep every review cycle on record.',
  },
  admin: {
    title: ['OctaPM Admin', 'Platform Administration'],
    body: 'For authorized OctaPM platform staff only. Every view is audited, and a second factor is required for each session.',
  },
} as const

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * The signed-out shell.
 *
 * This is the one place the brand gets to speak at full volume — the hero
 * gradient and the octagonal structure, exactly as the brand material uses
 * them. Operational screens stay light and dense; the door does not have to.
 *
 * Two columns on a large screen: the brand promise on the left, the form on
 * the right on a clean surface so the fields stay legible. On a phone it
 * collapses to the form over the same ground.
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  const mode = currentSurface()
  const promise = mode === 'portal' || mode === 'admin' ? PROMISE[mode] : PROMISE.default
  return (
    <div className='octa-hero octa-pattern relative isolate min-h-svh w-full overflow-hidden'>
      <div className='relative z-10 mx-auto grid min-h-svh max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2 lg:gap-16'>
        {/* The promise. Hidden on small screens, where the form is the job. */}
        <section className='hidden flex-col text-white lg:flex'>
          <h1 className='font-display text-4xl leading-[1.1] font-bold tracking-tight text-balance xl:text-5xl'>
            {promise.title[0]}
            <br />
            {promise.title[1]}
          </h1>
          <p className='mt-5 max-w-md text-sm leading-relaxed text-white/75'>
            {promise.body}
          </p>
          <p className='mt-10 text-xs font-medium tracking-wide text-white/55'>
            octapm.com
          </p>
        </section>

        {/* The form. A light surface so inputs read normally on the dark ground. */}
        {/* The form, with the mark standing over it. On a phone the left column
            is gone entirely, so this is also the only place the brand appears. */}
        <section className='mx-auto w-full max-w-md'>
          <div className='mb-8 flex justify-center'>
            <OctaLogo surface='dark' size='xl' />
          </div>
          {children}
        </section>
      </div>
    </div>
  )
}
