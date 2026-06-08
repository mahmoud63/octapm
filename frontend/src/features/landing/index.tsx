import { useState, useEffect, useRef, useMemo, type ReactNode, type CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/context/theme-provider'

function useInView(t = 0.1) {
  const ref = useRef<HTMLDivElement>(null)
  const [v, setV] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); o.disconnect() } }, { threshold: t })
    o.observe(el)
    return () => o.disconnect()
  }, [t])
  return [ref, v] as const
}

function FadeIn({ children, delay = 0, dir = 'up', style = {} }: { children: ReactNode; delay?: number; dir?: 'up' | 'down' | 'left' | 'right' | 'none'; style?: CSSProperties }) {
  const [ref, v] = useInView(0.06)
  const m: Record<string, string> = { up: 'translateY(30px)', down: 'translateY(-30px)', left: 'translateX(30px)', right: 'translateX(-30px)', none: 'none' }
  return <div ref={ref} style={{ opacity: v ? 1 : 0, transform: v ? 'none' : m[dir], transition: `opacity 0.65s cubic-bezier(.22,1,.36,1) ${delay}s, transform 0.65s cubic-bezier(.22,1,.36,1) ${delay}s`, ...style }}>{children}</div>
}

function Counter({ end, suffix = '', duration = 1800 }: { end: number; suffix?: string; duration?: number }) {
  const [c, setC] = useState(0)
  const [ref, v] = useInView(0.2)
  useEffect(() => {
    if (!v) return
    let s = 0
    const step = end / (duration / 16)
    const t = setInterval(() => { s += step; if (s >= end) { setC(end); clearInterval(t) } else setC(Math.floor(s)) }, 16)
    return () => clearInterval(t)
  }, [v, end, duration])
  return <span ref={ref}>{c.toLocaleString()}{suffix}</span>
}

