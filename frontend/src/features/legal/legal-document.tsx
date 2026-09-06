import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { OctaLogo } from '@/components/brand/octa-logo'

export type LegalSection = {
  id: string
  heading: string
  body: React.ReactNode
}

type Props = {
  title: string
  summary: string
  effectiveDate: string
  sections: LegalSection[]
  /** Shown above the contents. Deliberately outside the numbering: it is not a clause. */
  notice?: React.ReactNode
}

/**
 * The shell both legal documents share: a branded hero header, a contents
 * list that jumps within the page, and a readable measure for long prose.
 *
 * Reachable signed out, because the sign-in page links to it before anyone
 * has an account.
 */
export function LegalDocument({
  title,
  summary,
  effectiveDate,
  sections,
  notice,
}: Props) {
  return (
    <div className='min-h-svh bg-background'>
      <header className='octa-hero octa-pattern relative isolate overflow-hidden'>
        <div className='relative z-10 mx-auto max-w-4xl px-6 py-10'>
          <Link
            to='/sign-in'
            className='inline-flex items-center gap-1.5 text-sm text-white/75 transition-colors hover:text-white'
          >
            <ArrowLeft className='size-4' />
            Back to sign in
          </Link>
          <div className='mt-6 flex items-center gap-3'>
            <OctaLogo surface='dark' size='md' />
          </div>
          <h1 className='font-display mt-5 text-3xl font-bold tracking-tight text-white'>
            {title}
          </h1>
          <p className='mt-3 max-w-2xl text-sm leading-relaxed text-white/75'>
            {summary}
          </p>
          <p className='mt-4 text-xs text-white/55'>
            Effective {effectiveDate}
          </p>
        </div>
      </header>

      <main className='mx-auto max-w-4xl px-6 py-10'>
        {notice}

        <nav aria-label='Contents' className='mb-10 rounded-lg border bg-card p-4'>
          <h2 className='text-xs font-semibold tracking-wide text-primary uppercase'>
            Contents
          </h2>
          <ol className='mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2'>
            {sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className='text-muted-foreground transition-colors hover:text-interactive'
                >
                  <span className='tabular-nums'>{index + 1}.</span>{' '}
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className='space-y-10'>
          {sections.map((section, index) => (
            <section key={section.id} id={section.id} className='scroll-mt-8'>
              <h2 className='font-display text-lg font-bold tracking-tight text-foreground'>
                <span className='text-muted-foreground tabular-nums'>
                  {index + 1}.
                </span>{' '}
                {section.heading}
              </h2>
              <div className='mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-interactive [&_a]:underline [&_a]:underline-offset-4 [&_li]:ms-5 [&_li]:list-disc [&_strong]:text-foreground'>
                {section.body}
              </div>
            </section>
          ))}
        </div>

        <footer className='mt-14 border-t pt-6 text-xs text-muted-foreground'>
          <p>
            OctaPM — One Platform, Total Project Control.{' '}
            <Link to='/terms' className='underline underline-offset-4'>
              Terms of Service
            </Link>{' '}
            ·{' '}
            <Link to='/privacy' className='underline underline-offset-4'>
              Privacy Policy
            </Link>
          </p>
        </footer>
      </main>
    </div>
  )
}

/**
 * Shown at the top of both documents.
 *
 * These are drafted to cover what a construction project-controls platform
 * actually has to address — subcontractor and consultant access, project data
 * ownership, retention of contractual records — but they are not legal advice
 * and have not been reviewed by a lawyer.
 */
export function LegalReviewNotice() {
  return (
    <div className='mb-8 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning-foreground'>
      <p className='font-semibold'>Draft pending legal review</p>
      <p className='mt-1'>
        This document was prepared as a starting point and has not been reviewed
        by a qualified lawyer. Have counsel review and adapt it — particularly
        the governing law, liability and data-processing sections — before
        relying on it commercially.
      </p>
    </div>
  )
}
