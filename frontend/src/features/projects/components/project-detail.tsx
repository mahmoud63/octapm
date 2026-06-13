import { useCallback, useEffect, useMemo, useState } from 'react'
import { AxiosError } from 'axios'
import { Link } from '@tanstack/react-router'
import { ProjectPermissionProvider } from '@/lib/permissions'
import { Main } from '@/components/layout/main'
import { ActivitiesList } from '@/features/activities/components/activities-list'
import { BoqPage } from '@/features/boq/components/boq-page'
import { CommercialDashboard } from '@/features/commercial/components/commercial-dashboard'
import { CostDashboard } from '@/features/cost/components/cost-dashboard'
import { DocControlDashboard } from '@/features/doc-control/components/doc-control-dashboard'
import { EquipmentSection } from '@/features/equipment/components/equipment-section'
import { MeetingsDashboard } from '@/features/meetings/components/meetings-dashboard'
import {
  useProject,
  useProjectParties,
  useProjectSetupReadiness,
} from '@/features/projects/hooks/use-projects'
import { QualityDashboard } from '@/features/quality/components/quality-dashboard'
import { EvReport } from '@/features/reports/components/ev-report'
import { WeeklyProgressReport } from '@/features/reports/components/weekly-progress-report'
import { ScheduleDashboard } from '@/features/schedule/components/schedule-dashboard'
import { ScheduleUploadZone } from '@/features/schedule/components/schedule-upload-zone'
import { useProjectSchedule } from '@/features/schedule/hooks/use-schedule'
import { SiteReportingDashboard } from '@/features/site-reporting/components/site-reporting-dashboard'
import type { ProjectSetupTarget } from '../data/schema'
import { HealthDashboard } from './health-dashboard'
import { ProjectSetupWizard } from './project-setup-wizard'
import { ProjectStatusBadge } from './project-status-badge'

type ModuleKey =
  | 'schedule'
  | 'siteReporting'
  | 'cost'
  | 'commercial'
  | 'quality'
  | 'docControl'
  | 'meetings'
  | 'activities'
  | 'equipment'
  | 'reports'
  | 'overview'
  | 'boq'

type ModuleChildState = {
  schedule: string
  cost: string
  commercial: string
  quality: string
  docControl: string
}

type ModuleWithChildren = keyof ModuleChildState

type MenuChild = {
  key: string
  label: string
}

type MenuItem = {
  key: ModuleKey
  label: string
  children?: MenuChild[]
}

const DEFAULT_CHILD_STATE: ModuleChildState = {
  schedule: 'gantt',
  cost: 'overview',
  commercial: 'change-orders',
  quality: 'ncr',
  docControl: 'rfi',
}

function isModuleWithChildren(module: ModuleKey): module is ModuleWithChildren {
  return ['schedule', 'cost', 'commercial', 'quality', 'docControl'].includes(
    module
  )
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString()
}

function formatMoney(currency: string, value: number | null | undefined) {
  if (value == null) return '—'
  return `${currency} ${Number(value).toLocaleString()}`
}

function formatDuration(
  duration: number | null | undefined,
  durationUnit: string | null | undefined
) {
  if (!duration) return '—'
  return `${duration} ${durationUnit || 'months'}`
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return '-'
  return `${Number(value).toLocaleString()}%`
}

function formatNumber(value: number | null | undefined, suffix = '') {
  if (value == null) return '-'
  return `${Number(value).toLocaleString()}${suffix}`
}

const contractTypeLabels: Record<string, string> = {
  lump_sum: 'Lump Sum',
  unit_rate: 'Unit Rate',
  remeasurement: 'Remeasurement',
  cost_plus: 'Cost Plus',
  design_build: 'Design-Build',
  epc: 'EPC',
  other: 'Other',
}

const projectCalendarLabels: Record<string, string> = {
  five_day: '5-Day',
  six_day: '6-Day',
  seven_day: '7-Day',
  custom: 'Custom',
}

function formatLabel(
  labels: Record<string, string>,
  value: string | null | undefined
) {
  if (!value) return '-'
  return labels[value] ?? value
}

function DetailItem({
  label,
  value,
}: {
  label: string
  value: string | number | null | undefined
}) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 text-sm font-medium text-foreground'>{value ?? '-'}</p>
    </div>
  )
}

function PartyDetailItem({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 text-sm font-medium text-foreground'>{value || '-'}</p>
    </div>
  )
}

