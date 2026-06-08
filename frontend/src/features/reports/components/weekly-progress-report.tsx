/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/services/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Props {
  projectId: string
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
}

export function WeeklyProgressReport({ projectId }: Props) {
  const queryClient = useQueryClient()

  const { data: reports } = useQuery({
    queryKey: ['weekly-reports', projectId],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/weekly-reports`)
        .then((r) => r.data.data),
  })

  const { data: current } = useQuery({
    queryKey: ['weekly-reports', projectId, 'current'],
    queryFn: () =>
      apiClient
        .get(`/projects/${projectId}/weekly-reports/current`)
        .then((r) => r.data.data),
  })

  const submitMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.patch(`/projects/${projectId}/weekly-reports/${id}`, {
        status: 'submitted',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-reports', projectId] })
      queryClient.invalidateQueries({
        queryKey: ['weekly-reports', projectId, 'current'],
      })
    },
  })

  return (
    <div className='space-y-4'>
      {current && (
        <div className='space-y-3 rounded-lg border p-4'>
          <div className='flex items-center justify-between'>
            <h3 className='font-semibold'>Current Week - {current.ref}</h3>
            <Badge className={STATUS_CLASS[current.status] || ''}>
              {current.status}
            </Badge>
          </div>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
            <div>
              <p className='text-xs text-muted-foreground'>Planned Progress</p>
              <p className='text-lg font-bold'>
                {current.plannedProgress ?? 0}%
              </p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>Actual Progress</p>
              <p className='text-lg font-bold text-green-600'>
                {current.actualProgress ?? 0}%
              </p>
            </div>
            <div>
              <p className='text-xs text-muted-foreground'>Variance</p>
              <p
                className={[
                  'text-lg font-bold',
                  (current.actualProgress ?? 0) -
                    (current.plannedProgress ?? 0) >=
                  0
                    ? 'text-green-600'
                    : 'text-red-600',
                ].join(' ')}
              >
                {(
                  (current.actualProgress ?? 0) - (current.plannedProgress ?? 0)
                ).toFixed(1)}
                %
              </p>
            </div>
          </div>

          <div className='grid grid-cols-1 gap-3 text-sm sm:grid-cols-3'>
            <div>
              Completed:{' '}
              <strong>
                {Array.isArray(current.activitiesCompleted)
                  ? current.activitiesCompleted.length
                  : 0}
              </strong>
            </div>
            <div>
              In Progress:{' '}
              <strong>
                {Array.isArray(current.activitiesInProgress)
                  ? current.activitiesInProgress.length
                  : 0}
              </strong>
            </div>
            <div>
              Weather Delay: <strong>{current.weatherDelayDays || 0}d</strong>
            </div>
          </div>

          {current.status === 'draft' && (
            <Button
              size='sm'
              onClick={() => submitMutation.mutate(current.id)}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit Report'}
            </Button>
          )}
        </div>
      )}

      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              {[
                'Ref',
                'Week',
                'Planned %',
                'Actual %',
                'Variance',
                'Manpower',
                'Weather',
                'Status',
              ].map((h) => (
                <th key={h} className='px-3 py-2 text-left font-medium'>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(reports || []).map((row: any) => {
              const variance =
                (row.actualProgress ?? 0) - (row.plannedProgress ?? 0)
              return (
                <tr key={row.id} className='border-t hover:bg-muted/20'>
                  <td className='px-3 py-2 font-mono text-xs'>{row.ref}</td>
                  <td className='px-3 py-2 text-xs'>
                    {new Date(row.weekStartDate).toLocaleDateString('en-GB')} -{' '}
                    {new Date(row.weekEndDate).toLocaleDateString('en-GB')}
                  </td>
                  <td className='px-3 py-2'>{row.plannedProgress}%</td>
                  <td className='px-3 py-2'>{row.actualProgress}%</td>
                  <td
                    className={[
                      'px-3 py-2 font-medium',
                      variance >= 0 ? 'text-green-600' : 'text-red-600',
                    ].join(' ')}
                  >
                    {variance >= 0 ? '+' : ''}
                    {variance.toFixed(1)}%
                  </td>
                  <td className='px-3 py-2'>{row.manpowerCount}</td>
                  <td className='px-3 py-2'>{row.weatherDelayDays}d</td>
                  <td className='px-3 py-2'>
                    <Badge className={STATUS_CLASS[row.status] || ''}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
