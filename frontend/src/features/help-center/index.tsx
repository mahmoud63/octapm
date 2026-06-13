import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Headphones,
  KeyRound,
  LifeBuoy,
  Route,
  ShieldCheck,
  type LucideIcon,
  UsersRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Main } from '@/components/layout/main'

type GuideCard = {
  title: string
  description: string
  source: string
  icon: LucideIcon
  badge: string
}

type RoleCard = {
  role: string
  focus: string
  checkpoints: string[]
}

const guideCards: GuideCard[] = [
  {
    title: 'Admin guide',
    description:
      'Tenant setup, project readiness, role assignment, project parties, files, governance, and admin QA.',
    source: 'docs/help-center/admin-guide.md',
    icon: ShieldCheck,
    badge: 'Admins',
  },
  {
    title: 'User guide by role',
    description:
      'Daily workflow and handoffs for PM, Planning, QS, Cost, Procurement, Warehouse, Site, and Finance users.',
    source: 'docs/help-center/user-guide-by-role.md',
    icon: UsersRound,
    badge: 'Training',
  },
  {
    title: 'Support runbook',
    description:
      'Severity model, triage flow, incident process, escalation owners, and common support issue checks.',
    source: 'docs/help-center/support-runbook.md',
    icon: Headphones,
    badge: 'Support',
  },
  {
    title: 'API documentation',
    description:
      'Swagger locations, OpenAPI validation, auth model, response envelope, uploads, and publishing checklist.',
    source: 'docs/help-center/api-docs.md',
    icon: Route,
    badge: 'API',
  },
  {
    title: 'Release notes and limitations',
    description:
      'Current documentation release notes, pilot restrictions, out-of-scope items, and customer messaging.',
    source: 'docs/help-center/release-notes-known-limitations.md',
    icon: AlertTriangle,
    badge: 'Launch',
  },
  {
    title: 'Onboarding checklist',
    description:
      'Internal readiness, customer discovery, tenant setup, data load, role training, UAT, and first-week checks.',
    source: 'docs/help-center/onboarding-checklist.md',
    icon: ClipboardCheck,
    badge: 'Rollout',
  },
]

const roleCards: RoleCard[] = [
  {
    role: 'PM',
    focus:
      'Governance, approvals, baselines, access, readiness, and source-of-truth decisions.',
    checkpoints: [
      'Approve workflows',
      'Review dashboard health',
      'Confirm audit history',
    ],
  },
  {
    role: 'Planning Engineer',
    focus:
      'Schedule import/generation, CPM, revisions, data date, and progress coordination.',
    checkpoints: [
      'Submit revisions',
      'Review critical path',
      'Watch procurement risk',
    ],
  },
  {
    role: 'QS',
    focus:
      'BOQ validation, allocations, measurement evidence, and IPC drafting.',
    checkpoints: ['Allocate BOQ', 'Review progress', 'Submit IPC'],
  },
  {
    role: 'Finance',
    focus:
      'IPC certification, invoices, payments, retention, and official cost period locks.',
    checkpoints: ['Certify IPC', 'Record payments', 'Release retention'],
  },
]

const launchChecks = [
  'OpenAPI published at /api/v1/docs and /api/v1/openapi.json',
  'Known limitations published for pilot and source-of-truth rollout',
  'Documentation readiness QA checklist available',
  'Support runbook awaiting named owner signoff',
]

const supportPrompts = [
  'Missing project access',
  'Workflow button missing',
  'BOQ or schedule import failure',
  'Progress, EV, IPC, or dashboard mismatch',
  'Document preview or download blocked',
]

function SourcePath({ children }: { children: string }) {
  return (
    <code className='rounded bg-muted px-1.5 py-0.5 text-[0.75rem] break-all text-muted-foreground'>
      {children}
    </code>
  )
}

