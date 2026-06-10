import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ScheduleActivity } from '@/features/schedule/data/schema'
import {
  useCalculateEot,
  useCreateEotClaim,
  useEotClaims,
  useUpdateEotClaim,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function EotPanel({
  projectId,
  activities = [],
}: {
  projectId: string
  activities?: ScheduleActivity[]
}) {
  const { data: claims } = useEotClaims(projectId)
  const calculateMutation = useCalculateEot(projectId)
  const createMutation = useCreateEotClaim(projectId)
  const updateMutation = useUpdateEotClaim(projectId)

  const [eventName, setEventName] = useState('')
  const [delayDays, setDelayDays] = useState('')
  const [eotDaysGranted, setEotDaysGranted] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [activityIds, setActivityIds] = useState<string[]>([])
  const [supportingDocumentIds, setSupportingDocumentIds] = useState('')

  const calc = calculateMutation.data as
    | {
        effectiveDelay: number
        ldApplicableDays: number
        ldLiability: number
        criticalPathImpactDays: number
        claimLetter: string
      }
    | undefined

  const documentIds = supportingDocumentIds
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)

  const activityLinks = activityIds.map((activityId) => ({
    activityId,
    delayDays: Number(delayDays) || 0,
    impactBasis: analysis || undefined,
  }))

  const claimProofReady = (claim: {
    activityLinks?: unknown[]
    attachmentRefs?: unknown[]
  }) => Boolean(claim.activityLinks?.length && claim.attachmentRefs?.length)

  return (
    <div className='space-y-3'>
      <div className='grid gap-2 rounded-md border p-3 sm:grid-cols-2'>
        <Input
          placeholder='Delay event name'
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          placeholder='Delay days'
          value={delayDays}
          onChange={(e) => setDelayDays(e.target.value)}
        />
        <Input
          type='number'
          min={0}
          placeholder='EOT days granted'
          value={eotDaysGranted}
          onChange={(e) => setEotDaysGranted(e.target.value)}
        />
        <div className='flex gap-2'>
          <Button
            variant='outline'
            disabled={calculateMutation.isPending || !eventName}
            onClick={async () => {
              try {
                await calculateMutation.mutateAsync({
                  eventName,
                  delayDays: Number(delayDays) || 0,
                  eotDaysGranted: Number(eotDaysGranted) || 0,
                  affectedActivityIds: activityIds,
                  activityLinks,
                  analysis: analysis || undefined,
                })
                toast.success('EOT analysis generated')
              } catch {
                toast.error('Failed to calculate EOT')
              }
            }}
          >
            Calculate
          </Button>
          <Button
            disabled={createMutation.isPending || !eventName}
            onClick={async () => {
              try {
                await createMutation.mutateAsync({
                  eventName,
                  delayDays: Number(delayDays) || 0,
                  eotDaysGranted: Number(eotDaysGranted) || 0,
                  affectedActivityIds: activityIds,
                  activityLinks,
                  analysis: analysis || undefined,
                  supportingDocumentIds: documentIds.length
                    ? documentIds
                    : undefined,
                })
                setEventName('')
                setDelayDays('')
                setEotDaysGranted('')
                setAnalysis('')
                setActivityIds([])
                setSupportingDocumentIds('')
                toast.success('EOT claim created')
              } catch {
                toast.error('Failed to create claim')
              }
            }}
          >
            Create Claim
          </Button>
        </div>
        <div className='sm:col-span-2'>
          <Textarea
            rows={3}
            placeholder='Analysis notes'
            value={analysis}
            onChange={(e) => setAnalysis(e.target.value)}
          />
        </div>
        <div className='sm:col-span-2'>
          <Input
            placeholder='Supporting document IDs'
            value={supportingDocumentIds}
            onChange={(e) => setSupportingDocumentIds(e.target.value)}
          />
        </div>
        <div className='sm:col-span-2'>
          <div className='grid max-h-36 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
            {activities.map((activity) => (
              <label
                key={activity.id}
                className='flex items-start gap-2 rounded-sm px-2 py-1 text-xs hover:bg-muted/60'
              >
                <input
                  type='checkbox'
                  className='mt-0.5'
                  checked={activityIds.includes(activity.id)}
                  onChange={(e) => {
                    setActivityIds((prev) =>
                      e.target.checked
                        ? [...prev, activity.id]
                        : prev.filter((id) => id !== activity.id)
                    )
                  }}
                />
                <span className='min-w-0 truncate'>
                  {activity.wbsCode ? `${activity.wbsCode} - ` : ''}
                  {activity.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {calc && (
        <div className='grid grid-cols-3 gap-2'>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>Effective Delay</p>
            <p className='font-semibold'>{calc.effectiveDelay} days</p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>LD Days</p>
            <p className='font-semibold'>{calc.ldApplicableDays} days</p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>LD Liability</p>
            <p className='font-semibold'>{fmtMoney(calc.ldLiability)}</p>
          </div>
          <div className='rounded border p-2 text-xs'>
            <p className='text-muted-foreground'>CP Impact</p>
            <p className='font-semibold'>
              {calc.criticalPathImpactDays || 0} days
            </p>
          </div>
        </div>
      )}

      <div className='overflow-x-auto rounded-md border'>
        <table className='w-full text-sm'>
          <thead className='border-b bg-muted/50'>
            <tr>
              <th className='p-2 text-left'>Ref</th>
              <th className='p-2 text-left'>Event</th>
              <th className='p-2 text-right'>Delay</th>
              <th className='p-2 text-right'>EOT</th>
              <th className='p-2 text-right'>CP Impact</th>
              <th className='p-2 text-left'>Activities</th>
              <th className='p-2 text-left'>Proof</th>
              <th className='p-2 text-right'>LD</th>
              <th className='p-2 text-left'>Status</th>
            </tr>
          </thead>
          <tbody>
            {claims?.map((claim) => (
              <tr key={claim.id} className='border-b'>
                <td className='p-2 text-xs'>{claim.ref}</td>
                <td className='p-2 text-xs'>{claim.eventName}</td>
                <td className='p-2 text-right text-xs'>{claim.delayDays}</td>
                <td className='p-2 text-right text-xs'>
                  {claim.eotDaysGranted}
                </td>
                <td className='p-2 text-right text-xs'>
                  {claim.activityLinks?.reduce(
                    (sum, link) => sum + (Number(link.criticalPathImpactDays) || 0),
                    0
                  ) || 0}
                </td>
                <td className='max-w-56 truncate p-2 text-xs'>
                  {claim.activityLinks?.length
                    ? claim.activityLinks
                        .map((link) => link.activity?.name || link.activityId)
                        .join(', ')
                    : '-'}
                </td>
                <td className='p-2 text-xs'>
                  <span
                    className={
                      claimProofReady(claim)
                        ? 'text-green-600'
                        : 'text-amber-600'
                    }
                  >
                    {claimProofReady(claim) ? 'Ready' : 'Needs proof'}
                  </span>
                </td>
                <td className='p-2 text-right text-xs'>
                  {fmtMoney(claim.ldLiability)}
                </td>
                <td className='p-2 text-xs capitalize'>
                  <div className='flex items-center gap-2'>
                    <span>{claim.status}</span>
                    {claim.status === 'draft' && claimProofReady(claim) && (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={updateMutation.isPending}
                        onClick={async () => {
                          try {
                            await updateMutation.mutateAsync({
                              claimId: claim.id,
                              payload: { status: 'submitted' },
                            })
                            toast.success('EOT claim submitted')
                          } catch {
                            toast.error('Failed to submit claim')
                          }
                        }}
                      >
                        Submit
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
