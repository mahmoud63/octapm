import { lazy, Suspense, useCallback, useMemo } from 'react'
import { AxiosError } from 'axios'
import { Link, useNavigate } from '@tanstack/react-router'
import { ProjectPermissionProvider } from '@/lib/permissions'
import { useProjectRealtime } from '@/hooks/use-realtime'
import { Main } from '@/components/layout/main'
import { useMyProjectPermissions } from '@/features/permissions/hooks/use-permissions'
import {
  useProject,
  useProjectParties,
  useProjectSetupReadiness,
} from '@/features/projects/hooks/use-projects'
import { useProjectSchedule } from '@/features/schedule/hooks/use-schedule'
import type { ProjectSetupTarget } from '../data/schema'
import {
  DEFAULT_CHILD,
  DEFAULT_MODULE,
  isModuleVisible,
  isModuleWithChildren,
  moduleFromSlug,
  slugForModule,
  type ModuleKey,
  type ModuleWithChildren,
} from '../lib/project-modules'
import { ProjectSetupWizard } from './project-setup-wizard'
import { ProjectStatusBadge } from './project-status-badge'

// Every module is its own chunk (OCTA-FE-ROUTES-008): the workspace shell
// stays small and a module's code downloads the first time it is opened.

const ScheduleDashboard = lazy(() =>
  import('@/features/schedule/components/schedule-dashboard').then((m) => ({
    default: m.ScheduleDashboard,
  }))
)
const ScheduleUploadZone = lazy(() =>
  import('@/features/schedule/components/schedule-upload-zone').then((m) => ({
    default: m.ScheduleUploadZone,
  }))
)
const BoqPage = lazy(() =>
  import('@/features/boq/components/boq-page').then((m) => ({
    default: m.BoqPage,
  }))
)
const SiteReportingDashboard = lazy(() =>
  import('@/features/site-reporting/components/site-reporting-dashboard').then(
    (m) => ({ default: m.SiteReportingDashboard })
  )
)
const ActivitiesList = lazy(() =>
  import('@/features/activities/components/activities-list').then((m) => ({
    default: m.ActivitiesList,
  }))
)
const CostDashboard = lazy(() =>
  import('@/features/cost/components/cost-dashboard').then((m) => ({
    default: m.CostDashboard,
  }))
)
const CommercialDashboard = lazy(() =>
  import('@/features/commercial/components/commercial-dashboard').then((m) => ({
    default: m.CommercialDashboard,
  }))
)
const QualityDashboard = lazy(() =>
  import('@/features/quality/components/quality-dashboard').then((m) => ({
    default: m.QualityDashboard,
  }))
)
const DocControlDashboard = lazy(() =>
  import('@/features/doc-control/components/doc-control-dashboard').then(
    (m) => ({ default: m.DocControlDashboard })
  )
)
const MeetingsDashboard = lazy(() =>
  import('@/features/meetings/components/meetings-dashboard').then((m) => ({
    default: m.MeetingsDashboard,
  }))
)
const EquipmentSection = lazy(() =>
  import('@/features/equipment/components/equipment-section').then((m) => ({
    default: m.EquipmentSection,
  }))
)
const LocationsPanel = lazy(() =>
  import('@/features/locations/components/locations-panel').then((m) => ({
    default: m.LocationsPanel,
  }))
)
const ProjectTeamPanel = lazy(() =>
  import('@/features/permissions/components/project-team-panel').then((m) => ({
    default: m.ProjectTeamPanel,
  }))
)
const PhotoGallery = lazy(() =>
  import('@/features/attachments/components/photo-gallery').then((m) => ({
    default: m.PhotoGallery,
  }))
)
const WeeklyProgressReport = lazy(() =>
  import('@/features/reports/components/weekly-progress-report').then((m) => ({
    default: m.WeeklyProgressReport,
  }))
)
const EvReport = lazy(() =>
  import('@/features/reports/components/ev-report').then((m) => ({
    default: m.EvReport,
  }))
)
const HealthDashboard = lazy(() =>
  import('./health-dashboard').then((m) => ({ default: m.HealthDashboard }))
)
const ProjectOverview = lazy(() =>
  import('./project-overview').then((m) => ({ default: m.ProjectOverview }))
)

