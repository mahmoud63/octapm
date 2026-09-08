import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { AxiosError } from 'axios'
import { Link, useNavigate } from '@tanstack/react-router'
import { formatShortDate } from '@/lib/dates'
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
import { ProjectModuleBar } from './project-module-bar'
import { ProjectSetupWizard } from './project-setup-wizard'
import { ProjectStatusBadge } from './project-status-badge'

/**
 * Focus Mode and the readiness panel remember their state per browser, so a
 * planner who works collapsed on the Gantt is not re-expanded on every visit.
 * Wrapped because storage throws in private windows.
 */
function usePersistedFlag(key: string, fallback = false) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : stored === 'true'
    } catch {
      return fallback
    }
  })

  const set = useCallback(
    (next: boolean) => {
      setValue(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // A per-viewer convenience; losing it is not worth surfacing.
      }
    },
    [key]
  )

  return [value, set] as const
}

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
const BimPanel = lazy(() =>
  import('@/features/bim/components/bim-panel').then((m) => ({
    default: m.BimPanel,
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
const ProcurementDashboard = lazy(() =>
  import('@/features/procurement/components/procurement-dashboard').then((m) => ({
    default: m.ProcurementDashboard,
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
const CaptureHome = lazy(() =>
  import('@/features/capture/components/capture-home').then((m) => ({
    default: m.CaptureHome,
  }))
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

// Contract dates are stored as UTC midnight; rendering them in local time
// showed every one a day early. See lib/dates.ts.
const formatDate = (value: string | null) => formatShortDate(value)

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
  const [readinessCollapsed, setReadinessCollapsed] = usePersistedFlag(
    'octa.project.readiness.collapsed'
  )
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
      { key: 'lookahead', label: 'Lookahead' },
      { key: 'critical', label: `Critical Path (${scheduleCriticalCount})` },
      { key: 'ev', label: 'Earned Value' },
      { key: 'forecast', label: 'Forecast' },
      { key: 'milestones', label: `Milestones (${scheduleMilestonesCount})` },
      { key: 'resources', label: 'Resources' },
      { key: 'risks', label: 'Risks' },
      { key: 'longLead', label: 'Long Lead' },
      { key: 'revisions', label: 'Revisions' },
    ]

    if (hasWbs) {
      scheduleChildren.splice(10, 0, { key: 'wbs', label: 'WBS' })
    }

    return [
      { key: 'capture', label: 'Capture' },
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
          { key: 'budget', label: 'Budget' },
          { key: 'direct-costs', label: 'Direct Costs' },
        ],
      },
      {
        key: 'commercial',
        label: 'Commercial',
        children: [
          { key: 'client-billing', label: 'Client Billing' },
          { key: 'change-events', label: 'Change Events' },
          { key: 'change-orders', label: 'Change Orders' },
          { key: 'commitments', label: 'Commitments' },
          { key: 'pay-apps', label: 'Pay Applications' },
          { key: 'bids', label: 'Bids' },
          { key: 'ipc', label: 'IPC' },
          { key: 'sub-valuations', label: 'Sub Valuations (legacy)' },
          { key: 'budget-revisions', label: 'Budget Revisions' },
          { key: 'cash-flow', label: 'Cash Flow' },
          { key: 'eot', label: 'EOT' },
          { key: 'weather', label: 'Weather Delays' },
          { key: 'contract', label: 'Contract' },
        ],
      },
      {
        key: 'procurement',
        label: 'Procurement',
        children: [
          { key: 'packages', label: 'Packages' },
          { key: 'purchase-orders', label: 'Purchase Orders' },
          { key: 'suppliers', label: 'Suppliers' },
        ],
      },
      {
        key: 'quality',
        label: 'Quality',
        children: [
          { key: 'ncr', label: 'NCR' },
          { key: 'itp', label: 'Inspections' },
          { key: 'defects', label: 'Punch list' },
          { key: 'observations', label: 'Observations' },
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
          { key: 'specifications', label: 'Specifications' },
          { key: 'transmittals', label: 'Transmittals' },
          { key: 'correspondence', label: 'Correspondence' },
          { key: 'emails', label: 'Emails' },
          { key: 'search', label: 'Search' },
        ],
      },
      { key: 'meetings', label: 'Meetings' },
      { key: 'boq', label: 'BOQ' },
      { key: 'bim', label: 'BIM' },
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
    procurement: childFor('procurement'),
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
      case 'capture':
        return (
          <CaptureHome
            projectId={projectId}
            onNavigate={(module, child) =>
              goTo(module, child && isModuleWithChildren(module) ? child : null)
            }
          />
        )

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

      case 'bim':
        return <BimPanel projectId={projectId} initialTarget={initialTarget} />

      case 'siteReporting':
        return (
          <SiteReportingDashboard
            projectId={projectId}
            activities={schedule?.activities ?? []}
            initialDate={initialTarget?.date}
            initialTimesheetId={
              initialTarget?.source === 'timesheet'
                ? (initialTarget.recordId ?? null)
                : null
            }
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
        // Commercial waits for a programme because most of it prices work
        // against activities. Quoting does not: a buyer gets long-lead
        // packages priced *before* the programme is baselined, which is the
        // whole reason long-lead items exist. Gating the whole module made
        // Procurement's own "Compare quotes" link land on "generate a
        // schedule first" (OCTA-UX-GATE-092), so the bidding engine — which
        // takes no activities — is let through and the rest still waits.
        return schedule || childState.commercial === 'bids' ? (
          <CommercialDashboard
            projectId={projectId}
            activities={schedule?.activities ?? []}
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

      case 'procurement':
        return (
          <ProcurementDashboard
            projectId={projectId}
            activeTab={childState.procurement}
            onTabChange={(value: string) => setModuleChild('procurement', value)}
            initialOrderId={
              initialTarget?.source === 'procurement_order'
                ? initialTarget.recordId
                : undefined
            }
          />
        )

      case 'quality':
        return schedule ? (
          <QualityDashboard
            projectId={projectId}
            activeTab={childState.quality}
            onTabChange={(value: string) => setModuleChild('quality', value)}
            showTabList={false}
            initialTarget={initialTarget}
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
      {/* The module bar spans the viewport directly under the application
          header, so the two read as one connected navigation system. */}
      {project && !isProjectAccessDenied && (
        <ProjectModuleBar
          items={menuItems}
          activeModule={visibleModule}
          activeChild={
            isModuleWithChildren(visibleModule)
              ? childState[visibleModule]
              : undefined
          }
          onSelectModule={handleModuleSelect}
          onSelectChild={(module: ModuleKey, child: string) =>
            navigate({
              to: '/projects/$projectId/$module/$child',
              params: { projectId, module: slugForModule(module), child },
            })
          }
        />
      )}

      <Main
        data-testid='uat-project-detail'
        className='flex flex-1 flex-col gap-3 sm:gap-4'
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
            {/* Project identity, one line under the module bar. Deliberately
                compact: it informs, it does not compete with navigation. */}
            <div className='flex flex-wrap items-baseline gap-x-3 gap-y-1'>
              <h2 className='font-display text-xl font-bold tracking-tight'>
                {project.name}
              </h2>
              <span className='text-sm text-muted-foreground'>
                {formatDate(project.startDate)} → {formatDate(project.endDate)}
              </span>
              <span className='text-xs text-muted-foreground'>
                {formatMoney(project.currency, project.contractValue)} ·{' '}
                {formatDuration(project.duration, project.durationUnit)}
              </span>
              <ProjectStatusBadge status={project.status} />
            </div>

            {/* Setup Readiness is a project setup checklist, so it belongs on
                Overview. Carrying it into Budget, Gantt or Drawings would take
                working space on every screen to say the same thing. */}
            {visibleModule === 'overview' && (
              <ProjectSetupWizard
                readiness={setupReadiness}
                isLoading={setupReadinessLoading}
                onNavigate={handleSetupNavigate}
                collapsed={readinessCollapsed}
                onCollapsedChange={setReadinessCollapsed}
              />
            )}

            {/* Navigation moved to the module bar above the project header, so
                the workspace gets the full width — which matters most for
                Gantt, Budget, BOQ, Earned Value, Reports, BIM and Drawings. */}
            <section
              data-testid={`uat-project-content-${visibleModule}`}
              className='mt-2 min-w-0'
            >
              <Suspense fallback={<ModuleLoading />}>{renderContent()}</Suspense>
            </section>
          </ProjectPermissionProvider>
        )}
      </Main>
    </>
  )
}