export function HelpCenter() {
  return (
    <Main className='flex flex-1 flex-col gap-6 sm:gap-7'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='max-w-3xl space-y-2'>
          <Badge variant='outline' className='gap-1.5'>
            <BookOpen className='size-3.5' />
            Launch documentation
          </Badge>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Help Center</h2>
            <p className='max-w-2xl text-sm text-muted-foreground'>
              Role guides, admin setup, support triage, onboarding, known
              limitations, and published API docs for PMcopilots rollout.
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button asChild>
            <a href='/api/v1/docs' target='_blank' rel='noreferrer'>
              <ExternalLink className='size-4' />
              Swagger UI
            </a>
          </Button>
          <Button variant='outline' asChild>
            <a href='/api/v1/openapi.json' target='_blank' rel='noreferrer'>
              <FileText className='size-4' />
              OpenAPI JSON
            </a>
          </Button>
        </div>
      </div>

      <section className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
        {launchChecks.map((item) => (
          <div
            key={item}
            className='flex min-h-20 items-start gap-3 rounded-md border bg-card/60 p-4'
          >
            <CheckCircle2 className='mt-0.5 size-4 text-emerald-600 dark:text-emerald-400' />
            <p className='text-sm leading-6'>{item}</p>
          </div>
        ))}
      </section>

      <section className='grid gap-4 lg:grid-cols-3'>
        {guideCards.map((guide) => {
          const Icon = guide.icon

          return (
            <Card key={guide.title} className='rounded-md'>
              <CardHeader>
                <div className='flex items-start justify-between gap-3'>
                  <div className='flex items-center gap-3'>
                    <span className='rounded-md border bg-muted p-2'>
                      <Icon className='size-4' />
                    </span>
                    <div>
                      <CardTitle>{guide.title}</CardTitle>
                      <Badge variant='secondary' className='mt-2'>
                        {guide.badge}
                      </Badge>
                    </div>
                  </div>
                </div>
                <CardDescription>{guide.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <SourcePath>{guide.source}</SourcePath>
              </CardContent>
            </Card>
          )
        })}
      </section>

      <section className='grid gap-4 xl:grid-cols-[1.2fr_0.8fr]'>
        <div className='space-y-3'>
          <div>
            <h3 className='text-lg font-semibold'>Role Quick Start</h3>
            <p className='text-sm text-muted-foreground'>
              Full role training is maintained in the role user guide.
            </p>
          </div>
          <div className='grid gap-3 md:grid-cols-2'>
            {roleCards.map((role) => (
              <Card key={role.role} className='rounded-md'>
                <CardHeader>
                  <CardTitle>{role.role}</CardTitle>
                  <CardDescription>{role.focus}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className='space-y-2 text-sm'>
                    {role.checkpoints.map((checkpoint) => (
                      <li key={checkpoint} className='flex items-center gap-2'>
                        <CheckCircle2 className='size-3.5 text-emerald-600 dark:text-emerald-400' />
                        <span>{checkpoint}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className='space-y-4'>
          <Card className='rounded-md'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <LifeBuoy className='size-4' />
                Support Triage
              </CardTitle>
              <CardDescription>
                Capture environment, user role, project ID, record ID,
                timestamp, screenshot, and response error code before
                escalation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='flex flex-wrap gap-2'>
                {supportPrompts.map((prompt) => (
                  <Badge key={prompt} variant='outline'>
                    {prompt}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className='rounded-md'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <KeyRound className='size-4' />
                Go-Live Gate
              </CardTitle>
              <CardDescription>
                Production deployment does not lift pilot restrictions until
                owner evidence, documentation QA, and signoff are recorded.
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3 text-sm'>
              <div className='flex items-start gap-2'>
                <CheckCircle2 className='mt-0.5 size-4 text-emerald-600 dark:text-emerald-400' />
                <span>Documentation QA source:</span>
              </div>
              <SourcePath>docs/qa/documentation-readiness.md</SourcePath>
              <Separator />
              <div className='flex items-start gap-2'>
                <CheckCircle2 className='mt-0.5 size-4 text-emerald-600 dark:text-emerald-400' />
                <span>Release gate source:</span>
              </div>
              <SourcePath>docs/qa/go-live-readiness-gate.md</SourcePath>
            </CardContent>
          </Card>
        </div>
      </section>
    </Main>
  )
}