type MenuChild = {
  key: string
  label: string
}

type MenuItem = {
  key: ModuleKey
  label: string
  children?: MenuChild[]
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

function ModuleLoading() {
  return (
    <div className='py-8 text-center text-sm text-muted-foreground'>
      Loading module…
    </div>
  )
}

export function ProjectDetail({
  projectId,
  module: moduleSlug,
  child: childSlug,
  initialTarget,
}: {
  projectId: string
  /** URL slug or legacy key of the open module; defaults to the schedule. */
  module?: string
  /** Sub-tab slug for modules that have one (gantt, ncr, rfi, …). */
  child?: string
  /** Deep-link extras (record id, status filter) carried in the search string. */
  initialTarget?: ProjectSetupTarget
}) {
  const navigate = useNavigate()
  const {
    data: project,
    isLoading,
    error: projectError,
  } = useProject(projectId)
  const canLoadProjectModules = Boolean(project)
  useProjectRealtime(canLoadProjectModules ? projectId : null)
  const isProjectAccessDenied =
    projectError instanceof AxiosError && projectError.response?.status === 403
  const { data: setupReadiness, isLoading: setupReadinessLoading } =
    useProjectSetupReadiness(projectId, { enabled: canLoadProjectModules })
  const { data: projectParties } = useProjectParties(projectId)
  const { data: schedule, isLoading: scheduleLoading } = useProjectSchedule(
    projectId,
    { enabled: canLoadProjectModules }
  )
  const { data: permissionMatrix } = useMyProjectPermissions(projectId, {
    enabled: canLoadProjectModules,
  })
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
          { key: 'search', label: 'Search' },
        ],
      },
      { key: 'meetings', label: 'Meetings' },
      { key: 'boq', label: 'BOQ' },
      { key: 'activities', label: 'Activities' },
      { key: 'equipment', label: 'Equipment' },
      { key: 'locations', label: 'Locations' },
      { key: 'photos', label: 'Photos' },
      { key: 'team', label: 'Team' },
      { key: 'reports', label: 'Reports' },
      { key: 'overview', label: 'Overview' },
    ].filter((item) =>
      isModuleVisible(permissionMatrix, item.key as ModuleKey)
    ) as MenuItem[]
  }, [
    hasWbs,
    permissionMatrix,
    scheduleActivitiesCount,
    scheduleCriticalCount,
    scheduleMilestonesCount,
  ])

  // The URL is the state: module and sub-tab come from the route params.
  const requestedModule = moduleFromSlug(moduleSlug) ?? DEFAULT_MODULE
  // If a template hides the module currently open, show the first visible one.
  const visibleModule: ModuleKey =
    menuItems.some((item) => item.key === requestedModule) || !menuItems.length
      ? requestedModule
      : menuItems[0].key

  const childFor = useCallback(
    (module: ModuleWithChildren) => {
      const item = menuItems.find((entry) => entry.key === module)
      const allowed = new Set(item?.children?.map((entry) => entry.key) ?? [])
      const requested =
        module === visibleModule && childSlug && allowed.has(childSlug)
          ? childSlug
          : null
      return requested ?? DEFAULT_CHILD[module]
    },
    [childSlug, menuItems, visibleModule]
  )

  const childState: Record<ModuleWithChildren, string> = {
    schedule: childFor('schedule'),
    cost: childFor('cost'),
    commercial: childFor('commercial'),
    quality: childFor('quality'),
    docControl: childFor('docControl'),
  }

  const goTo = useCallback(
    (module: ModuleKey, child?: string | null) => {
      if (child) {
        navigate({
          to: '/projects/$projectId/$module/$child',
          params: { projectId, module: slugForModule(module), child },
        })
      } else {
        navigate({
          to: '/projects/$projectId/$module',
          params: { projectId, module: slugForModule(module) },
        })
      }
    },
    [navigate, projectId]
  )

  const setModuleChild = useCallback(
    (module: ModuleWithChildren, child: string) => goTo(module, child),
    [goTo]
  )

  const handleModuleSelect = (item: MenuItem) => {
    if (!item.children || !isModuleWithChildren(item.key)) {
      goTo(item.key)
      return
    }
    goTo(item.key, childState[item.key])
  }

  const handleSetupNavigate = (target: ProjectSetupTarget) => {
    const module = moduleFromSlug(target.module)
    if (!module || !menuItems.some((item) => item.key === module)) return
    goTo(
      module,
      target.child && isModuleWithChildren(module) ? target.child : null
    )
  }

  const renderContent = () => {
    if (!project) return null

    switch (visibleModule) {
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
            onTabChange={(value: string) => setModuleChild('schedule', value)}
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
            onTabChange={(value: string) => setModuleChild('cost', value)}
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
            onTabChange={(value: string) => setModuleChild('commercial', value)}
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
            onTabChange={(value: string) => setModuleChild('quality', value)}
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
            onTabChange={(value: string) => setModuleChild('docControl', value)}
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
          <MeetingsDashboard
            projectId={projectId}
            initialTarget={initialTarget}
          />
        )

      case 'equipment':
        return <EquipmentSection projectId={projectId} />

      case 'locations':
        return <LocationsPanel projectId={projectId} />

      case 'team':
        return <ProjectTeamPanel projectId={projectId} />

      case 'photos':
        return <PhotoGallery projectId={projectId} />

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
            <ProjectOverview project={project} parties={activeProjectParties} />
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
            matrix={permissionMatrix}
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
                    const isActiveModule = visibleModule === item.key
                    const hasChildren = Boolean(item.children?.length)

                    return (
                      <div key={item.key}>
                        <Link
                          data-testid={`uat-project-module-${item.key}`}
                          to={
                            hasChildren && isModuleWithChildren(item.key)
                              ? '/projects/$projectId/$module/$child'
                              : '/projects/$projectId/$module'
                          }
                          params={{
                            projectId,
                            module: slugForModule(item.key),
                            ...(hasChildren && isModuleWithChildren(item.key)
                              ? { child: childState[item.key] }
                              : {}),
                          }}
                          onClick={(event) => {
                            event.preventDefault()
                            handleModuleSelect(item)
                          }}
                          className={[
                            'block w-full rounded-md px-2 py-2 text-left text-sm font-medium transition-colors',
                            isActiveModule
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted/50',
                          ].join(' ')}
                        >
                          {item.label}
                        </Link>

                        {hasChildren && isModuleWithChildren(item.key) && (
                          <div className='ms-2 mt-1 space-y-1 border-s ps-2'>
                            {item.children?.map((child) => {
                              const module = item.key as ModuleWithChildren
                              const isChildActive =
                                isActiveModule &&
                                childState[module] === child.key

                              return (
                                <Link
                                  data-testid={`uat-project-module-${item.key}-${child.key}`}
                                  key={child.key}
                                  to='/projects/$projectId/$module/$child'
                                  params={{
                                    projectId,
                                    module: slugForModule(module),
                                    child: child.key,
                                  }}
                                  className={[
                                    'block w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                    isChildActive
                                      ? 'bg-muted text-foreground'
                                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                  ].join(' ')}
                                >
                                  {child.label}
                                </Link>
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
                data-testid={`uat-project-content-${visibleModule}`}
                className='min-w-0'
              >
                <Suspense fallback={<ModuleLoading />}>
                  {renderContent()}
                </Suspense>
              </section>
            </div>
          </ProjectPermissionProvider>
        )}
      </Main>
    </>
  )
}
