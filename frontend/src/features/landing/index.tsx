import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useRegistrationOpen } from '@/services/config/api'
import {
  ArrowRight,
  Check,
  Menu,
  Minus,
  Moon,
  Plus,
  Sun,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { OctaLogo, OctaMark } from '@/components/brand/octa-logo'
import { DimensionRing } from './components/dimension-ring'
import { HeroVideo } from './components/hero-video'
import {
  Counter,
  Eyebrow,
  OctaChip,
  Panel,
  Reveal,
  Section,
  SectionTitle,
  type ChipTone,
} from './components/primitives'
import { ProductFrame } from './components/product-frame'
import {
  AUDIENCES,
  BRAND,
  COMPARISON,
  FAQ,
  FEATURES,
  FLAGSHIP,
  NAV,
  PLANS,
  PROBLEMS,
  PROOF,
  STATS,
  STEPS,
  WORKS_WITH,
} from './content'

/**
 * The OctaPM marketing page.
 *
 * Built to the supplied brand book rather than to generic SaaS convention: the
 * Midnight Indigo → Royal Blue ground with the octagon tessellation over it,
 * Space Grotesk throughout, and Turquoise reserved for calls to action and
 * active states — the book budgets it at about 5% of the identity, so it never
 * becomes a surface colour here.
 *
 * The headline and promise paragraph are the brand's own approved lines.
 */
export function OctaPMLanding() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  // Where this deployment has self-service sign-up closed, every "get
  // started" call to action leads to sign-in instead (which explains that
  // organisations join by invitation), and the separate sign-in links that
  // would then duplicate it are dropped.
  const registrationOpen = useRegistrationOpen()
  const startTo = registrationOpen ? '/sign-up' : '/sign-in'
  const startLabel = registrationOpen ? 'Get started' : 'Sign in'
  const workspaceLabel = registrationOpen
    ? 'Create your workspace'
    : 'Sign in to your workspace'

  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [annual, setAnnual] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const [audience, setAudience] = useState(0)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div
      data-testid='uat-landing'
      className='min-h-svh bg-background font-sans text-foreground'
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header
        data-testid='uat-landing-header'
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
          scrolled
            ? 'border-b border-white/10 bg-[color-mix(in_srgb,var(--octa-midnight-indigo)_92%,transparent)] backdrop-blur-md'
            : 'border-b border-transparent'
        )}
      >
        <div className='mx-auto flex max-w-6xl items-center gap-6 px-6 py-3.5'>
          <a href='#top' className='shrink-0' aria-label='OctaPM home'>
            <OctaLogo surface='dark' size='md' />
          </a>

          <nav className='ms-auto hidden items-center gap-7 lg:flex'>
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className='text-[13px] font-medium text-white/70 transition-colors hover:text-white'
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className='ms-auto flex items-center gap-2 lg:ms-0'>
            <button
              type='button'
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              aria-label={isDark ? 'Use the light theme' : 'Use the dark theme'}
              className='octa-notch-all grid size-9 place-items-center text-white/70 transition-colors hover:bg-white/10 hover:text-white'
              style={{ '--notch': '9px' } as React.CSSProperties}
            >
              {isDark ? (
                <Sun className='size-4' />
              ) : (
                <Moon className='size-4' />
              )}
            </button>

            {registrationOpen && (
              <Link
                to='/sign-in'
                data-testid='uat-landing-sign-in'
                className='hidden px-3 py-2 text-[13px] font-medium text-white/80 transition-colors hover:text-white sm:block'
              >
                Sign in
              </Link>
            )}

            <Link
              to={startTo}
              data-testid='uat-landing-cta'
              className='octa-notch-all hidden bg-brand-accent px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-octa-turquoise-hover sm:block'
              style={{ '--notch': '9px' } as React.CSSProperties}
            >
              {startLabel}
            </Link>

            <button
              type='button'
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label='Menu'
              data-testid='uat-landing-menu'
              className='octa-notch-all grid size-9 place-items-center text-white transition-colors hover:bg-white/10 lg:hidden'
              style={{ '--notch': '9px' } as React.CSSProperties}
            >
              {menuOpen ? (
                <X className='size-4' />
              ) : (
                <Menu className='size-4' />
              )}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className='border-t border-white/10 bg-[var(--octa-midnight-indigo)] lg:hidden'>
            <nav className='mx-auto flex max-w-6xl flex-col px-6 py-2'>
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className='border-b border-white/10 py-3 text-sm font-medium text-white/80'
                >
                  {item.label}
                </a>
              ))}
              <div className='flex gap-2 py-4'>
                {registrationOpen && (
                  <Link
                    to='/sign-in'
                    className='octa-notch-all flex-1 bg-white/12 py-2.5 text-center text-sm font-medium text-white'
                    style={{ '--notch': '9px' } as React.CSSProperties}
                  >
                    Sign in
                  </Link>
                )}
                <Link
                  to={startTo}
                  className='octa-notch-all flex-1 bg-brand-accent py-2.5 text-center text-sm font-bold text-white'
                  style={{ '--notch': '9px' } as React.CSSProperties}
                >
                  {startLabel}
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section
        id='top'
        data-testid='uat-landing-hero'
        className='octa-hero octa-tess relative isolate overflow-hidden'
      >
        <HeroVideo />
        <div className='mx-auto grid max-w-6xl gap-14 px-6 pt-32 pb-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:pt-40 lg:pb-28'>
          <div>
            <p className='mb-6 inline-flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.16em] text-white/75 uppercase'>
              <span className='size-1.5 rounded-full bg-brand-accent' />
              Construction project controls
            </p>

            <h1 className='font-display text-4xl leading-[1.06] font-bold tracking-tight text-balance text-white [text-shadow:0_2px_4px_rgba(6,12,44,0.75),0_4px_28px_rgba(6,12,44,0.5)] sm:text-5xl xl:text-6xl'>
              {BRAND.headline}
            </h1>

            <p className='mt-6 max-w-xl text-base leading-relaxed text-white [text-shadow:0_1px_2px_rgba(6,12,44,0.92),0_2px_14px_rgba(6,12,44,0.8)]'>
              {BRAND.promise}
            </p>

            <div className='mt-9 flex flex-wrap items-center gap-3'>
              <Link
                to={startTo}
                className='octa-notch-all inline-flex items-center gap-2 bg-brand-accent px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-octa-turquoise-hover'
                style={{ '--notch': '11px' } as React.CSSProperties}
              >
                {workspaceLabel}
                <ArrowRight className='size-4' />
              </Link>
              <a
                href='#platform'
                className='octa-notch-all inline-flex items-center bg-white/12 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/20'
                style={{ '--notch': '11px' } as React.CSSProperties}
              >
                See the platform
              </a>
            </div>

            <ul className='mt-10 grid gap-3 sm:grid-cols-3'>
              {PROOF.map((item) => (
                <li key={item.value} className='border-t border-white/15 pt-3'>
                  <div className='font-display text-sm font-bold text-white'>
                    {item.value}
                  </div>
                  <div className='mt-0.5 text-xs leading-snug text-white/60'>
                    {item.label}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <ProductFrame />
        </div>
      </section>

      {/* ── Works with ──────────────────────────────────────────────────── */}
      <div className='border-b border-border bg-surface'>
        <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-7 gap-y-3 px-6 py-5'>
          <span className='text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase'>
            Works with
          </span>
          {WORKS_WITH.map((name) => (
            <span
              key={name}
              className='text-[13px] font-semibold text-primary/80'
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* ── Figures ─────────────────────────────────────────────────────── */}
      <div className='bg-background'>
        {/* The hairline rules come from a 1px gap showing the border colour, so
            the padding has to sit outside the grid or it becomes a grey band. */}
        <div className='mx-auto max-w-6xl px-6'>
          <div className='grid grid-cols-2 gap-px bg-border lg:grid-cols-4'>
            {STATS.map((stat, i) => (
              <Reveal key={stat.label} delay={i * 70}>
                <div className='h-full bg-background px-5 py-9 text-center'>
                  <div className='font-display text-4xl font-bold text-primary'>
                    <Counter to={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className='mt-2 text-[13px] text-muted-foreground'>
                    {stat.label}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>

      {/* ── The problem ─────────────────────────────────────────────────── */}
      <Section tone='muted'>
        <Reveal>
          <Eyebrow>The problem</Eyebrow>
          <SectionTitle className='max-w-2xl'>
            Disconnected records cost real money.
          </SectionTitle>
          <p className='mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground'>
            Every missed deadline, every unnoticed cost drift, every overdue RFI
            has a price attached to it — and it is only visible once the records
            are joined up.
          </p>
        </Reveal>

        <div className='mt-12 grid gap-5 md:grid-cols-3'>
          {PROBLEMS.map((problem, i) => (
            <Reveal key={problem.title} delay={i * 90}>
              <Panel className='h-full'>
                <div className='p-7'>
                  <OctaChip tone={problem.tone as ChipTone}>
                    {problem.figure}
                  </OctaChip>
                  <h3 className='mt-5 font-display text-lg font-bold text-primary'>
                    {problem.title}
                  </h3>
                  <p className='mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground'>
                    {problem.body}
                  </p>
                </div>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Platform ────────────────────────────────────────────────────── */}
      <Section id='platform'>
        <Reveal>
          <Eyebrow>The platform</Eyebrow>
          <SectionTitle className='max-w-2xl'>
            One platform. Every module. Connected.
          </SectionTitle>
        </Reveal>

        {/* Flagship */}
        <Reveal delay={80}>
          <Panel className='mt-12' frame='accent'>
            <div className='grid lg:grid-cols-[1.25fr_1fr]'>
              <div className='p-8 sm:p-10'>
                <OctaChip tone='accent'>{FLAGSHIP.eyebrow}</OctaChip>
                <h3 className='mt-5 font-display text-2xl font-bold text-primary'>
                  {FLAGSHIP.title}
                </h3>
                <p className='mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground'>
                  {FLAGSHIP.body}
                </p>
                <dl className='mt-7 flex flex-wrap gap-8'>
                  {FLAGSHIP.metrics.map((metric) => (
                    <div key={metric.label}>
                      <dt className='sr-only'>{metric.label}</dt>
                      <dd className='font-display text-2xl font-bold text-interactive'>
                        {metric.value}
                      </dd>
                      <dd className='text-[11px] text-muted-foreground'>
                        {metric.label}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* The three passes as a run, not as three loose lines: the rule
                  through the numbers is the engine going from one to the next. */}
              <div className='octa-tess flex flex-col justify-center bg-[var(--octa-midnight-indigo)] p-8 sm:p-10'>
                <Eyebrow onDark>What the engine does</Eyebrow>
                <ol className='mt-2'>
                  {FLAGSHIP.passes.map((pass, i) => {
                    const subject = pass.split('—').slice(1).join('—').trim()
                    const last = i === FLAGSHIP.passes.length - 1
                    return (
                      <li
                        key={pass}
                        className={cn('flex gap-4', !last && 'pb-5')}
                      >
                        <span className='flex flex-col items-center self-stretch'>
                          <span
                            className='octa-notch-all grid size-8 shrink-0 place-items-center bg-brand-accent font-display text-xs font-bold text-white'
                            style={{ '--notch': '8px' } as React.CSSProperties}
                          >
                            {i + 1}
                          </span>
                          {!last && (
                            <span
                              aria-hidden
                              className='mt-1.5 w-px flex-1 bg-white/25'
                            />
                          )}
                        </span>
                        <span className='pt-1'>
                          <span className='block text-[10.5px] font-bold tracking-[0.16em] text-white/50 uppercase'>
                            Pass {i + 1}
                          </span>
                          <span className='mt-0.5 block text-[13.5px] leading-snug text-white/90'>
                            {subject || pass}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </div>
          </Panel>
        </Reveal>

        <div className='mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3'>
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={i * 60}>
              <Panel className='h-full'>
                <div className='flex h-full flex-col p-7'>
                  <OctaChip
                    tone={feature.tone as ChipTone}
                    className='self-start'
                  >
                    {feature.tag}
                  </OctaChip>
                  <h3 className='mt-5 font-display text-base font-bold text-primary'>
                    {feature.title}
                  </h3>
                  <p className='mt-2 text-[13px] leading-relaxed text-muted-foreground'>
                    {feature.body}
                  </p>
                </div>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── The eight dimensions ────────────────────────────────────────── */}
      <Section id='dimensions' tone='muted'>
        <Reveal>
          <div className='mx-auto max-w-2xl text-center'>
            <div className='flex justify-center'>
              <Eyebrow>Connected intelligence</Eyebrow>
            </div>
            <SectionTitle>Eight dimensions. Zero blind spots.</SectionTitle>
            <p className='mt-4 text-[15px] leading-relaxed text-muted-foreground'>
              Every record carries the activity it belongs to. One progress
              update moves cost, earned value, procurement and the health score
              at the same moment — because they are the same data.
            </p>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className='mt-12'>
            <DimensionRing />
          </div>
        </Reveal>
      </Section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <Section id='how-it-works'>
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
          <SectionTitle className='max-w-2xl'>
            Three steps. Thirty seconds.
          </SectionTitle>
        </Reveal>

        <ol className='mt-12 grid gap-6 md:grid-cols-3'>
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 100}>
              <li className='h-full list-none border-t-2 border-interactive pt-6'>
                <div className='font-display text-3xl font-bold text-interactive tabular-nums'>
                  {step.n}
                </div>
                <h3 className='mt-3 font-display text-lg font-bold text-primary'>
                  {step.title}
                </h3>
                <p className='mt-2 text-[13.5px] leading-relaxed text-muted-foreground'>
                  {step.body}
                </p>
                <OctaChip tone='outline' className='mt-4 text-primary'>
                  {step.time}
                </OctaChip>
              </li>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* ── Comparison ──────────────────────────────────────────────────── */}
      <Section id='compare' tone='muted'>
        <Reveal>
          <Eyebrow>Where it fits</Eyebrow>
          <SectionTitle className='max-w-2xl'>
            What the other tools leave to you.
          </SectionTitle>
        </Reveal>

        <Reveal delay={80}>
          <Panel className='mt-10' innerClassName='overflow-x-auto'>
            <table className='w-full min-w-[640px] border-collapse text-left'>
              <caption className='sr-only'>
                Capabilities of OctaPM compared with spreadsheets, scheduling
                tools and field platforms.
              </caption>
              <thead>
                <tr className='border-b border-border'>
                  <th
                    scope='col'
                    className='px-6 py-4 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase'
                  >
                    Capability
                  </th>
                  {COMPARISON.columns.map((column) => (
                    <th
                      key={column}
                      scope='col'
                      className='px-4 py-4 text-center text-[12px] font-medium text-muted-foreground'
                    >
                      {column}
                    </th>
                  ))}
                  <th
                    scope='col'
                    className='bg-selected px-5 py-4 text-center text-[12px] font-bold text-primary'
                  >
                    OctaPM
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.rows.map((row) => (
                  <tr
                    key={row[0]}
                    className='border-b border-border last:border-0'
                  >
                    <th
                      scope='row'
                      className='px-6 py-3.5 text-[13px] font-semibold text-primary'
                    >
                      {row[0]}
                    </th>
                    {row.slice(1, 4).map((cell, ci) => (
                      <td
                        key={`${row[0]}-${ci}`}
                        className='px-4 py-3.5 text-center text-[13px] text-muted-foreground'
                      >
                        <Mark value={cell} />
                      </td>
                    ))}
                    <td className='bg-selected px-5 py-3.5 text-center'>
                      <Mark value={row[4]} strong />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </Reveal>
      </Section>

      {/* ── Who it's for ────────────────────────────────────────────────── */}
      <Section id='audience'>
        <Reveal>
          <Eyebrow>Built for</Eyebrow>
          <SectionTitle className='max-w-2xl'>
            For everyone who has to answer for the project.
          </SectionTitle>
        </Reveal>

        <Reveal delay={80}>
          <div
            role='tablist'
            aria-label='Who OctaPM is built for'
            className='mt-10 flex flex-wrap gap-2'
          >
            {AUDIENCES.map((item, i) => (
              <button
                key={item.title}
                type='button'
                role='tab'
                id={`audience-tab-${i}`}
                aria-selected={audience === i}
                aria-controls={`audience-panel-${i}`}
                onClick={() => setAudience(i)}
                className={cn(
                  'octa-notch-all px-5 py-2.5 text-sm font-semibold transition-colors',
                  // clip-path removes a border along with the corner, so the
                  // unselected state is a flat tint rather than an outline.
                  audience === i
                    ? 'bg-primary text-white'
                    : 'bg-octa-light-gray text-primary hover:bg-selected'
                )}
                style={{ '--notch': '10px' } as React.CSSProperties}
              >
                {item.title}
              </button>
            ))}
          </div>

          <Panel className='mt-5'>
            <div
              role='tabpanel'
              id={`audience-panel-${audience}`}
              aria-labelledby={`audience-tab-${audience}`}
              className='grid lg:grid-cols-[1.4fr_1fr]'
            >
              <div className='p-8 sm:p-10'>
                <blockquote className='border-s-2 border-interactive ps-5 text-[15px] leading-relaxed text-primary italic'>
                  {AUDIENCES[audience].quote}
                </blockquote>
                <p className='mt-6 text-[14.5px] leading-relaxed text-muted-foreground'>
                  {AUDIENCES[audience].solution}
                </p>
              </div>
              <div className='flex flex-col items-center justify-center bg-surface p-8 text-center sm:p-10'>
                <div className='font-display text-2xl leading-tight font-bold text-interactive'>
                  {AUDIENCES[audience].stat}
                </div>
                <div className='mt-2 text-[13px] text-muted-foreground'>
                  {AUDIENCES[audience].statLabel}
                </div>
              </div>
            </div>
          </Panel>
        </Reveal>
      </Section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <Section id='pricing' tone='muted'>
        <Reveal>
          <div className='text-center'>
            <div className='flex justify-center'>
              <Eyebrow>Pricing</Eyebrow>
            </div>
            <SectionTitle>Start free. Scale when it earns it.</SectionTitle>
            <p className='mt-4 text-[15px] text-muted-foreground'>
              No card to begin, and no trial that expires underneath you.
            </p>
          </div>
        </Reveal>

        <Reveal delay={60}>
          <div className='mt-9 flex items-center justify-center gap-3'>
            <span
              className={cn(
                'text-sm font-semibold',
                annual ? 'text-muted-foreground' : 'text-primary'
              )}
            >
              Monthly
            </span>
            <button
              type='button'
              role='switch'
              aria-checked={annual}
              aria-label='Show annual pricing'
              onClick={() => setAnnual((value) => !value)}
              className={cn(
                'relative h-6 w-11 rounded-full transition-colors',
                annual ? 'bg-brand-accent' : 'bg-border'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
                  annual ? 'translate-x-[22px]' : 'translate-x-0.5'
                )}
              />
            </button>
            <span
              className={cn(
                'text-sm font-semibold',
                annual ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              Annual
            </span>
            <OctaChip tone='success'>Save 17%</OctaChip>
          </div>
        </Reveal>

        <div className='mx-auto mt-10 grid max-w-4xl gap-5 md:grid-cols-3'>
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 80}>
              <Panel
                className='h-full'
                frame={plan.featured ? 'accent' : 'border'}
              >
                <div className='flex h-full flex-col p-7'>
                  {plan.featured && (
                    <OctaChip tone='accent' className='mb-4 self-start'>
                      Most chosen
                    </OctaChip>
                  )}
                  <h3 className='font-display text-sm font-bold tracking-wide text-interactive uppercase'>
                    {plan.name}
                  </h3>
                  <div className='mt-3 flex items-baseline gap-1'>
                    <span className='font-display text-4xl font-bold text-primary tabular-nums'>
                      ${annual ? plan.annual : plan.monthly}
                    </span>
                    <span className='text-sm text-muted-foreground'>
                      {plan.period}
                    </span>
                  </div>
                  {annual && plan.monthly > 0 && (
                    <p className='mt-1 text-xs font-semibold text-success'>
                      Saves ${(plan.monthly - plan.annual) * 12} a year
                    </p>
                  )}
                  <p className='mt-3 text-[13px] text-muted-foreground'>
                    {plan.tagline}
                  </p>

                  <ul className='mt-6 mb-8 flex flex-col gap-2.5'>
                    {plan.features.map((feature) => (
                      <li
                        key={feature}
                        className='flex items-start gap-2.5 text-[13px] text-foreground'
                      >
                        <Check className='mt-0.5 size-3.5 shrink-0 text-success' />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link
                    to={startTo}
                    className={cn(
                      // mt-auto pins the button to the bottom, so the three
                      // line up however long each feature list runs.
                      'octa-notch-all mt-auto block py-3 text-center text-sm font-bold transition-colors',
                      plan.featured
                        ? 'bg-brand-accent text-white hover:bg-octa-turquoise-hover'
                        : 'bg-octa-light-gray text-primary hover:bg-selected'
                    )}
                    style={{ '--notch': '10px' } as React.CSSProperties}
                  >
                    {registrationOpen ? plan.cta : startLabel}
                  </Link>
                </div>
              </Panel>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── FAQ ─────────────────────────────────────────────────────────── */}
      <Section id='faq'>
        <Reveal>
          <Eyebrow>Questions</Eyebrow>
          <SectionTitle className='max-w-2xl'>
            The things people ask first.
          </SectionTitle>
        </Reveal>

        <div className='mt-10 max-w-3xl'>
          {FAQ.map((item, i) => (
            <div key={item.q} className='border-b border-border'>
              <h3>
                <button
                  type='button'
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-answer-${i}`}
                  className='flex w-full items-center justify-between gap-6 py-5 text-start'
                >
                  <span
                    className={cn(
                      'font-display text-[15px] font-bold transition-colors',
                      openFaq === i ? 'text-interactive' : 'text-primary'
                    )}
                  >
                    {item.q}
                  </span>
                  {openFaq === i ? (
                    <Minus className='size-4 shrink-0 text-interactive' />
                  ) : (
                    <Plus className='size-4 shrink-0 text-muted-foreground' />
                  )}
                </button>
              </h3>
              <div id={`faq-answer-${i}`} hidden={openFaq !== i}>
                <p className='pb-5 text-[14px] leading-relaxed text-muted-foreground'>
                  {item.a}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Closing ─────────────────────────────────────────────────────── */}
      <section className='octa-hero octa-tess relative overflow-hidden'>
        <div className='mx-auto max-w-3xl px-6 py-24 text-center'>
          <Reveal>
            <h2 className='font-display text-3xl leading-tight font-bold tracking-tight text-balance text-white sm:text-4xl'>
              {BRAND.secondary}
            </h2>
            <p className='mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/75'>
              {BRAND.short}
            </p>
            <div className='mt-9 flex flex-wrap justify-center gap-3'>
              <Link
                to={startTo}
                className='octa-notch-all inline-flex items-center gap-2 bg-brand-accent px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-octa-turquoise-hover'
                style={{ '--notch': '11px' } as React.CSSProperties}
              >
                {workspaceLabel}
                <ArrowRight className='size-4' />
              </Link>
              {registrationOpen && (
                <Link
                  to='/sign-in'
                  className='octa-notch-all inline-flex items-center bg-white/12 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/20'
                  style={{ '--notch': '11px' } as React.CSSProperties}
                >
                  Sign in
                </Link>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className='bg-[var(--octa-midnight-indigo)] text-white'>
        <div className='mx-auto max-w-6xl px-6 py-14'>
          <div className='grid gap-10 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]'>
            <div>
              <OctaLogo surface='dark' size='md' />
              <p className='mt-4 max-w-xs text-[13px] leading-relaxed text-white/55'>
                {BRAND.short}
              </p>
              <p className='mt-5 text-[12px] font-medium tracking-wide text-white/40'>
                {BRAND.site}
              </p>
            </div>

            <FooterColumn
              title='Platform'
              links={[
                { label: 'Overview', href: '#platform' },
                { label: 'How it works', href: '#how-it-works' },
                { label: 'Comparison', href: '#compare' },
                { label: 'Pricing', href: '#pricing' },
              ]}
            />
            <FooterColumn
              title='Get started'
              links={[
                ...(registrationOpen
                  ? [{ label: 'Create an account', to: '/sign-up' }]
                  : []),
                { label: 'Sign in', to: '/sign-in' },
                { label: 'Questions', href: '#faq' },
              ]}
            />
            <FooterColumn
              title='Legal'
              links={[
                { label: 'Terms of Service', to: '/terms' },
                { label: 'Privacy Policy', to: '/privacy' },
              ]}
            />
          </div>

          <div className='mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-white/12 pt-6'>
            <p className='text-[11px] text-white/40'>
              © {new Date().getFullYear()} OctaPM. All rights reserved.
            </p>
            <OctaMark className='size-5 text-white/25' />
          </div>
        </div>
      </footer>
    </div>
  )
}

/** A capability cell: yes, partial, or not offered. */
function Mark({ value, strong = false }: { value: string; strong?: boolean }) {
  if (value === 'yes') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[13px] font-bold',
          strong ? 'text-success' : 'text-success'
        )}
      >
        <Check className='size-3.5' />
        <span className='sr-only'>Included</span>
      </span>
    )
  }
  if (value === 'partial') {
    return (
      <span className='text-[12px] font-medium text-warning-foreground'>
        Partial
      </span>
    )
  }
  return (
    <span className='text-muted-foreground/40'>
      <Minus className='mx-auto size-3.5' />
      <span className='sr-only'>Not offered</span>
    </span>
  )
}

type FooterLink = { label: string; href?: string; to?: string }

function FooterColumn({
  title,
  links,
}: {
  title: string
  links: readonly FooterLink[]
}) {
  return (
    <div>
      <h3 className='text-[11px] font-semibold tracking-[0.16em] text-white/50 uppercase'>
        {title}
      </h3>
      <ul className='mt-4 flex flex-col gap-2.5'>
        {links.map((link) => (
          <li key={link.label}>
            {link.to ? (
              <Link
                to={link.to}
                className='text-[13px] text-white/70 transition-colors hover:text-white'
              >
                {link.label}
              </Link>
            ) : (
              <a
                href={link.href}
                className='text-[13px] text-white/70 transition-colors hover:text-white'
              >
                {link.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
