import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  useCalculateEot,
  useCreateEotClaim,
  useEotClaims,
} from '../hooks/use-commercial'

const fmtMoney = (value: number) =>
  '$' + Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function EotPanel({ projectId }: { projectId: string }) {
  const { data: claims } = useEotClaims(projectId)
  const calculateMutation = useCalculateEot(projectId)
  const createMutation = useCreateEotClaim(projectId)

  const [eventName, setEventName] = useState('')
  const [delayDays, setDelayDays] = useState('')
  const [eotDaysGranted, setEotDaysGranted] = useState('')
  const [analysis, setAnalysis] = useState('')

  const calc = calculateMutation.data as
    | {
        effectiveDelay: number
        ldApplicableDays: number
        ldLiability: number
        claimLetter: string
      }
    | undefined

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
                  analysis: analysis || undefined,
                })
                setEventName('')
                setDelayDays('')
                setEotDaysGranted('')
                setAnalysis('')
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
                  {fmtMoney(claim.ldLiability)}
                </td>
                <td className='p-2 text-xs capitalize'>{claim.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