export function OctaPMLanding() {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const C = useMemo(() => ({
    // ── Theme-adaptive (CSS variables) ──────────────────────────────
    bg:      'var(--background)',
    bg2:     'var(--muted)',
    bg3:     'var(--muted)',
    surface: 'var(--card)',
    white:   'var(--card)',
    navy:    'var(--foreground)',
    navyL:   'var(--foreground)',
    text:    'var(--foreground)',
    dim:     'var(--muted-foreground)',
    border:  'var(--border)',
    border2: 'var(--border)',
    // Pale tints — opacity-based in dark, pastel in light
    bluePale:   isDark ? 'rgba(37,99,235,0.14)'   : '#EFF6FF',
    accentPale: isDark ? 'rgba(8,145,178,0.14)'   : '#ECFEFF',
    ctaPale:    isDark ? 'rgba(232,89,12,0.14)'   : '#FFF7ED',
    greenPale:  isDark ? 'rgba(5,150,105,0.14)'   : '#ECFDF5',
    goldPale:   isDark ? 'rgba(217,119,6,0.14)'   : '#FFFBEB',
    redPale:    isDark ? 'rgba(220,38,38,0.14)'   : '#FEF2F2',
    // Opacity composites (CSS vars can't use hex alpha suffix)
    navBg:      isDark ? 'rgba(11,20,55,0.92)'    : 'rgba(250,251,254,0.92)',
    overlayBtn: isDark ? 'rgba(14,22,50,0.87)'    : 'rgba(255,255,255,0.87)',
    // ── Always-dark sections (footer + final CTA + video modal) ────
    // In dark mode: use CSS vars so they match the app dark palette
    // In light mode: explicit dark navy so branded dark footer stays dark
    darkBg:          isDark ? 'var(--card)'              : '#0B1437',
    darkBgGradient:  isDark
      ? 'linear-gradient(135deg, var(--card) 0%, var(--muted) 100%)'
      : 'linear-gradient(135deg, #0B1437 0%, #18264A 100%)',
    darkHeading:     isDark ? 'var(--foreground)'        : '#ffffff',
    darkSubtext:     isDark ? 'var(--muted-foreground)'  : '#A0B0CC',
    darkMuted:       isDark ? 'var(--muted-foreground)'  : '#5A6A85',
    darkDim:         isDark ? 'oklch(0.45 0.04 260)'     : '#6A7A95',
    darkCopy:        isDark ? 'oklch(0.42 0.04 260)'     : '#4A5A75',
    darkDivider:     isDark ? 'var(--border)'            : '#1B2B5B',
    darkBadgeBg:     isDark ? 'var(--muted)'             : '#0F1D3A',
    darkBadgeText:   isDark ? 'var(--muted-foreground)'  : '#5A6A85',
    darkLinkHover:   isDark ? 'var(--foreground)'        : '#ffffff',
    // ── Brand colors (fixed, never change with theme) ───────────────
    blue:    '#2563EB',
    blueD:   '#1D4ED8',
    blueL:   '#3B82F6',
    accent:  '#0891B2',
    cta:     '#E8590C',
    ctaD:    '#C2410C',
    ctaL:    '#FB923C',
    green:   '#059669',
    greenD:  '#047857',
    gold:    '#D97706',
    red:     '#DC2626',
  }), [isDark])

  const [scrolled, setScrolled] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [annual, setAnnual] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [activeAudience, setActiveAudience] = useState(0)

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', h)
    return () => window.removeEventListener('scroll', h)
  }, [])

  const submit = () => { if (email.includes('@') && email.includes('.')) setSubmitted(true) }

  const EmailBox = ({ big }: { big?: boolean }) => submitted ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: big ? '16px 24px' : '12px 20px', background: C.greenPale, borderRadius: 12, border: `1px solid ${C.green}33` }}>
      <span style={{ fontSize: 20 }}>✓</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: C.greenD }}>You're on the list! We'll email you access shortly.</span>
    </div>
  ) : (
    <div style={{ display: 'flex', gap: 10, maxWidth: big ? 500 : 420, width: '100%', flexWrap: 'wrap' }}>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
        onKeyDown={e => e.key === 'Enter' && submit()}
        style={{ flex: 1, minWidth: 200, padding: big ? '16px 20px' : '13px 16px', borderRadius: 10, border: `1.5px solid ${C.border2}`, background: C.white, fontSize: 15, color: C.navy, fontFamily: 'inherit', outline: 'none', transition: 'border 0.2s' }}
        onFocus={e => (e.currentTarget.style.borderColor = C.blue)}
        onBlur={e => (e.currentTarget.style.borderColor = C.border2)} />
      <button onClick={submit}
        style={{ padding: big ? '16px 32px' : '13px 24px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.cta}, ${C.ctaD})`, color: C.white, fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', boxShadow: `0 4px 16px ${C.cta}44`, whiteSpace: 'nowrap' }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 28px ${C.cta}55` }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = `0 4px 16px ${C.cta}44` }}>
        Get Early Access →
      </button>
    </div>
  )

  const Badge = ({ icon, text, color = C.blue }: { icon: string; text: string; color?: string }) => (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 14px', borderRadius: 100, background: `${color}0C`, border: `1px solid ${color}1A`, marginBottom: 20 }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.8px', textTransform: 'uppercase', color }}>{text}</span>
    </div>
  )

  const Sec = ({ children, id, alt, style = {} }: { children: ReactNode; id?: string; alt?: boolean; style?: CSSProperties }) => (
    <section id={id} style={{ background: alt ? C.bg2 : C.bg, ...style }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '88px 24px' }}>{children}</div>
    </section>
  )

  const audiences = [
    { icon: '👤', title: 'Individual PMs', quote: 'I manage a $12M project on Excel because Primavera costs $10K and takes 6 months to learn.', solution: 'Free tier with full AI schedule generation. Pro at $29/mo gives you all 40+ modules, P6 import, and one-click reports. No training needed — if you can use a spreadsheet, you can use OctaPM.', stat: '3 hours → 1 click', statLabel: 'Weekly report time' },
    { icon: '🏗️', title: 'Construction Companies', quote: 'We have 8 active projects and no single view of which ones are in trouble. Our PMs each use different tools.', solution: 'One platform for every project. Role-based access for PM, QS, Planner, Site Engineer, Cost Controller, Procurement, and Finance. Portfolio dashboard shows all projects ranked by health score.', stat: '5 tools → 1', statLabel: 'Platform consolidation' },
    { icon: '📋', title: 'PM Consultancies', quote: 'A project health audit takes us 5 days of pulling data from the client\'s P6, Excel, and filing cabinet.', solution: 'Import the client\'s P6 file → OctaPM auto-generates the 7-dimension health score with schedule, cost, quality, safety, commercial, supply chain, and doc control. Export a branded report. 5 days becomes 2.', stat: '5 days → 2 days', statLabel: 'Audit delivery time' },
  ]

  const goToSignIn = () => navigate({ to: '/sign-in' })

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: "'DM Sans', sans-serif", fontSize: 15, lineHeight: 1.7, overflowX: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
        ::selection{background:${C.blue}22;color:${C.navy}}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${C.border2};border-radius:3px}
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes slideDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
        @media(max-width:820px){
          .g3{grid-template-columns:1fr !important}
          .g2{grid-template-columns:1fr !important}
          .g4{grid-template-columns:repeat(2,1fr) !important}
          .hero-grid{grid-template-columns:1fr !important}
          .dlinks{display:none !important}
          .mopen{display:flex !important}
          .cphide{display:none !important}
          .pricegrid{grid-template-columns:1fr !important;max-width:400px;margin-left:auto;margin-right:auto}
          .footgrid{grid-template-columns:1fr 1fr !important;text-align:center}
          .h1sz{font-size:34px !important}
          .h2sz{font-size:28px !important}
        }
      `}</style>

      {/* ═══ NAV ═══ */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200, padding: scrolled ? '8px 0' : '14px 0', background: scrolled ? C.navBg : 'transparent', backdropFilter: scrolled ? 'blur(16px)' : 'none', borderBottom: scrolled ? `1px solid ${C.border}` : '1px solid transparent', transition: 'all 0.3s' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, color: C.white, boxShadow: `0 2px 8px ${C.blue}33` }}>8</div>
            <span style={{ fontSize: 19, fontWeight: 800, color: C.navy, letterSpacing: '-0.4px' }}>OctaPM</span>
          </div>
          <div className="dlinks" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {['Features', 'How It Works', 'Pricing', 'FAQ'].map(s => (
              <a key={s} href={`#${s.toLowerCase().replace(/ /g, '-')}`} style={{ fontSize: 13.5, fontWeight: 500, color: C.dim, textDecoration: 'none', transition: 'color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = C.navy)}
                onMouseLeave={e => (e.currentTarget.style.color = C.dim)}>{s}</a>
            ))}
            <button onClick={() => setTheme(isDark ? 'light' : 'dark')}
              style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg2, color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.background = C.surface)}
              onMouseLeave={e => (e.currentTarget.style.background = C.bg2)}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={goToSignIn} style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>Sign In</button>
          </div>
          <button className="mopen" onClick={() => setMobileNav(!mobileNav)}
            style={{ display: 'none', background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            <span style={{ width: 18, height: 2, background: C.navy, borderRadius: 1 }} />
            <span style={{ width: 18, height: 2, background: C.navy, borderRadius: 1 }} />
            <span style={{ width: 14, height: 2, background: C.navy, borderRadius: 1 }} />
          </button>
        </div>
        {mobileNav && (
          <div style={{ padding: '16px 24px', background: C.surface, borderTop: `1px solid ${C.border}`, animation: 'slideDown 0.2s ease' }}>
            {['Features', 'How It Works', 'Pricing', 'FAQ'].map(s => (
              <a key={s} href={`#${s.toLowerCase().replace(/ /g, '-')}`} onClick={() => setMobileNav(false)}
                style={{ display: 'block', padding: '12px 0', fontSize: 15, fontWeight: 600, color: C.navy, textDecoration: 'none', borderBottom: `1px solid ${C.bg2}` }}>{s}</a>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button onClick={() => { setMobileNav(false); goToSignIn() }}
                style={{ flex: 1, padding: '12px', borderRadius: 8, background: C.cta, color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>Sign In →</button>
              <button onClick={() => setTheme(isDark ? 'light' : 'dark')}
                style={{ width: 46, borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg2, color: C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {isDark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* ═══ HERO ═══ */}
      <section style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)` }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${C.border} 1px, transparent 1px)`, backgroundSize: '28px 28px', opacity: 0.5 }} />
        <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto', padding: '132px 24px 72px' }}>
          <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 56, alignItems: 'center' }}>
            <div>
              <FadeIn delay={0}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 14px', borderRadius: 100, background: C.greenPale, marginBottom: 24 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, animation: 'pulse 2s infinite' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.greenD, letterSpacing: '0.3px' }}>Free beta — limited to first 200 users</span>
                </div>
              </FadeIn>
              <FadeIn delay={0.06}>
                <h1 className="h1sz" style={{ fontSize: 46, fontWeight: 800, color: C.navy, lineHeight: 1.1, marginBottom: 20, letterSpacing: '-1.5px' }}>
                  Generate a CPM schedule from your BOQ{' '}
                  <span style={{ color: C.cta }}>in 30 seconds.</span>
                </h1>
              </FadeIn>
              <FadeIn delay={0.12}>
                <p style={{ fontSize: 17, color: C.text, maxWidth: 460, lineHeight: 1.7, marginBottom: 12 }}>
                  Replace Primavera, Excel, and 3 other tools with one platform. Real-time earned value. 40+ modules. 1/10th the cost.
                </p>
              </FadeIn>
              <FadeIn delay={0.16}>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, marginTop: 24 }}>
                  {[
                    { v: '200-activity', l: 'schedule in 30s' },
                    { v: '$29/mo', l: 'vs $10K/yr for P6' },
                    { v: '3 hrs → 1 click', l: 'weekly reports' },
                  ].map(s => (
                    <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓</span>
                      <span style={{ fontSize: 13, color: C.text }}><strong style={{ color: C.navy }}>{s.v}</strong> {s.l}</span>
                    </div>
                  ))}
                </div>
              </FadeIn>
              <FadeIn delay={0.22}>
                <div style={{ marginTop: 24 }}>
                  <EmailBox big />
                  <p style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>Free forever plan. No credit card required.</p>
                </div>
              </FadeIn>
            </div>

            {/* Dashboard mockup */}
            <FadeIn delay={0.3} dir="left">
              <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: `0 32px 72px rgba(11,20,55,0.1), 0 0 0 1px ${C.border}`, background: C.white, position: 'relative' }}>
                <div style={{ height: 32, background: C.bg2, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#FCA5A5' }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#FCD34D' }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#6EE7B7' }} />
                  <span style={{ flex: 1, textAlign: 'center', fontSize: 10, color: C.dim, fontFamily: "'JetBrains Mono'" }}>app.octapm.com — Skyline Office Complex</span>
                </div>
                <div style={{ background: '#050E1D', padding: '14px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 8 }}>
                    {[{ v: '24', l: 'Activities', c: '#60A5FA' }, { v: '24', l: 'Critical', c: '#EF4444' }, { v: '0', l: 'Near-Crit', c: '#22C55E' }, { v: '10', l: 'Milestones', c: '#06B6D4' }, { v: '$6.06M', l: 'Budget', c: '#F59E0B' }, { v: '397d', l: 'Duration', c: '#F0F8FF' }].map((k, i) => (
                      <div key={i} style={{ padding: '8px 4px', background: '#0A1F3D', borderRadius: 5, border: '1px solid #122D57', textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: k.c, fontFamily: "'DM Sans'" }}>{k.v}</div>
                        <div style={{ fontSize: 6, color: '#4A6585', textTransform: 'uppercase', letterSpacing: '0.8px', marginTop: 1 }}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.5fr', gap: 6, marginBottom: 8 }}>
                    <div style={{ padding: '14px 8px', background: '#0A1F3D', borderRadius: 6, border: '1px solid #122D57', textAlign: 'center' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#10B981' }}>85</div>
                      <div style={{ fontSize: 7, color: '#10B981', fontWeight: 700, letterSpacing: '1.5px' }}>ON TRACK</div>
                      <div style={{ height: 2, background: '#10B981', borderRadius: 1, marginTop: 8 }} />
                    </div>
                    <div style={{ padding: '8px 10px', background: '#07182F', borderRadius: 6, border: '1px solid #122D57' }}>
                      {[
                        { l: 'Foundations', w: '72%', c: '#EF4444', es: '0%' },
                        { l: 'Structure FL1', w: '48%', c: '#EF4444', es: '12%' },
                        { l: 'Structure FL2', w: '36%', c: '#3B82F6', es: '24%' },
                        { l: 'MEP Rough-in', w: '28%', c: '#3B82F6', es: '20%' },
                        { l: 'Facade Install', w: '24%', c: '#06B6D4', es: '40%' },
                        { l: 'Finishing', w: '32%', c: '#8B5CF6', es: '52%' },
                      ].map((b, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: i < 5 ? 3 : 0 }}>
                          <span style={{ fontSize: 6, color: '#4A6585', width: 52, textAlign: 'right', flexShrink: 0, fontFamily: "'JetBrains Mono'" }}>{b.l}</span>
                          <div style={{ flex: 1, height: 7, background: '#0A1F3D', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', left: b.es, width: b.w, height: '100%', background: b.c, borderRadius: 2, opacity: 0.8 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                    {[{ v: '1.00', l: 'SPI', c: '#10B981', s: 'AHEAD' }, { v: '1.00', l: 'CPI', c: '#10B981', s: 'ON BUDGET' }, { v: '0%', l: 'Actual', c: '#F59E0B', s: 'DAY 30' }, { v: 'd397', l: 'Finish', c: '#06B6D4', s: 'ON TIME' }].map((m, i) => (
                      <div key={i} style={{ padding: '6px 4px', background: '#0A1F3D', borderRadius: 4, border: '1px solid #122D57', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: m.c }}>{m.v}</div>
                        <div style={{ fontSize: 6, color: '#4A6585' }}>{m.l}</div>
                        <div style={{ marginTop: 3, padding: '1px 6px', borderRadius: 3, background: `${m.c}18`, color: m.c, fontSize: 5.5, fontWeight: 700, display: 'inline-block' }}>{m.s}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={() => setVideoOpen(true)} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 56, height: 56, borderRadius: '50%', background: C.overlayBtn, border: `2px solid ${C.cta}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.15)', transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-50%,-50%) scale(1.1)'; e.currentTarget.style.background = C.ctaPale }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translate(-50%,-50%)'; e.currentTarget.style.background = C.overlayBtn }}>
                  <span style={{ fontSize: 20, color: C.cta, marginLeft: 3 }}>▶</span>
                </button>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══ VIDEO MODAL ═══ */}
      {videoOpen && (
        <div onClick={() => setVideoOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.darkBg, borderRadius: 16, padding: 32, maxWidth: 640, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: C.darkHeading, marginBottom: 8 }}>Demo Video Coming Soon</h3>
            <p style={{ fontSize: 14, color: C.darkSubtext, marginBottom: 24 }}>Record a 60-second screen recording of OctaPM in action and embed it here.</p>
            <button onClick={() => setVideoOpen(false)} style={{ padding: '12px 32px', borderRadius: 8, border: 'none', background: C.cta, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
          </div>
        </div>
      )}

      {/* ═══ COMPATIBILITY + STATS ═══ */}
      <div style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.white }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: '1.2px', textTransform: 'uppercase' }}>Works with</span>
          {['Primavera P6', 'MS Project', 'Excel', 'CSV', 'PDF'].map(t => (
            <span key={t} style={{ fontSize: 12, fontWeight: 600, color: C.navyL, padding: '5px 12px', borderRadius: 6, background: C.bg2, border: `1px solid ${C.border}` }}>{t}</span>
          ))}
        </div>
      </div>
      <div style={{ background: C.white }}>
        <div className="g4" style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, textAlign: 'center' }}>
          {[
            { n: 40, s: '+', l: 'Integrated PM Modules', c: C.blue },
            { n: 200, s: '', l: 'Activities in 30 seconds', c: C.cta },
            { n: 15, s: '', l: 'EVM Equations (PMBOK)', c: C.accent },
            { n: 3, s: '', l: 'P6 / MSP Parsers', c: C.green },
          ].map((s, i) => (
            <FadeIn key={i} delay={i * 0.06}>
              <div style={{ padding: '20px 16px', borderRadius: 12, background: C.bg, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: s.c }}><Counter end={s.n} />{s.s}</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontWeight: 500 }}>{s.l}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>

      {/* ═══ PROBLEM ═══ */}
      <Sec id="problem" alt>
        <FadeIn><Badge icon="⚡" text="The Problem" color={C.red} /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 12, letterSpacing: '-0.8px', lineHeight: 1.2 }}>
            Disconnected tools cost real money.
          </h2>
          <p style={{ fontSize: 15, color: C.text, marginBottom: 40, maxWidth: 560 }}>Every missed deadline, every unnoticed CPI drop, every overdue RFI has a price tag attached to it.</p>
        </FadeIn>
        <div className="g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {[
            { icon: '📊', n: '$240K', sub: 'average cost of a missed RFI deadline on a $50M project', title: 'Scattered Data', desc: 'Your schedule is in P6, costs in Excel, quality in Word. When a critical RFI goes overdue and nobody connects it to the delayed concrete pour, the entire critical path slips.', color: C.red },
            { icon: '💸', n: '$10K/yr', sub: 'for Primavera — and you still need 4 other tools', title: 'Overpriced & Fragmented', desc: 'Primavera is scheduling-only and costs $2-10K/year with mandatory training. Procore starts at $667/month and has no CPM engine. You pay premium prices for half a solution.', color: C.gold },
            { icon: '⏰', n: '40%', sub: "of a PM's time is spent on admin, not managing", title: 'Report Slavery', desc: 'Every Friday, 70% of construction PMs spend 3+ hours building a progress report that\'s already outdated by Monday. Copy-paste from P6 → Excel → Word → email → repeat.', color: C.blue },
          ].map((p, i) => (
            <FadeIn key={i} delay={i * 0.1}>
              <div style={{ padding: '28px 24px', background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, borderTop: `3px solid ${p.color}`, height: '100%', transition: 'all 0.3s', boxShadow: '0 1px 4px rgba(11,20,55,0.03)' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(11,20,55,0.07)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(11,20,55,0.03)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <span style={{ fontSize: 24 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: p.color, lineHeight: 1 }}>{p.n}</div>
                    <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.3 }}>{p.sub}</div>
                  </div>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{p.title}</h3>
                <p style={{ fontSize: 13.5, color: C.text, lineHeight: 1.7, margin: 0 }}>{p.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </Sec>

      {/* ═══ FEATURES ═══ */}
      <Sec id="features">
        <FadeIn><Badge icon="✦" text="Features" /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 44, letterSpacing: '-0.8px', lineHeight: 1.2 }}>
            One platform. Every module.<br /><span style={{ color: C.dim }}>Connected.</span>
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, marginBottom: 20, background: C.bluePale, borderRadius: 16, border: `1px solid ${C.blue}1A`, overflow: 'hidden' }}>
            <div style={{ padding: '36px 32px' }}>
              <div style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 100, background: `${C.blue}15`, color: C.blue, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', marginBottom: 14 }}>FLAGSHIP FEATURE</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: C.navy, marginBottom: 10 }}>AI Schedule Generation</h3>
              <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7, marginBottom: 16 }}>Upload your Bill of Quantities. OctaPM's 3-pass AI engine generates a complete CPM schedule: activities with predecessors, critical path, WBS, milestones, risk register, long-lead items, and resource allocation.</p>
              <div style={{ display: 'flex', gap: 16 }}>
                {[{ v: '30s', l: 'generation time' }, { v: '200', l: 'activities' }, { v: '3', l: 'AI passes' }].map(s => (
                  <div key={s.l}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.blue }}>{s.v}</div>
                    <div style={{ fontSize: 10, color: C.dim }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: '#050E1D', padding: '24px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {['Pass 1 — Schedule (10K tokens)', 'Pass 2 — Risks & Procurement (5K tokens)', 'Pass 3 — Resources (3K tokens)'].map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: i < 2 ? 12 : 0 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: i === 0 ? '#2563EB' : i === 1 ? '#06B6D4' : '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>{i + 1}</div>
                  <span style={{ fontSize: 11, color: '#A0B0CC', fontFamily: "'JetBrains Mono'" }}>{p}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
        <div className="g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            { icon: '📥', title: 'P6 / MSP Import', desc: 'Drop .xer or .xml files. Activities, predecessors, WBS, calendars, and progress transfer instantly. Zero re-entry.', tag: 'Instant', tagC: C.green },
            { icon: '📈', title: 'Real-Time Earned Value', desc: '15 EVM metrics update as you drag progress sliders. SPI, CPI, EAC, ETC — recalculated in under 100ms.', tag: 'Live', tagC: C.blue },
            { icon: '🎯', title: '7-Dimension Health', desc: 'Schedule, Cost, Commercial, Supply, Quality, Safety, Doc Control — each scored 0-100 with automatic penalties.', tag: 'Unique', tagC: C.gold },
            { icon: '📦', title: '40+ Modules', desc: 'Cost control, procurement, NCRs, safety, RFIs, submittals, claims, invoicing, sub valuations, diary — all connected.', tag: 'Complete', tagC: C.blue },
            { icon: '📄', title: 'One-Click Exports', desc: '6-sheet Excel, styled PDF, IPC CSV, cost report CSV, and printable EOT claim documents.', tag: 'Instant', tagC: C.green },
            { icon: '⚖️', title: 'EOT Claim Builder', desc: '5-step wizard: select event → affected activities → float analysis → LD calculation → print formal claim.', tag: 'Built-in', tagC: C.accent },
          ].map((f, i) => (
            <FadeIn key={i} delay={i * 0.06}>
              <div style={{ padding: '24px 22px', background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, height: '100%', transition: 'all 0.25s', boxShadow: '0 1px 3px rgba(11,20,55,0.02)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${C.blue}0A` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(11,20,55,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>{f.icon}</span>
                  <span style={{ padding: '2px 9px', borderRadius: 100, background: `${f.tagC}0C`, color: f.tagC, fontSize: 9.5, fontWeight: 700 }}>{f.tag}</span>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: C.text, lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </Sec>

      {/* ═══ 8 CONNECTED MODULES ═══ */}
      <Sec id="connected" alt>
        <FadeIn>
          <div style={{ textAlign: 'center' }}>
            <Badge icon="⬡" text="Connected Intelligence" color={C.blue} />
            <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 8, letterSpacing: '-0.8px' }}>
              8 dimensions. One platform.<br /><span style={{ color: C.dim }}>Zero blind spots.</span>
            </h2>
            <p style={{ fontSize: 15, color: C.text, marginBottom: 40, maxWidth: 520, margin: '0 auto 40px' }}>Every module feeds data to every other. A single progress update ripples through cost, quality, procurement, and safety — automatically.</p>
          </div>
        </FadeIn>
        <FadeIn delay={0.15}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <svg width="100%" viewBox="0 0 560 560" style={{ overflow: 'visible' }}>
              {(() => {
                const cx = 280, cy = 280, R = 220
                const mods = [
                  { label: 'Schedule', color: '#2563EB' },
                  { label: 'Cost Control', color: '#059669' },
                  { label: 'Procurement', color: '#0891B2' },
                  { label: 'Materials', color: '#D97706' },
                  { label: 'Commercial', color: '#7C3AED' },
                  { label: 'Safety', color: '#DC2626' },
                  { label: 'Quality', color: '#E8590C' },
                  { label: 'Doc Control', color: '#6366F1' },
                ]
                const pts = mods.map((_, i) => {
                  const angle = (Math.PI * 2 * i) / 8 - Math.PI / 2
                  return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }
                })
                const octPoints = pts.map(p => `${p.x},${p.y}`).join(' ')
                return (
                  <>
                    <polygon points={octPoints} fill="none" stroke="#CBD5E1" strokeWidth="0.75" strokeDasharray="6 4" opacity="0.5" />
                    {pts.map((p, i) => <line key={`hub-${i}`} x1={p.x} y1={p.y} x2={cx} y2={cy} stroke="#CBD5E1" strokeWidth="0.5" opacity="0.2" />)}
                    {pts.map((p, i) => { const next = pts[(i + 1) % 8]; return <line key={`adj-${i}`} x1={p.x} y1={p.y} x2={next.x} y2={next.y} stroke="#2563EB" strokeWidth="0.5" opacity="0.12" /> })}
                    {pts.map((p, i) => { const skip = pts[(i + 2) % 8]; return <line key={`skip-${i}`} x1={p.x} y1={p.y} x2={skip.x} y2={skip.y} stroke="#2563EB" strokeWidth="0.3" opacity="0.06" /> })}
                    <circle cx={cx} cy={cy} r={36} fill="white" stroke="#2563EB" strokeWidth="1.5" />
                    <circle cx={cx} cy={cy} r={30} fill="none" stroke="#2563EB" strokeWidth="0.5" opacity="0.3">
                      <animate attributeName="r" values="28;32;28" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
                    </circle>
                    <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 13, fontWeight: 800, fill: '#2563EB', fontFamily: "'DM Sans'" }}>Octa</text>
                    <text x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 13, fontWeight: 800, fill: '#2563EB', fontFamily: "'DM Sans'" }}>PM</text>
                    {mods.map((m, i) => {
                      const p = pts[i]
                      const w = m.label.length * 8.5 + 32
                      const h = 36
                      return (
                        <g key={i} style={{ cursor: 'pointer' }}>
                          <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={8} fill="white" stroke={m.color} strokeWidth="1" style={{ transition: 'all 0.2s' }}
                            onMouseEnter={e => { e.currentTarget.setAttribute('stroke-width', '2'); e.currentTarget.setAttribute('fill', `${m.color}0A`) }}
                            onMouseLeave={e => { e.currentTarget.setAttribute('stroke-width', '1'); e.currentTarget.setAttribute('fill', 'white') }} />
                          <circle cx={p.x - w / 2 + 14} cy={p.y} r={4} fill={m.color} opacity="0.8" />
                          <text x={p.x + 4} y={p.y} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 13, fontWeight: 700, fill: m.color, fontFamily: "'DM Sans'" }}>{m.label}</text>
                        </g>
                      )
                    })}
                  </>
                )
              })()}
            </svg>
          </div>
        </FadeIn>
        <FadeIn delay={0.25}><p style={{ textAlign: 'center', fontSize: 13, color: C.dim, marginTop: 16 }}>Every module connected. One change ripples everywhere.</p></FadeIn>
      </Sec>

      {/* ═══ HOW IT WORKS ═══ */}
      <Sec id="how-it-works" alt>
        <FadeIn><Badge icon="→" text="How It Works" color={C.accent} /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 56, letterSpacing: '-0.8px' }}>Three steps. Thirty seconds.</h2>
        </FadeIn>
        <div className="g3" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 0, alignItems: 'start' }}>
          {[
            { n: '1', title: 'Upload your BOQ', desc: 'Drop your spreadsheet (XLSX, CSV) or import your existing P6/MSP file.', time: '10 seconds', color: C.blue, bg: C.bluePale },
            null,
            { n: '2', title: 'AI generates your schedule', desc: 'Full CPM with critical path, WBS, milestones, risks, and resources.', time: '30 seconds', color: C.cta, bg: C.ctaPale },
            null,
            { n: '3', title: 'Track & control', desc: '40+ modules update live. One dashboard, one source of truth.', time: 'Ongoing', color: C.green, bg: C.greenPale },
          ].map((s, i) => s === null ? (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0 0' }}>
              <span style={{ fontSize: 24, color: C.border2 }}>→</span>
            </div>
          ) : (
            <FadeIn key={i} delay={(i / 2) * 0.12}>
              <div style={{ textAlign: 'center', padding: '0 12px' }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', border: `1px solid ${s.color}22` }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono'" }}>{s.n}</span>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: C.navy, marginBottom: 8 }}>{s.title}</h3>
                <p style={{ fontSize: 13.5, color: C.text, lineHeight: 1.65, marginBottom: 14 }}>{s.desc}</p>
                <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 100, background: s.bg, color: s.color, fontSize: 11.5, fontWeight: 700, fontFamily: "'JetBrains Mono'" }}>{s.time}</span>
              </div>
            </FadeIn>
          ))}
        </div>
      </Sec>

      {/* ═══ COMPARISON ═══ */}
      <Sec id="compare">
        <FadeIn><Badge icon="⚔" text="Comparison" /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 40, letterSpacing: '-0.8px' }}>See the difference.</h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div style={{ borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', background: C.white, boxShadow: '0 4px 20px rgba(11,20,55,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: C.bg2 }}>
                <th style={{ padding: '14px 18px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: '1px', textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>Capability</th>
                {['Excel', 'Primavera P6', 'Procore'].map(h => <th key={h} className="cphide" style={{ padding: '14px 14px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.dim, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}
                <th style={{ padding: '14px 18px', textAlign: 'center', fontSize: 12, fontWeight: 800, color: C.blue, background: C.bluePale, borderBottom: `2px solid ${C.blue}` }}>OctaPM ✦</th>
              </tr></thead>
              <tbody>
                {[
                  ['CPM Scheduling', '—', '✓', '—', '✓ AI'],
                  ['Earned Value (SPI, CPI, EAC)', '—', '~', '—', '✓ AI'],
                  ['Cost Control (7 categories)', '—', '—', '~', '✓'],
                  ['Quality / Safety / NCRs', '—', '—', '~', '✓'],
                  ['P6 File Import (.xer/.xml)', '—', '✓', '—', '✓'],
                  ['AI Schedule Generation', '—', '—', '—', '✓ AI'],
                  ['40+ Integrated Modules', '—', '—', '~', '✓'],
                  ['Claims & EOT Builder', '—', '—', '—', '✓'],
                ].map((r, ri) => (
                  <tr key={ri}>
                    <td style={{ padding: '11px 18px', fontSize: 13, fontWeight: 600, color: C.navy, borderBottom: `1px solid ${C.border}` }}>{r[0]}</td>
                    {[1, 2, 3].map(ci => (
                      <td key={ci} className="cphide" style={{ padding: '11px 14px', textAlign: 'center', fontSize: 13, color: r[ci] === '✓' ? C.green : r[ci] === '~' ? C.gold : '#D1D5DB', fontWeight: r[ci] === '✓' ? 700 : 400, borderBottom: `1px solid ${C.border}` }}>
                        {r[ci] === '~' ? 'Partial' : r[ci]}
                      </td>
                    ))}
                    <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: r[4].includes('AI') ? C.accent : C.green, background: C.bluePale, borderBottom: `1px solid ${C.blue}1A` }}>{r[4]}</td>
                  </tr>
                ))}
                <tr style={{ background: C.bg2 }}>
                  <td style={{ padding: '14px 18px', fontWeight: 700, color: C.navy }}>Annual Cost</td>
                  <td className="cphide" style={{ padding: '14px', textAlign: 'center', fontWeight: 700, color: C.green, fontSize: 13 }}>Free</td>
                  <td className="cphide" style={{ padding: '14px', textAlign: 'center', fontWeight: 700, color: C.red, fontSize: 13 }}>$2–10K</td>
                  <td className="cphide" style={{ padding: '14px', textAlign: 'center', fontWeight: 700, color: C.red, fontSize: 13 }}>$8K+</td>
                  <td style={{ padding: '14px', textAlign: 'center', fontWeight: 800, color: C.blue, fontSize: 15, background: C.bluePale }}>$0 – $348</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 16, padding: '14px 20px', background: C.ctaPale, borderRadius: 10, border: `1px solid ${C.cta}22`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
            <p style={{ fontSize: 14, color: C.navyL, margin: 0 }}>
              <strong>$348/year vs $10,000/year for Primavera.</strong> Same CPM engine. 40 more modules. AI that writes your schedule for you.
            </p>
          </div>
        </FadeIn>
      </Sec>

      {/* ═══ WHO IT'S FOR ═══ */}
      <Sec id="audience" alt>
        <FadeIn><Badge icon="👷" text="Built For" color={C.accent} /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 32, letterSpacing: '-0.8px' }}>For every construction professional.</h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 28, flexWrap: 'wrap' }}>
            {audiences.map((a, i) => (
              <button key={i} onClick={() => setActiveAudience(i)}
                style={{ padding: '10px 20px', borderRadius: 8, border: activeAudience === i ? `2px solid ${C.blue}` : `1px solid ${C.border}`, background: activeAudience === i ? C.bluePale : C.white, color: activeAudience === i ? C.blue : C.text, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{a.icon}</span>{a.title}
              </button>
            ))}
          </div>
          <div className="g2" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24, background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(11,20,55,0.04)' }}>
            <div style={{ padding: '36px 32px' }}>
              <div style={{ padding: '16px 20px', background: C.bg2, borderRadius: 10, borderLeft: `3px solid ${C.blue}`, marginBottom: 20 }}>
                <p style={{ fontSize: 15, color: C.text, fontStyle: 'italic', margin: 0, lineHeight: 1.6 }}>"{audiences[activeAudience].quote}"</p>
              </div>
              <p style={{ fontSize: 15, color: C.text, lineHeight: 1.7 }}>{audiences[activeAudience].solution}</p>
            </div>
            <div style={{ background: C.bluePale, padding: '36px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: C.blue, fontFamily: "'DM Sans'", lineHeight: 1 }}>{audiences[activeAudience].stat}</div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 8, fontWeight: 500 }}>{audiences[activeAudience].statLabel}</div>
            </div>
          </div>
        </FadeIn>
      </Sec>

      {/* ═══ FOUNDER ═══ */}
      <Sec id="founder">
        <FadeIn>
          <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
            <Badge icon="🛠" text="About" color={C.navyL} />
            <h2 className="h2sz" style={{ fontSize: 30, fontWeight: 800, color: C.navy, marginBottom: 16, letterSpacing: '-0.5px' }}>
              Built by a PM who got tired of<br />copy-pasting between 5 tools every Friday.
            </h2>
            <p style={{ fontSize: 15, color: C.text, lineHeight: 1.7, marginBottom: 24 }}>
              The 7-dimension health scoring, the 15 EVM equations, the EOT claim builder — they come from years of managing real construction projects, not a product manager's imagination.
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '14px 24px', background: C.bg2, borderRadius: 12, border: `1px solid ${C.border}`, marginBottom: 28 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${C.blue}, ${C.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.white, fontWeight: 800, fontSize: 16 }}>?</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>[Your Name], PMP</div>
                <div style={{ fontSize: 12, color: C.dim }}>Founder · [X] years in construction PM</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[{ v: '40+', l: 'PM Modules' }, { v: '15', l: 'EVM Equations' }, { v: '8,474', l: 'Lines of Code' }, { v: '60+', l: 'Data Relationships' }].map(s => (
                <div key={s.l} style={{ padding: '10px 18px', background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: C.blue }}>{s.v}</div>
                  <div style={{ fontSize: 10, color: C.dim }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </Sec>

      {/* ═══ PRICING ═══ */}
      <Sec id="pricing" alt>
        <FadeIn><Badge icon="💎" text="Pricing" color={C.green} /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 8, letterSpacing: '-0.8px' }}>Start free. Scale when ready.</h2>
          <p style={{ color: C.dim, fontSize: 15, marginBottom: 24 }}>No credit card required. No trial expiration.</p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 36 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: annual ? C.dim : C.navy }}>Monthly</span>
            <button onClick={() => setAnnual(!annual)} style={{ width: 48, height: 26, borderRadius: 13, padding: 3, background: annual ? C.blue : C.border2, border: 'none', cursor: 'pointer', transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: C.white, boxShadow: '0 1px 4px rgba(0,0,0,0.15)', transition: 'transform 0.2s', transform: annual ? 'translateX(22px)' : 'translateX(0)' }} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: annual ? C.navy : C.dim }}>Annual</span>
            <span style={{ padding: '3px 10px', borderRadius: 100, background: C.greenPale, color: C.greenD, fontSize: 11, fontWeight: 700 }}>Save 17%</span>
          </div>
        </FadeIn>
        <div className="pricegrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18, alignItems: 'start' }}>
          {[
            { name: 'Free', price: 0, annual: 0, period: 'forever', desc: 'Explore what\'s possible.', features: ['1 project', 'AI schedule generation', 'Basic dashboard & KPIs', 'Excel export', 'Community support'], cta: 'Start Free', hi: false },
            { name: 'Pro', price: 29, annual: 24, period: '/mo', desc: 'Full power. No limits.', features: ['Unlimited projects', 'P6 / MSP import', 'All 40+ modules', '7-dimension health scoring', 'Excel, PDF, CSV exports', 'Email support'], cta: 'Start Pro Trial', hi: true },
            { name: 'Team', price: 199, annual: 165, period: '/mo', desc: 'For multi-project companies.', features: ['Everything in Pro', '10 users included ($15/extra)', '7 role-based access levels', 'Portfolio dashboard', 'Budget revision tracking', 'Priority support + onboarding'], cta: 'Contact Sales', hi: false },
          ].map((p, i) => {
            const priceShow = annual ? p.annual : p.price
            return (
              <FadeIn key={i} delay={i * 0.08}>
                <div style={{ padding: '34px 26px', background: C.white, border: p.hi ? `2px solid ${C.blue}` : `1px solid ${C.border}`, borderRadius: 16, position: 'relative', boxShadow: p.hi ? `0 16px 48px ${C.blue}10` : '0 2px 8px rgba(11,20,55,0.03)', transition: 'all 0.25s' }}
                  onMouseEnter={e => { if (!p.hi) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(11,20,55,0.06)' } }}
                  onMouseLeave={e => { if (!p.hi) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(11,20,55,0.03)' } }}>
                  {p.hi && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', padding: '4px 16px', borderRadius: 100, background: C.blue, color: C.white, fontSize: 10.5, fontWeight: 700 }}>Most Popular</div>}
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: C.blue, marginBottom: 8 }}>{p.name}</h3>
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 42, fontWeight: 800, color: C.navy }}>${priceShow}</span>
                    <span style={{ fontSize: 14, color: C.dim, marginLeft: 3 }}>{p.period}</span>
                  </div>
                  {annual && p.price > 0 && <div style={{ fontSize: 12, color: C.green, fontWeight: 600, marginBottom: 4 }}>Save ${(p.price - p.annual) * 12}/year</div>}
                  <p style={{ fontSize: 13, color: C.dim, marginBottom: 22 }}>{p.desc}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
                    {p.features.map((f, fi) => (
                      <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: C.text }}>
                        <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>✓</span>{f}
                      </div>
                    ))}
                  </div>
                  <button onClick={goToSignIn} style={{ width: '100%', padding: '13px', borderRadius: 10, border: p.hi ? 'none' : `1px solid ${C.border}`, background: p.hi ? `linear-gradient(135deg, ${C.cta}, ${C.ctaD})` : C.white, color: p.hi ? C.white : C.navy, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', boxShadow: p.hi ? `0 4px 16px ${C.cta}33` : 'none' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; if (p.hi) e.currentTarget.style.boxShadow = `0 8px 28px ${C.cta}44`; else e.currentTarget.style.background = C.bg2 }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; if (p.hi) e.currentTarget.style.boxShadow = `0 4px 16px ${C.cta}33`; else e.currentTarget.style.background = C.white }}>
                    {p.cta}
                  </button>
                </div>
              </FadeIn>
            )
          })}
        </div>
      </Sec>

      {/* ═══ FAQ ═══ */}
      <Sec id="faq">
        <FadeIn><Badge icon="?" text="FAQ" /></FadeIn>
        <FadeIn delay={0.06}>
          <h2 className="h2sz" style={{ fontSize: 34, fontWeight: 800, color: C.navy, marginBottom: 36, letterSpacing: '-0.8px' }}>Questions & answers.</h2>
        </FadeIn>
        <div style={{ maxWidth: 700 }}>
          {[
            { q: 'Does OctaPM replace Primavera P6 or work alongside it?', a: 'Both. Import your existing P6 file (.xer or .xml) and continue inside OctaPM with 40 additional modules P6 doesn\'t have. Or generate a new CPM schedule from your BOQ using AI. Your P6 files are never modified.' },
            { q: 'How is the AI-generated schedule different from what a planner would produce?', a: 'It follows the same CPM logic — forward pass, backward pass, float calculation, critical path identification. The AI structures the work breakdown and activity sequencing based on your BOQ items, construction best practices, and phase-appropriate resource loading. You review and adjust, just like reviewing a junior planner\'s draft.' },
            { q: 'Is my project data secure?', a: 'Yes. All data is encrypted in transit (TLS) and at rest (AES-256). Your data is never shared with other users or used to train AI models. You own your data and can export or delete it at any time.' },
            { q: 'What if I already have a schedule in Primavera or MS Project?', a: 'Import it directly. OctaPM reads .xer files (P6), .xml files (P6 and MS Project), and Excel. Activities, predecessors, WBS, calendars, and progress data transfer automatically in seconds.' },
            { q: 'Can my whole team use OctaPM?', a: 'Yes. The Team plan ($199/mo) includes 10 users with role-based access. Seven roles: PM, QS, Planner, Site Engineer, Cost Controller, Procurement, and Finance. Each role sees modules relevant to their work.' },
            { q: 'Can I use OctaPM for projects outside construction?', a: 'OctaPM is purpose-built for construction. The BOQ parser, EVM engine, health scoring dimensions, and claims builder are all designed around construction workflows and contract structures (FIDIC, NEC, etc.).' },
            { q: 'Is there a long-term contract?', a: 'No. All plans are month-to-month. Cancel anytime. The Free plan never expires. No credit card required to start.' },
            { q: 'What happens to my data if I cancel?', a: 'You can export everything (Excel, PDF, CSV) before canceling. Your data remains accessible for 30 days after cancellation. After 30 days, it\'s permanently deleted from our servers.' },
          ].map((f, i) => (
            <FadeIn key={i} delay={i * 0.04}>
              <div style={{ borderBottom: `1px solid ${C.border}` }}>
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{ width: '100%', padding: '18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', gap: 16 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: openFaq === i ? C.blue : C.navy, textAlign: 'left', transition: 'color 0.2s' }}>{f.q}</span>
                  <span style={{ fontSize: 18, color: openFaq === i ? C.blue : C.dim, transform: openFaq === i ? 'rotate(45deg)' : 'none', transition: 'all 0.3s', flexShrink: 0 }}>+</span>
                </button>
                <div style={{ maxHeight: openFaq === i ? 220 : 0, overflow: 'hidden', transition: 'max-height 0.4s cubic-bezier(.22,1,.36,1)' }}>
                  <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7, paddingBottom: 18 }}>{f.a}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </Sec>

      {/* ═══ FINAL CTA ═══ */}
      <section style={{ background: C.darkBgGradient, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(${C.blueL}12 1px, transparent 1px)`, backgroundSize: '20px 20px' }} />
        <div style={{ position: 'relative', maxWidth: 660, margin: '0 auto', padding: '88px 24px', textAlign: 'center' }}>
          <FadeIn>
            <h2 style={{ fontSize: 36, fontWeight: 800, color: C.darkHeading, marginBottom: 14, letterSpacing: '-0.8px', lineHeight: 1.2 }}>
              Stop managing your project in 5 different tools.
            </h2>
          </FadeIn>
          <FadeIn delay={0.06}><p style={{ fontSize: 16, color: C.darkSubtext, marginBottom: 32 }}>Join the PMs who switched to one platform.</p></FadeIn>
          <FadeIn delay={0.12}>
            <div style={{ display: 'flex', justifyContent: 'center' }}><EmailBox big /></div>
            <p style={{ fontSize: 12, color: C.darkMuted, marginTop: 12 }}>Free forever. No credit card. Cancel anytime.</p>
          </FadeIn>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{ background: C.darkBg, padding: '56px 24px 36px' }}>
        <div className="footgrid" style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 40 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#fff' }}>8</div>
              <span style={{ fontSize: 17, fontWeight: 800, color: C.darkHeading }}>OctaPM</span>
            </div>
            <p style={{ fontSize: 12, color: C.darkDim, lineHeight: 1.6, maxWidth: 240 }}>Project Intelligence, Built to Build.</p>
          </div>
          {[
            { t: 'Product', l: ['Features', 'Pricing', 'P6 Import', 'AI Engine', 'Earned Value', 'Changelog'] },
            { t: 'Resources', l: ['Documentation', 'API Reference', 'Blog', 'Status'] },
            { t: 'Company', l: ['About', 'Contact', 'Privacy Policy', 'Terms'] },
          ].map(col => (
            <div key={col.t}>
              <h4 style={{ fontSize: 11, fontWeight: 700, color: C.darkSubtext, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 14 }}>{col.t}</h4>
              {col.l.map(l => <a key={l} href="#" style={{ display: 'block', fontSize: 13, color: C.darkMuted, textDecoration: 'none', marginBottom: 9, transition: 'color 0.2s' }} onMouseEnter={e => (e.currentTarget.style.color = C.darkLinkHover)} onMouseLeave={e => (e.currentTarget.style.color = C.darkMuted)}>{l}</a>)}
            </div>
          ))}
        </div>
        <div style={{ maxWidth: 1100, margin: '40px auto 0', paddingTop: 20, borderTop: `1px solid ${C.darkDivider}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <p style={{ fontSize: 11, color: C.darkCopy }}>© 2026 OctaPM. All rights reserved.</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {['Built on AWS', 'AI by Claude', 'Encrypted at Rest'].map(t => (
              <span key={t} style={{ padding: '3px 9px', borderRadius: 4, background: C.darkBadgeBg, fontSize: 9.5, color: C.darkBadgeText, fontWeight: 600 }}>{t}</span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
