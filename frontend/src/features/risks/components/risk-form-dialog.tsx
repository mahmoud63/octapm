import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { RiskPayload, RiskRecord } from '../hooks/use-risks'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRisk?: RiskRecord | null
  isSaving?: boolean
  onSubmit: (payload: RiskPayload) => Promise<void>
}

const defaultState: RiskPayload = {
  description: '',
  probability: 'medium',
  impact: 'medium',
  severity: 'MEDIUM',
  mitigation: '',
  phase: '',
  owner: '',
  status: 'open',
}

const toFormState = (risk?: RiskRecord | null): RiskPayload => {
  if (!risk) return defaultState

  return {
    description: risk.description,
    probability: risk.probability,
    impact: risk.impact,
    severity: risk.severity,
    mitigation: risk.mitigation || '',
    phase: risk.phase || '',
    owner: risk.owner || '',
    status: risk.status,
  }
}

export function RiskFormDialog({
  open,
  onOpenChange,
  initialRisk,
  isSaving,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<RiskPayload>(() => toFormState(initialRisk))

  const isEdit = Boolean(initialRisk?.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Risk' : 'Add Risk'}</DialogTitle>
          <DialogDescription>
            Capture risk details, owner, and lifecycle status.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='risk-description'>Description</Label>
            <Textarea
              id='risk-description'
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder='Describe the risk event'
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-probability'>Probability</Label>
              <select
                id='risk-probability'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.probability}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    probability: e.target.value as RiskPayload['probability'],
                  }))
                }
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
              </select>
            </div>

            <div className='grid gap-1.5'>
              <Label htmlFor='risk-impact'>Impact</Label>
              <select
                id='risk-impact'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.impact}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    impact: e.target.value as RiskPayload['impact'],
                  }))
                }
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
              </select>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-severity'>Severity</Label>
              <select
                id='risk-severity'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.severity}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    severity: e.target.value as RiskPayload['severity'],
                  }))
                }
              >
                <option value='LOW'>LOW</option>
                <option value='MEDIUM'>MEDIUM</option>
                <option value='HIGH'>HIGH</option>
                <option value='CRITICAL'>CRITICAL</option>
              </select>
            </div>

            <div className='grid gap-1.5'>
              <Label htmlFor='risk-status'>Status</Label>
              <select
                id='risk-status'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as RiskPayload['status'],
                  }))
                }
              >
                <option value='open'>Open</option>
                <option value='monitoring'>Monitoring</option>
                <option value='closed'>Closed</option>
              </select>
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-phase'>Phase</Label>
              <Input
                id='risk-phase'
                value={form.phase || ''}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phase: e.target.value }))
                }
                placeholder='e.g. Foundations'
              />
            </div>

            <div className='grid gap-1.5'>
              <Label htmlFor='risk-owner'>Owner</Label>
              <Input
                id='risk-owner'
                value={form.owner || ''}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, owner: e.target.value }))
                }
                placeholder='Owner name'
              />
            </div>
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='risk-mitigation'>Mitigation</Label>
            <Textarea
              id='risk-mitigation'
              value={form.mitigation || ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, mitigation: e.target.value }))
              }
              placeholder='Mitigation strategy'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !form.description.trim()}
            onClick={async () => {
              await onSubmit({
                ...form,
                description: form.description.trim(),
              })
            }}
          >
            {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Risk'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
