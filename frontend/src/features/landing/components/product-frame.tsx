/**
 * The illustrative product frame in the hero.
 *
 * Deliberately a drawing, not a screenshot: it shows the shape of the workspace
 * — health score, earned value, a progress bar per package — without claiming to
 * be one customer's real figures. The caption says so.
 */

const KPIS = [
  { value: '86', label: 'Health', tone: 'var(--octa-turquoise)' },
  { value: '1.02', label: 'SPI', tone: 'var(--octa-success)' },
  { value: '0.97', label: 'CPI', tone: 'var(--octa-warning)' },
  { value: '412d', label: 'Duration', tone: 'var(--octa-azure)' },
]

const PACKAGES = [
  { label: 'Enabling works', start: 0, width: 22, tone: 'var(--octa-success)' },
  { label: 'Substructure', start: 14, width: 26, tone: 'var(--octa-success)' },
  { label: 'Superstructure', start: 32, width: 34, tone: 'var(--octa-royal-blue)' },
  { label: 'Envelope', start: 52, width: 26, tone: 'var(--octa-azure)' },
  { label: 'MEP first fix', start: 58, width: 30, tone: 'var(--octa-azure)' },
  { label: 'Fit-out', start: 74, width: 24, tone: 'var(--octa-turquoise)' },
]

export function ProductFrame() {
  return (
    <figure className='m-0'>
      <div
        className='octa-notch bg-white/15 p-px shadow-[0_40px_90px_-20px_rgba(5,10,40,0.55)]'
        style={{ '--notch': '22px' } as React.CSSProperties}
      >
        <div
          className='octa-notch bg-[#0a1030]'
          style={{ '--notch': '21px' } as React.CSSProperties}
        >
          {/* Window chrome, so it reads as an application rather than a chart. */}
          <div className='flex items-center gap-2 border-b border-white/10 px-4 py-2.5'>
            <span className='size-2 rounded-full bg-white/25' />
            <span className='size-2 rounded-full bg-white/25' />
            <span className='size-2 rounded-full bg-white/25' />
            <span className='flex-1 text-center font-mono text-[10px] text-white/45'>
              app.octapm.com — Riverside Tower
            </span>
          </div>

          <div className='space-y-3 p-4'>
            <div className='grid grid-cols-4 gap-2'>
              {KPIS.map((kpi) => (
                <div
                  key={kpi.label}
                  className='octa-notch bg-white/[0.06] px-2 py-3 text-center'
                  style={{ '--notch': '10px' } as React.CSSProperties}
                >
                  <div
                    className='font-display text-lg leading-none font-bold tabular-nums'
                    style={{ color: kpi.tone }}
                  >
                    {kpi.value}
                  </div>
                  <div className='mt-1.5 text-[9px] tracking-[0.12em] text-white/45 uppercase'>
                    {kpi.label}
                  </div>
                </div>
              ))}
            </div>

            <div
              className='octa-notch space-y-2 bg-white/[0.04] p-3'
              style={{ '--notch': '12px' } as React.CSSProperties}
            >
              {PACKAGES.map((row) => (
                <div key={row.label} className='flex items-center gap-3'>
                  <span className='w-24 shrink-0 truncate text-right text-[9px] text-white/50'>
                    {row.label}
                  </span>
                  <div className='relative h-2 flex-1 rounded-full bg-white/[0.07]'>
                    <div
                      className='absolute inset-y-0 rounded-full'
                      style={{
                        left: `${row.start}%`,
                        width: `${row.width}%`,
                        background: row.tone,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className='flex items-center justify-between gap-3 text-[10px]'>
              <span className='text-white/45'>Earned value to date</span>
              <span className='font-display font-bold text-white tabular-nums'>
                1,675,000
              </span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className='mt-3 text-center text-[11px] text-white/50'>
        Illustration of the workspace. Figures are examples, not a live project.
      </figcaption>
    </figure>
  )
}
