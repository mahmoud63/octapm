import { useEffect, useMemo, useState } from 'react'
import { Main } from '@/components/layout/main'
import { ActivitiesList } from '@/features/activities/components/activities-list'
import { CommercialDashboard } from '@/features/commercial/components/commercial-dashboard'
import { CostDashboard } from '@/features/cost/components/cost-dashboard'
import { DocControlDashboard } from '@/features/doc-control/components/doc-control-dashboard'
import { EquipmentSection } from '@/features/equipment/components/equipment-section'
import { useProject } from '@/features/projects/hooks/use-projects'
import { QualityDashboard } from '@/features/quality/components/quality-dashboard'
import { EvReport } from '@/features/reports/components/ev-report'
import { WeeklyProgressReport } from '@/features/reports/components/weekly-progress-report'
import { ScheduleDashboard } from '@/features/schedule/components/schedule-dashboard'
import { ScheduleUploadZone } from '@/features/schedule/components/schedule-upload-zone'
import { useProjectSchedule } from '@/features/schedule/hooks/use-schedule'
import { HealthDashboard } from './health-dashboard'
import { ProjectStatusBadge } from './project-status-badge'

type ModuleKey =
  | 'schedule'
  | 'cost'
  | 'commercial'
  | 'quality'
  | 'docControl'
  | 'activities'
  | 'equipment'
  | 'reports'
  | 'overview'

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

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: project, isLoading } = useProject(projectId)
  const { data: schedule, isLoading: scheduleLoading } =
    useProjectSchedule(projectId)
  const [activeModule, setActiveModule] = useState<ModuleKey>('schedule')
  const [childState, setChildState] =
    useState<ModuleChildState>(DEFAULT_CHILD_STATE)

  const scheduleActivitiesCount = schedule?.activities?.length ?? 0
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
      {
        key: 'cost',
        label: 'Cost Control',
        children: [
          { key: 'overview', label: 'Overview' },
          { key: 'activity', label: 'By Activity' },
          { key: 'phase', label: 'By Phase' },
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

  useEffect(() => {
    if (!hasWbs && childState.schedule === 'wbs') {
      setChildState((prev) => ({ ...prev, schedule: 'gantt' }))
    }
  }, [hasWbs, childState.schedule])

  const setModuleChild = (module: ModuleWithChildren, child: string) => {
    setChildState((prev) => ({ ...prev, [module]: child }))
  }

  const handleModuleSelect = (item: MenuItem) => {
    setActiveModule(item.key)

    if (!item.children) return

    const module = item.key as ModuleWithChildren
    const existing = childState[module]
    const allowed = new Set(item.children.map((child) => child.key))
    const fallback = item.children[0]?.key || existing

    setModuleChild(module, allowed.has(existing) ? existing : fallback)
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
          />
        ) : (
          <ScheduleUploadZone projectId={projectId} project={project} />
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
          />
        ) : (
          <div className='rounded-md border p-6 text-sm text-muted-foreground'>
            Generate a schedule first to access document control workflows.
          </div>
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
              <EvReport projectId={projectId} />
            </div>
          </div>
        )

      case 'overview':
        return (
          <div className='space-y-4'>
            <HealthDashboard projectId={projectId} />

            <div className='rounded-md border p-4 text-sm'>
              <p className='text-muted-foreground'>
                Type:{' '}
                <span className='text-foreground'>{project.type ?? '-'}</span>
              </p>
              <p className='mt-1 text-muted-foreground'>
                Location:{' '}
                <span className='text-foreground'>
                  {project.location ?? '-'}
                </span>
              </p>
              <p className='mt-1 text-muted-foreground'>
                Currency:{' '}
                <span className='text-foreground'>{project.currency}</span>
              </p>
              <p className='mt-1 text-muted-foreground'>
                Contract Value:{' '}
                <span className='text-foreground'>
                  {formatMoney(project.currency, project.contractValue)}
                </span>
              </p>
              <p className='mt-1 text-muted-foreground'>
                Duration:{' '}
                <span className='text-foreground'>
                  {formatDuration(project.duration, project.durationUnit)}
                </span>
              </p>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        {isLoading ? (
          <div className='py-8 text-center text-muted-foreground'>
            Loading project...
          </div>
        ) : !project ? (
          <div className='py-8 text-center text-muted-foreground'>
            Project not found.
          </div>
        ) : (
          <>
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
                  {' · '}Duration:{' '}
                  {formatDuration(project.duration, project.durationUnit)}
                </p>
              </div>
              <ProjectStatusBadge status={project.status} />
            </div>

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

              <section className='min-w-0'>{renderContent()}</section>
            </div>
          </>
        )}
      </Main>
    </>
  )
}
