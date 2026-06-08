# BOQ Frontend — Route, Page, and Hooks

## Route File

**File:** `src/routes/_authenticated/projects/$projectId/boq.tsx`

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { BoqPage } from '@/features/boq/components/boq-page'

export const Route = createFileRoute('/_authenticated/projects/$projectId/boq')({
  component: BoqPageRoute,
})

function BoqPageRoute() {
  const { projectId } = Route.useParams()
  return <BoqPage projectId={projectId} />
}
```

---

## Page Component

**File:** `src/features/boq/components/boq-page.tsx`

```typescript
import { Main } from '@/components/layout/main'
import { useProject } from '@/features/projects/hooks/use-projects'
import { useProjectBoq } from '../hooks/use-boq'
import { BoqUploadZone } from './boq-upload-zone'
import { BoqEditableGrid } from './boq-editable-grid'
import { BoqFinancialSummary } from './boq-financial-summary'

export function BoqPage({ projectId }: { projectId: string }) {
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: boq, isLoading: boqLoading, refetch } = useProjectBoq(projectId)

  if (projectLoading || boqLoading) {
    return (
      <Main>
        <div className='flex items-center justify-center py-16 text-muted-foreground'>
          Loading...
        </div>
      </Main>
    )
  }

  return (
    <Main className='flex flex-1 flex-col gap-6'>
      {/* Page header */}
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>BOQ Management</h2>
        <p className='text-sm text-muted-foreground'>
          Bill of Quantities — upload, validate, and manage activities
        </p>
      </div>

      {!boq?.hasUploadedBoq ? (
        // No BOQ yet — show upload zone
        <BoqUploadZone
          projectId={projectId}
          project={{
            name: project?.name,
            startDate: project?.startDate,
            duration: project?.duration,
          }}
          onUploadSuccess={() => refetch()}
        />
      ) : (
        // BOQ exists — show grid + financial summary
        <>
          <BoqEditableGrid
            projectId={projectId}
            items={boq.items}
            financial={boq.financial}
            currency={project?.currency ?? 'USD'}
            onDataChange={() => refetch()}
          />
          <BoqFinancialSummary
            financial={boq.financial}
            currency={project?.currency ?? 'USD'}
          />
        </>
      )}
    </Main>
  )
}
```

---

## Hooks File

**File:** `src/features/boq/hooks/use-boq.ts`

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { AxiosError } from 'axios'
import { apiClient } from '@/services/api/client'
import type {
  ProjectBoq,
  CreateBoqItemInput,
  CreateBoqActivityInput,
  UpdateBoqActivityInput,
} from '../data/schema'

// ── GET full BOQ ─────────────────────────────────────────────────────────────
export const useProjectBoq = (projectId: string) =>
  useQuery<ProjectBoq | null>({
    queryKey: ['boq', projectId],
    queryFn: () =>
      apiClient.get(`/projects/${projectId}/boq`).then(r => r.data.data),
    enabled: !!projectId,
  })

// ── Upload BOQ ───────────────────────────────────────────────────────────────
export function useBoqUpload(projectId: string) {
  return useMutation({
    mutationFn: ({ file, label }: { file: File; label?: string }) => {
      const fd = new FormData()
      fd.append('file', file)
      if (label?.trim()) fd.append('label', label.trim())
      return apiClient
        .post(`/projects/${projectId}/boq/upload`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then(r => r.data.data as { jobId: string })
    },
  })
}

// ── Poll job status ──────────────────────────────────────────────────────────
// Reuse the same polling pattern from use-schedule.ts
// Query key: ['boq-job', projectId, jobId]
export const useBoqJobStatus = (projectId: string, jobId: string | null) =>
  useQuery({
    queryKey: ['boq-job', projectId, jobId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/boq/job/${jobId}`)
        .then(r => r.data.data),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'done' || status === 'error') return false
      return 3000 // poll every 3s
    },
  })

// ── Update BOQ item ──────────────────────────────────────────────────────────
export function useUpdateBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: Record<string, unknown> }) =>
      apiClient
        .patch(`/projects/${projectId}/boq/items/${itemId}`, data)
        .then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    onError: () => toast.error('Failed to update row'),
  })
}

// ── Create manual BOQ row ────────────────────────────────────────────────────
export function useCreateBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBoqItemInput) =>
      apiClient.post(`/projects/${projectId}/boq/items`, data).then(r => r.data.data),
    onSuccess: () => {
      toast.success('BOQ row added')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: () => toast.error('Failed to add row'),
  })
}

// ── Delete BOQ item ──────────────────────────────────────────────────────────
export function useDeleteBoqItem(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiClient.delete(`/projects/${projectId}/boq/items/${itemId}`).then(r => r.data.data),
    onSuccess: () => {
      toast.success('Row deleted')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: (err: AxiosError<{ error: { message: string } }>) => {
      toast.error(err.response?.data?.error?.message ?? 'Cannot delete this row')
    },
  })
}

// ── Create activity ──────────────────────────────────────────────────────────
export function useCreateBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ boqItemId, data }: { boqItemId: string; data: CreateBoqActivityInput }) =>
      apiClient
        .post(`/projects/${projectId}/boq/items/${boqItemId}/activities`, data)
        .then(r => r.data.data),
    onSuccess: () => {
      toast.success('Activity added')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: () => toast.error('Failed to add activity'),
  })
}

// ── Update activity ──────────────────────────────────────────────────────────
export function useUpdateBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ activityId, data }: { activityId: string; data: Partial<UpdateBoqActivityInput> }) =>
      apiClient
        .patch(`/projects/${projectId}/boq/activities/${activityId}`, data)
        .then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boq', projectId] }),
    onError: () => toast.error('Failed to update activity'),
  })
}

// ── Delete activity ──────────────────────────────────────────────────────────
export function useDeleteBoqActivity(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (activityId: string) =>
      apiClient
        .delete(`/projects/${projectId}/boq/activities/${activityId}`)
        .then(r => r.data.data),
    onSuccess: () => {
      toast.success('Activity deleted')
      qc.invalidateQueries({ queryKey: ['boq', projectId] })
    },
    onError: () => toast.error('Failed to delete activity'),
  })
}

// ── Extra services config ─────────────────────────────────────────────────────
export const useExtraServicesConfig = () =>
  useQuery({
    queryKey: ['extra-services-config'],
    queryFn: () =>
      apiClient.get('/config/extra-services').then(r => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
```

---

## Add BOQ to Project Detail Navigation

In `src/features/projects/components/project-detail.tsx`, add "BOQ" to the `menuItems` list:

```typescript
// Add to menuItems array (before or after 'schedule'):
{ key: 'boq', label: 'BOQ' }
```

And add a case in `renderContent()`:

```typescript
case 'boq':
  return (
    <BoqPageEmbed projectId={projectId} />
  )
```

Where `BoqPageEmbed` is the same as `BoqPage` but without the `<Main>` wrapper (already inside one).

---

## Sidebar Navigation Entry

In `src/components/layout/data/sidebar-data.ts`, add BOQ as a sub-item under Projects or as a child of the Schedule item:

```typescript
// Under the 'schedule' navGroup or as a direct link:
{
  title: 'BOQ',
  url: '/projects',  // navigates to project list, BOQ is per-project
  icon: FileSpreadsheet,
}
```

Or more practically, the BOQ page is accessed from the project detail sidebar nav (the left menu inside the project view), not the top nav. No top-nav change needed.