export function ProjectDetail({
  projectId,
  initialTarget,
}: {
  projectId: string
  initialTarget?: ProjectSetupTarget
}) {
  const {
    data: project,
    isLoading,
    error: projectError,
  } = useProject(projectId)
  const canLoadProjectModules = Boolean(project)
  const isProjectAccessDenied =
    projectError instanceof AxiosError && projectError.response?.status === 403
  const { data: setupReadiness, isLoading: setupReadinessLoading } =
    useProjectSetupReadiness(projectId, { enabled: canLoadProjectModules })
  const { data: projectParties } = useProjectParties(projectId)
  const { data: schedule, isLoading: scheduleLoading } = useProjectSchedule(
    projectId,
    { enabled: canLoadProjectModules }
  )
  const [activeModule, setActiveModule] = useState<ModuleKey>('schedule')
  const [childState, setChildState] =
    useState<ModuleChildState>(DEFAULT_CHILD_STATE)
  const projectEffectiveRole =
    project?.projectAccess?.effectiveRole ??
    project?.effectiveRole ??
    project?.projectAccess?.role ??
    null

  const scheduleActivitiesCount = schedule?.activities?.length ?? 0
  const activeProjectParties = projectParties?.items ?? []
  const scheduleCriticalCount =
    schedule?.activities?.filter((a) => a.isCritical && !a.isMilestone)
      .length ?? 0
  const scheduleMilestonesCount =
    schedule?.activities?.filter((a) => a.isMilestone).length ?? 0
  const hasWbs = (schedule?.revision?.wbs || []).length > 0

  const menuItems = useMemo<MenuItem[]>(() => {
    const scheduleChildren: MenuChild[] = [
      { key: 'gantt', label: 'Gantt' },
      { key: 'activities', label: `Activities (${scheduleActivitiesCount})` },
      { key: 'progress', label: 'Progress' },
      { key: 'critical', label: `Critical Path (${scheduleCriticalCount})` },
      { key: 'ev', label: 'Earned Value' },
      { key: 'milestones', label: `Milestones (${scheduleMilestonesCount})` },
      { key: 'resources', label: 'Resources' },
      { key: 'risks', label: 'Risks' },
      { key: 'longLead', label: 'Long Lead' },
      { key: 'revisions', label: 'Revisions' },
    ]

    if (hasWbs) {
      scheduleChildren.splice(9, 0, { key: 'wbs', label: 'WBS' })
    }

    return [
      { key: 'schedule', label: 'Schedule', children: scheduleChildren },
      { key: 'siteReporting', label: 'Site Reporting' },
      {
        key: 'cost',
        label: 'Cost Control',
        children: [
          { key: 'overview', label: 'Overview' },
          { key: 'activity', label: 'By Activity' },
          { key: 'phase', label: 'By Phase' },
          { key: 'equipment', label: 'Equipment' },
          { key: 'burn', label: 'Burn Rate' },
        ],
      },
      {
        key: 'commercial',
        label: 'Commercial',
        children: [
          { key: 'change-orders', label: 'Change Orders' },
          { key: 'ipc', label: 'IPC' },
          { key: 'sub-valuations', label: 'Sub Valuations' },
          { key: 'budget-revisions', label: 'Budget Revisions' },
          { key: 'cash-flow', label: 'Cash Flow' },
          { key: 'eot', label: 'EOT' },
          { key: 'weather', label: 'Weather Delays' },
        ],
      },
      {
        key: 'quality',
        label: 'Quality',
        children: [
          { key: 'ncr', label: 'NCR' },
          { key: 'itp', label: 'ITP' },
          { key: 'defects', label: 'Defects' },
          { key: 'safety', label: 'Safety' },
          { key: 'tests', label: 'Material Tests' },
        ],
      },
      {
        key: 'docControl',
        label: 'Doc Control',
        children: [
          { key: 'rfi', label: 'RFI' },
          { key: 'submittals', label: 'Submittals' },
          { key: 'drawings', label: 'Drawings' },
          { key: 'transmittals', label: 'Transmittals' },
          { key: 'correspondence', label: 'Correspondence' },
        ],
      },
      { key: 'meetings', label: 'Meetings' },
      { key: 'boq', label: 'BOQ' },
      { key: 'activities', label: 'Activities' },
      { key: 'equipment', label: 'Equipment' },
      { key: 'reports', label: 'Reports' },
      { key: 'overview', label: 'Overview' },
    ]
  }, [
    hasWbs,
    scheduleActivitiesCount,
    scheduleCriticalCount,
    scheduleMilestonesCount,
  ])

  const setModuleChild = useCallback(
    (module: ModuleWithChildren, child: string) => {
      setChildState((prev) => ({ ...prev, [module]: child }))
    },
    []
  )

  useEffect(() => {
    if (!hasWbs && childState.schedule === 'wbs') {
      setChildState((prev) => ({ ...prev, schedule: 'gantt' }))
    }
  }, [hasWbs, childState.schedule])

  useEffect(() => {
    if (!initialTarget?.module) return

    const module = initialTarget.module as ModuleKey
    const item = menuItems.find((menuItem) => menuItem.key === module)
    if (!item) return

    setActiveModule(module)

    if (!initialTarget.child || !isModuleWithChildren(module)) return

    const allowedChildren = new Set(item.children?.map((child) => child.key))
    if (allowedChildren.has(initialTarget.child)) {
      setModuleChild(module, initialTarget.child)
    }
  }, [initialTarget?.module, initialTarget?.child, menuItems, setModuleChild])

  const handleModuleSelect = (item: MenuItem) => {
    setActiveModule(item.key)

    if (!item.children) return

    const module = item.key as ModuleWithChildren
    const existing = childState[module]
    const allowed = new Set(item.children.map((child) => child.key))
    const fallback = item.children[0]?.key || existing

    setModuleChild(module, allowed.has(existing) ? existing : fallback)
  }

  const handleSetupNavigate = (target: ProjectSetupTarget) => {
    const module = target.module as ModuleKey
    const exists = menuItems.some((item) => item.key === module)
    if (!exists) return

    setActiveModule(module)
    if (target.child && isModuleWithChildren(module)) {
      setModuleChild(module, target.child)
    }
  }

  const renderContent = () => {
    if (!project) return null

    switch (activeModule) {
      case 'schedule':
        return scheduleLoading ? (
          <div className='py-8 text-center text-muted-foreground'>
            Loading schedule...
          </div>
        ) : schedule ? (
          <ScheduleDashboard
            projectId={projectId}
            schedule={schedule}
            activeTab={childState.schedule}
            onTabChange={(value) => setModuleChild('schedule', value)}
            showTabList={false}
            initialTarget={initialTarget}
          />
        ) : (
          <ScheduleUploadZone projectId={projectId} project={project} />
        )

      case 'boq':
        return <BoqPage projectId={projectId} embedded />

      case 'siteReporting':
        return (
          <SiteReportingDashboard
            projectId={projectId}
            activities={schedule?.activities ?? []}
          />
        )

      case 'activities':
        return (
          <ActivitiesList
            projectId={projectId}
            projectStartDate={project.startDate}
            projectEndDate={project.endDate}
          />
        )

      case 'cost':
        return schedule ? (
          <CostDashboard
            projectId={projectId}
            activeTab={childState.cost}
            onTabChange={(value) => setModuleChild('cost', value)}
            showTabList={false}
            initialTarget={initialTarget}
          />
        ) : (
          <div className='rounded-md border p-6 text-sm text-muted-foreground'>
            Generate a schedule first to initialize cost control data.
          </div>
        )

      case 'commercial':
        return schedule ? (
          <CommercialDashboard
            projectId={projectId}
            activities={schedule.activities}
            activeTab={childState.commercial}
            onTabChange={(value) => setModuleChild('commercial', value)}
            showTabList={false}
            initialTarget={initialTarget}
          />
        ) : (
          <div className='rounded-md border p-6 text-sm text-muted-foreground'>
            Generate a schedule first to access commercial modules.
          </div>
        )

      case 'quality':
        return schedule ? (
          <QualityDashboard
            projectId={projectId}
            activeTab={childState.quality}
            onTabChange={(value) => setModuleChild('quality', value)}
            showTabList={false}
          />
        ) : (
          <div className='rounded-md border p-6 text-sm text-muted-foreground'>
            Generate a schedule first to access quality workflows.
          </div>
        )

      case 'docControl':
        return schedule ? (
          <DocControlDashboard
            projectId={projectId}
            activeTab={childState.docControl}
            onTabChange={(value) => setModuleChild('docControl', value)}
            showTabList={false}
            initialTarget={initialTarget}
          />
        ) : (
          <div className='rounded-md border p-6 text-sm text-muted-foreground'>
            Generate a schedule first to access document control workflows.
          </div>
        )

      case 'meetings':
        return (
          <MeetingsDashboard projectId={projectId} initialTarget={initialTarget} />
        )

      case 'equipment':
        return <EquipmentSection projectId={projectId} />

      case 'reports':
        return (
          <div className='space-y-6'>
            <div className='rounded-md border p-4'>
              <h3 className='mb-3 text-base font-semibold'>Weekly Progress</h3>
              <WeeklyProgressReport projectId={projectId} />
            </div>

            <div className='rounded-md border p-4'>
              <h3 className='mb-3 text-base font-semibold'>Earned Value</h3>
              <EvReport
                projectId={projectId}
                readiness={setupReadiness}
                onNavigate={handleSetupNavigate}
              />
            </div>
          </div>
        )

      case 'overview':
        return (
          <div className='space-y-4'>
            <HealthDashboard projectId={projectId} />

            <div className='space-y-4'>
              <section className='rounded-md border p-4'>
                <h3 className='mb-3 text-sm font-semibold'>Project Basics</h3>
                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
                  <DetailItem label='Type' value={project.type ?? '-'} />
                  <DetailItem
                    label='Location'
                    value={project.location ?? '-'}
                  />
                  <DetailItem
                    label='Duration'
                    value={formatDuration(
                      project.duration,
                      project.durationUnit
                    )}
                  />
                  <DetailItem
                    label='Start Date'
                    value={formatDate(project.startDate)}
                  />
                  <DetailItem
                    label='End Date'
                    value={formatDate(project.endDate)}
                  />
                  <DetailItem
                    label='Baseline Date'
                    value={formatDate(project.baselineDate ?? null)}
                  />
                  <DetailItem
                    label='Data Date'
                    value={formatDate(project.dataDate ?? null)}
                  />
                </div>
              </section>

              <section className='rounded-md border p-4'>
                <h3 className='mb-3 text-sm font-semibold'>Contract Parties</h3>
                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                  <PartyDetailItem
                    label='Client / Owner'
                    value={
                      activeProjectParties.find((party) => party.role === 'owner')
                        ?.company?.name ?? project.clientName
                    }
                  />
                  <PartyDetailItem
                    label='Consultant'
                    value={
                      activeProjectParties.find(
                        (party) => party.role === 'consultant'
                      )?.company?.name ?? project.consultantName
                    }
                  />
                  <PartyDetailItem
                    label='Contractor'
                    value={
                      activeProjectParties.find(
                        (party) => party.role === 'contractor'
                      )?.company?.name ?? project.contractorName
                    }
                  />
                  <PartyDetailItem
                    label='Subcontractors'
                    value={
                      activeProjectParties
                        .filter((party) => party.role === 'subcontractor')
                        .map((party) => party.company?.name)
                        .filter(Boolean)
                        .join(', ') || null
                    }
                  />
                </div>
              </section>

              <section className='rounded-md border p-4'>
                <h3 className='mb-3 text-sm font-semibold'>Contract Terms</h3>
                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
                  <DetailItem
                    label='Contract Type'
                    value={formatLabel(
                      contractTypeLabels,
                      project.contractType
                    )}
                  />
                  <DetailItem
                    label='Contract Number'
                    value={project.contractNumber ?? '-'}
                  />
                  <DetailItem
                    label='Contract Value'
                    value={formatMoney(project.currency, project.contractValue)}
                  />
                  <DetailItem
                    label='Contract Completion'
                    value={formatDate(project.completionDate ?? null)}
                  />
                  <DetailItem
                    label='Revised Completion'
                    value={formatDate(project.revisedCompletionDate ?? null)}
                  />
                  <DetailItem
                    label='LD Rate / Day'
                    value={formatMoney(project.currency, project.ldRatePerDay)}
                  />
                </div>
              </section>

              <section className='rounded-md border p-4'>
                <h3 className='mb-3 text-sm font-semibold'>
                  Commercial Defaults
                </h3>
                <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                  <DetailItem label='Currency' value={project.currency} />
                  <DetailItem
                    label='Retention'
                    value={formatPercent(project.defaultRetentionRate)}
                  />
                  <DetailItem
                    label='Weather Allowance'
                    value={formatNumber(project.weatherAllowanceDays, ' days')}
                  />
                  <DetailItem
                    label='Reporting Cutoff'
                    value={formatNumber(project.reportingCutoffDay)}
                  />
                </div>
              </section>

              <section className='rounded-md border p-4'>
                <h3 className='mb-3 text-sm font-semibold'>
                  Reporting Settings
                </h3>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <DetailItem
                    label='Project Calendar'
                    value={formatLabel(
                      projectCalendarLabels,
                      project.projectCalendar
                    )}
                  />
                  <DetailItem
                    label='Cutoff Day'
                    value={formatNumber(project.reportingCutoffDay)}
                  />
                  <DetailItem
                    label='Data Date'
                    value={formatDate(project.dataDate ?? null)}
                  />
                </div>
              </section>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <>
      <Main
        data-testid='uat-project-detail'
        className='flex flex-1 flex-col gap-4 sm:gap-6'
      >
        {isLoading ? (
          <div className='py-8 text-center text-muted-foreground'>
            Loading project...
          </div>
        ) : isProjectAccessDenied ? (
          <div className='mx-auto max-w-xl rounded-md border p-6 text-center'>
            <h2 className='text-lg font-semibold'>Project access restricted</h2>
            <p className='mt-2 text-sm text-muted-foreground'>
              This project is only visible to assigned project members.
            </p>
            <Link
              to='/projects'
              className='mt-4 inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50'
            >
              Back to Projects
            </Link>
          </div>
        ) : !project ? (
          <div className='py-8 text-center text-muted-foreground'>
            Project not found.
          </div>
        ) : (
          <ProjectPermissionProvider
            role={project.projectAccess?.role}
            effectiveRole={projectEffectiveRole}
            partyAccess={project.projectAccess?.partyAccess}
          >
            <div className='flex flex-wrap items-end justify-between gap-2'>
              <div>
                <h2 className='text-2xl font-bold tracking-tight'>
                  {project.name}
                </h2>
                <p className='text-sm text-muted-foreground'>
                  {formatDate(project.startDate)} {'->'}{' '}
                  {formatDate(project.endDate)}
                </p>
                <p className='text-xs text-muted-foreground'>
                  Contract Value:{' '}
                  {formatMoney(project.currency, project.contractValue)}
                  {' - '}Duration:{' '}
                  {formatDuration(project.duration, project.durationUnit)}
                </p>
              </div>
              <ProjectStatusBadge status={project.status} />
            </div>

            <ProjectSetupWizard
              readiness={setupReadiness}
              isLoading={setupReadinessLoading}
              onNavigate={handleSetupNavigate}
            />

            <div className='mt-2 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]'>
              <aside className='self-start rounded-md border bg-card p-3 lg:sticky lg:top-[calc(3.5rem+1rem)] lg:max-h-[calc(100vh-3.5rem-2rem)] lg:overflow-y-auto'>
                <p className='mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase'>
                  Project Modules
                </p>

                <nav className='space-y-1'>
                  {menuItems.map((item) => {
                    const isActiveModule = activeModule === item.key
                    const hasChildren = Boolean(item.children?.length)

                    return (
                      <div key={item.key}>
                        <button
                          data-testid={`uat-project-module-${item.key}`}
                          type='button'
                          onClick={() => handleModuleSelect(item)}
                          className={[
                            'w-full rounded-md px-2 py-2 text-left text-sm font-medium transition-colors',
                            isActiveModule
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted/50',
                          ].join(' ')}
                        >
                          {item.label}
                        </button>

                        {hasChildren && (
                          <div className='ms-2 mt-1 space-y-1 border-s ps-2'>
                            {item.children?.map((child) => {
                              const module = item.key as ModuleWithChildren
                              const isChildActive =
                                isActiveModule &&
                                childState[module] === child.key

                              return (
                                <button
                                  data-testid={`uat-project-module-${item.key}-${child.key}`}
                                  key={child.key}
                                  type='button'
                                  onClick={() => {
                                    setActiveModule(item.key)
                                    setModuleChild(module, child.key)
                                  }}
                                  className={[
                                    'w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                    isChildActive
                                      ? 'bg-muted text-foreground'
                                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                  ].join(' ')}
                                >
                                  {child.label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </nav>
              </aside>

              <section
                data-testid={`uat-project-content-${activeModule}`}
                className='min-w-0'
              >
                {renderContent()}
              </section>
            </div>
          </ProjectPermissionProvider>
        )}
      </Main>
    </>
  )
}
