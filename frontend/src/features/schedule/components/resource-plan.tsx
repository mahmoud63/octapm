import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'

interface Props {
  projectId: string
}

type ResourcePlanActivity = {
  id: string
  activityId: string
  name: string
}

type ResourcePlanResource = {
  id: string
  resourceType: string
  resourceName: string
  quantity: number
  unit?: string | null
  dailyRate?: number | null
  totalCost?: number | null
}

type ResourcePlanGroup = {
  activity: ResourcePlanActivity
  resources: ResourcePlanResource[]
}

type ResourcePlanResponse = {
  resources?: ResourcePlanGroup[]
  summary?: {
    totalLaborCost?: number
    totalEquipmentCost?: number
    totalMaterialCost?: number
  }
}

const TYPE_CLASS: Record<string, string> = {
  labor: 'bg-blue-100 text-blue-800',
  equipment: 'bg-orange-100 text-orange-800',
  material: 'bg-green-100 text-green-800',
}

const fmt = (value: number) =>
  value >= 1000
    ? `$${(value / 1000).toFixed(1)}K`
    : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

export function ResourcePlan({ projectId }: Props) {
  const { data, isLoading } = useQuery<ResourcePlanResponse>({
    queryKey: ['schedule-resources', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/schedule/resources`)
        .then((r) => r.data.data),
  })

  if (isLoading) {
    return (
      <p className='py-8 text-sm text-muted-foreground'>Loading resources...</p>
    )
  }

  const resources = data?.resources || []
  const summary = data?.summary || {
    totalLaborCost: 0,
    totalEquipmentCost: 0,
    totalMaterialCost: 0,
  }

  if (!resources.length) {
    return (
      <div className='rounded-md border p-6 text-sm text-muted-foreground'>
        No resource allocations found yet. Regenerate schedule or run import to
        populate Pass 3 resource allocation.
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-lg font-bold text-blue-600'>
            {fmt(Number(summary.totalLaborCost || 0))}
          </p>
          <p className='text-xs text-muted-foreground'>Labor Cost</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-lg font-bold text-orange-600'>
            {fmt(Number(summary.totalEquipmentCost || 0))}
          </p>
          <p className='text-xs text-muted-foreground'>Equipment Cost</p>
        </div>
        <div className='rounded-lg border p-3 text-center'>
          <p className='text-lg font-bold text-green-600'>
            {fmt(Number(summary.totalMaterialCost || 0))}
          </p>
          <p className='text-xs text-muted-foreground'>Material Cost</p>
        </div>
      </div>

      <div className='space-y-2'>
        {resources.map((group) => (
          <div key={group.activity.id} className='rounded-lg border p-3'>
            <p className='mb-2 text-sm font-medium'>
              <span className='mr-2 font-mono text-xs text-muted-foreground'>
                {group.activity.activityId}
              </span>
              {group.activity.name}
            </p>
            <div className='flex flex-wrap gap-2'>
              {group.resources.map((resource) => (
                <div
                  key={resource.id}
                  className={[
                    'rounded px-2 py-1 text-xs',
                    TYPE_CLASS[resource.resourceType] ||
                      'bg-slate-100 text-slate-700',
                  ].join(' ')}
                >
                  {resource.resourceName} x {resource.quantity}
                  {resource.unit ? ` ${resource.unit}` : ''}
                  {resource.dailyRate ? ` @ $${resource.dailyRate}/d` : ''}
                  {resource.totalCost
                    ? ` = ${fmt(Number(resource.totalCost))}`
                    : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
