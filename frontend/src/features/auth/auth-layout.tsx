import { OctaLogo } from '@/components/brand/octa-logo'

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
  return (
    <div className='octa-hero octa-pattern relative isolate min-h-svh w-full overflow-hidden'>
      <div className='relative z-10 mx-auto grid min-h-svh max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2 lg:gap-16'>
        {/* The promise. Hidden on small screens, where the form is the job. */}
        <section className='hidden flex-col text-white lg:flex'>
          <OctaLogo surface='dark' size='lg' />
          <h1 className='font-display mt-10 text-4xl leading-[1.1] font-bold tracking-tight text-balance xl:text-5xl'>
            One Platform,
            <br />
            Total Project Control
          </h1>
          <p className='mt-5 max-w-md text-sm leading-relaxed text-white/75'>
            Connect planning, execution, and reporting in one intelligent
            workspace designed to improve visibility, streamline collaboration,
            and keep every project on track.
          </p>
          <p className='mt-10 text-xs font-medium tracking-wide text-white/55'>
            octapm.com
          </p>
        </section>

        {/* The form. A light surface so inputs read normally on the dark ground. */}
        <section className='mx-auto w-full max-w-md'>
          <div className='mb-6 flex justify-center lg:hidden'>
            <OctaLogo surface='dark' size='lg' />
          </div>
          {children}
        </section>
      </div>
    </div>
  )
}
