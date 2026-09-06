/**
 * Landing page copy and data.
 *
 * Kept out of the markup so the wording can be reviewed on its own. The hero
 * headline, the promise paragraph and the closing line are the brand book's own
 * lines — they are the approved way OctaPM introduces itself, and the page
 * should not invent a different one.
 */

export const BRAND = {
  headline: 'One Platform, Total Project Control',
  promise:
    'Connect planning, execution, and reporting in one intelligent workspace designed to improve visibility, streamline collaboration, and keep every project on track.',
  secondary: 'The Smarter Way to Manage Projects',
  short:
    'One intelligent workspace for planning, execution, and reporting — keeping projects on track.',
  site: 'octapm.com',
} as const

export const NAV = [
  { label: 'Platform', href: '#platform' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Compare', href: '#compare' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
] as const

export const PROOF = [
  { value: '200-activity', label: 'schedule generated in 30 seconds' },
  { value: '40+', label: 'connected project modules' },
  { value: '.xer / .xml', label: 'P6 and MS Project import' },
] as const

export const WORKS_WITH = [
  'Primavera P6',
  'MS Project',
  'Excel',
  'CSV',
  'PDF',
] as const

export const STATS = [
  { value: 40, suffix: '+', label: 'Integrated PM modules' },
  { value: 200, suffix: '', label: 'Activities in 30 seconds' },
  { value: 15, suffix: '', label: 'EVM equations (PMBOK)' },
  { value: 3, suffix: '', label: 'P6 / MSP file parsers' },
] as const

export const PROBLEMS = [
  {
    tone: 'error' as const,
    figure: 'Scattered',
    title: 'The record lives in five places',
    body: 'The schedule is in P6, costs in Excel, quality in Word, correspondence in email. When an overdue RFI delays a concrete pour, nothing connects the two until the critical path has already slipped.',
  },
  {
    tone: 'warning' as const,
    figure: 'Expensive',
    title: 'Premium price, half a solution',
    body: 'Scheduling tools do scheduling and nothing else. Field platforms do the field and have no CPM engine. You license both, plus spreadsheets to join them up.',
  },
  {
    tone: 'info' as const,
    figure: 'Manual',
    title: 'Friday belongs to the report',
    body: 'Hours a week rebuilding a progress report by hand — copy out of the schedule, into a spreadsheet, into a document, into an email — and it is out of date by Monday morning.',
  },
] as const

export const FLAGSHIP = {
  eyebrow: 'Flagship capability',
  title: 'AI schedule generation',
  body: 'Upload a Bill of Quantities. The three-pass engine returns a complete CPM schedule: activities with predecessors, the critical path, a work breakdown, milestones, a risk register, long-lead items and resource allocation.',
  metrics: [
    { value: '30s', label: 'generation time' },
    { value: '200', label: 'activities' },
    { value: '3', label: 'AI passes' },
  ],
  passes: [
    'Pass 1 — Schedule, WBS and critical path',
    'Pass 2 — Risks, procurement and long-lead items',
    'Pass 3 — Resource and cost allocation',
  ],
} as const

export const FEATURES = [
  {
    title: 'P6 / MSP import',
    body: 'Drop a .xer or .xml file. Activities, predecessors, WBS, calendars and progress transfer without re-entry, and your original file is never modified.',
    tag: 'Instant',
    tone: 'success' as const,
  },
  {
    title: 'Real-time earned value',
    body: 'Fifteen EVM metrics recalculate as progress is recorded. SPI, CPI, EAC and ETC move the moment the site updates a percentage.',
    tag: 'Live',
    tone: 'accent' as const,
  },
  {
    title: 'Seven-dimension health',
    body: 'Schedule, cost, commercial, supply chain, quality, safety and document control — each scored, each with the records behind the score one click away.',
    tag: 'Unique',
    tone: 'warning' as const,
  },
  {
    title: '40+ connected modules',
    body: 'Cost control, procurement, NCRs, safety, RFIs, submittals, claims, valuations and the daily diary — every record carries its activity, so nothing floats free.',
    tag: 'Complete',
    tone: 'info' as const,
  },
  {
    title: 'One-click exports',
    body: 'Multi-sheet Excel, branded PDF, IPC and cost CSVs, and printable claim documents — each carrying the OctaPM signature and a link back to the record.',
    tag: 'Signed',
    tone: 'accent' as const,
  },
  {
    title: 'EOT claim builder',
    body: 'Select the event, the affected activities and the float consumed; the wizard produces the delay analysis and the formal claim document.',
    tag: 'Built in',
    tone: 'purple' as const,
  },
] as const

/** The eight dimensions, in the ring the mark itself describes. */
export const DIMENSIONS = [
  { label: 'Schedule', color: 'var(--octa-royal-blue)' },
  { label: 'Cost', color: 'var(--octa-success)' },
  { label: 'Procurement', color: 'var(--octa-turquoise)' },
  { label: 'Materials', color: 'var(--octa-warning)' },
  { label: 'Commercial', color: 'var(--octa-purple)' },
  { label: 'Safety', color: 'var(--octa-error)' },
  { label: 'Quality', color: 'var(--octa-azure)' },
  // Neutral rather than a brand colour, and theme-aware: Midnight Indigo would
  // disappear against the dark ground.
  { label: 'Documents', color: 'var(--muted-foreground)' },
] as const

export const STEPS = [
  {
    n: '01',
    title: 'Bring in the work',
    body: 'Upload a BOQ spreadsheet, or import the schedule you already have from Primavera P6 or MS Project.',
    time: 'Seconds',
  },
  {
    n: '02',
    title: 'Get a schedule back',
    body: 'A full CPM network with the critical path, work breakdown, milestones, risks and resources — ready to review and adjust.',
    time: '30 seconds',
  },
  {
    n: '03',
    title: 'Run the project',
    body: 'Progress from the field updates earned value, cost, procurement and the health score at the same moment.',
    time: 'Ongoing',
  },
] as const

export const COMPARISON = {
  columns: ['Spreadsheets', 'Scheduling tools', 'Field platforms'],
  rows: [
    ['CPM scheduling', '—', 'yes', '—', 'yes'],
    ['Earned value (SPI, CPI, EAC)', '—', 'partial', '—', 'yes'],
    ['Cost control by category', '—', '—', 'partial', 'yes'],
    ['Quality, safety and NCRs', '—', '—', 'partial', 'yes'],
    ['P6 file import (.xer / .xml)', '—', 'yes', '—', 'yes'],
    ['AI schedule generation', '—', '—', '—', 'yes'],
    ['40+ integrated modules', '—', '—', 'partial', 'yes'],
    ['Claims and EOT builder', '—', '—', '—', 'yes'],
  ],
} as const

export const AUDIENCES = [
  {
    title: 'Individual PMs',
    quote:
      'I run a large project out of spreadsheets, because the scheduling licence costs more than the job can carry and takes months to learn.',
    solution:
      'Start free with full AI schedule generation. Pro opens every module, P6 import and one-click reporting. If you can use a spreadsheet you can use OctaPM.',
    stat: 'Hours → one click',
    statLabel: 'Weekly reporting',
  },
  {
    title: 'Contractors',
    quote:
      'We have eight live projects and no single view of which are in trouble. Every PM keeps their own version of the truth.',
    solution:
      'One workspace for every project, with role-based access for the PM, planner, QS, cost controller, procurement, warehouse, site engineer and finance. The portfolio view ranks projects by health.',
    stat: 'Five tools → one',
    statLabel: 'Platform consolidation',
  },
  {
    title: 'PM consultancies',
    quote:
      'A project health audit takes days of pulling data out of the client’s schedule, spreadsheets and filing cabinet.',
    solution:
      'Import the client’s P6 file and OctaPM scores all seven dimensions against the records behind them. Export a branded report the same day.',
    stat: 'Days → hours',
    statLabel: 'Audit delivery',
  },
] as const

export const PLANS = [
  {
    name: 'Free',
    monthly: 0,
    annual: 0,
    period: 'forever',
    tagline: 'Prove it on one project.',
    features: [
      'One project',
      'AI schedule generation',
      'Dashboard and core KPIs',
      'Excel export',
      'Community support',
    ],
    cta: 'Start free',
    featured: false,
  },
  {
    name: 'Pro',
    monthly: 29,
    annual: 24,
    period: '/mo',
    tagline: 'Every module, no limits.',
    features: [
      'Unlimited projects',
      'P6 and MS Project import',
      'All 40+ modules',
      'Seven-dimension health scoring',
      'Excel, PDF and CSV exports',
      'Email support',
    ],
    cta: 'Start with Pro',
    featured: true,
  },
  {
    name: 'Team',
    monthly: 199,
    annual: 165,
    period: '/mo',
    tagline: 'For multi-project contractors.',
    features: [
      'Everything in Pro',
      'Ten users included',
      'Eight role-based access levels',
      'Portfolio dashboard',
      'Budget revision tracking',
      'Priority support and onboarding',
    ],
    cta: 'Talk to us',
    featured: false,
  },
] as const

export const FAQ = [
  {
    q: 'Does OctaPM replace Primavera P6, or work alongside it?',
    a: 'Either. Import an existing .xer or .xml file and carry on inside OctaPM with the modules P6 does not have, or generate a new CPM schedule from a BOQ. Your P6 files are read, never written to.',
  },
  {
    q: 'How is an AI-generated schedule different from a planner’s?',
    a: 'It follows the same CPM logic — forward pass, backward pass, float, critical path. The engine proposes the work breakdown and sequencing from your BOQ and normal construction practice. You review and adjust it, exactly as you would a first draft from a junior planner.',
  },
  {
    q: 'Is my project data secure?',
    a: 'Data is encrypted in transit and at rest, every query is scoped to your organisation on the server, and permissions are enforced by the API rather than hidden in the interface. Your data is not used to train models.',
  },
  {
    q: 'What if my schedule is already in Primavera or MS Project?',
    a: 'Import it. OctaPM reads .xer (P6), .xml (P6 and MS Project) and Excel. Activities, predecessors, WBS, calendars and progress come across in seconds.',
  },
  {
    q: 'Can my whole team use it?',
    a: 'Yes. Team includes ten users across eight roles — PM, planning engineer, QS, cost controller, procurement, warehouse, site engineer and finance. Each role sees the modules its work needs.',
  },
  {
    q: 'Can I use OctaPM outside construction?',
    a: 'It is built for construction specifically. The BOQ parser, earned value engine, health dimensions and claims builder are all shaped around construction workflows and contract structures.',
  },
  {
    q: 'Is there a long-term contract?',
    a: 'No. Plans are month to month and can be cancelled at any time. The free plan does not expire and needs no card.',
  },
  {
    q: 'What happens to my data if I leave?',
    a: 'Export everything — Excel, PDF, CSV — before you go. Your data stays available for a period after cancellation, and is then removed in line with our retention practice.',
  },
] as const
