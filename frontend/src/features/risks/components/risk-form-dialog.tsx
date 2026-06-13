import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import type { Activity } from '@/features/activities/data/schema'
import type { RiskPayload, RiskRecord } from '../hooks/use-risks'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRisk?: RiskRecord | null
  activities?: Activity[]
  isSaving?: boolean
  onSubmit: (payload: RiskPayload) => Promise<void>
}

type ActivityLinkForm = NonNullable<RiskPayload['activityLinks']>[number]

const emptyLink = (activityId = ''): ActivityLinkForm => ({
  activityId,
  relationType: 'affected',
  scheduleImpactDays: 0,
  costImpact: 0,
  notes: '',
})

const defaultState: RiskPayload = {
  description: '',
  probability: 'medium',
  impact: 'medium',
  severity: 'MEDIUM',
  mitigation: '',
  responsePlan: '',
  residualProbability: 'medium',
  residualImpact: 'medium',
  residualSeverity: 'MEDIUM',
  residualDescription: '',
  phase: '',
  owner: '',
  dueDate: '',
  escalationLevel: 'none',
  escalationNotes: '',
  status: 'open',
  activityLinks: [],
}

const toDateInputValue = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const toFormState = (risk?: RiskRecord | null): RiskPayload => {
  if (!risk) return defaultState

  return {
    description: risk.description,
    probability: risk.probability,
    impact: risk.impact,
    severity: risk.severity,
    mitigation: risk.mitigation || '',
    responsePlan: risk.responsePlan || '',
    residualProbability: risk.residualProbability || 'medium',
    residualImpact: risk.residualImpact || 'medium',
    residualSeverity: risk.residualSeverity || risk.severity,
    residualDescription: risk.residualDescription || '',
    phase: risk.phase || '',
    owner: risk.owner || '',
    dueDate: toDateInputValue(risk.dueDate),
    escalationLevel: risk.escalationLevel || 'none',
    escalationNotes: risk.escalationNotes || '',
    status:
      risk.status === 'open' || risk.status === 'monitoring'
        ? risk.status
        : 'monitoring',
    activityLinks: (risk.activityLinks || []).map((link) => ({
      activityId: link.activityId,
      relationType: link.relationType || 'affected',
      scheduleImpactDays: link.scheduleImpactDays || 0,
      costImpact: link.costImpact || 0,
      notes: link.notes || '',
    })),
  }
}

const activityLabel = (activity: Activity) =>
  `${activity.wbsCode ? `${activity.wbsCode} - ` : ''}${activity.name}`

export function RiskFormDialog({
  open,
  onOpenChange,
  initialRisk,
  activities = [],
  isSaving,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<RiskPayload>(() => toFormState(initialRisk))
  const isEdit = Boolean(initialRisk?.id)
  const canEditStatus =
    !initialRisk ||
    initialRisk.status === 'open' ||
    initialRisk.status === 'monitoring'

  const updateLink = (index: number, patch: Partial<ActivityLinkForm>) => {
    setForm((prev) => ({
      ...prev,
      activityLinks: (prev.activityLinks || []).map((link, itemIndex) =>
        itemIndex === index ? { ...link, ...patch } : link
      ),
    }))
  }

  const addLink = () => {
    const used = new Set((form.activityLinks || []).map((link) => link.activityId))
    const nextActivity =
      activities.find((activity) => !used.has(activity.id)) || activities[0]
    if (!nextActivity) return
    setForm((prev) => ({
      ...prev,
      activityLinks: [...(prev.activityLinks || []), emptyLink(nextActivity.id)],
    }))
  }

  const removeLink = (index: number) => {
    setForm((prev) => ({
      ...prev,
      activityLinks: (prev.activityLinks || []).filter(
        (_link, itemIndex) => itemIndex !== index
      ),
    }))
  }

  const cleanPayload = (): RiskPayload => ({
    ...form,
    description: form.description.trim(),
    mitigation: form.mitigation?.trim() || undefined,
    responsePlan: form.responsePlan?.trim() || undefined,
    residualDescription: form.residualDescription?.trim() || undefined,
    phase: form.phase?.trim() || undefined,
    owner: form.owner?.trim() || undefined,
    dueDate: form.dueDate || undefined,
    escalationNotes: form.escalationNotes?.trim() || undefined,
    status: canEditStatus ? form.status : undefined,
    activityLinks: (form.activityLinks || [])
      .filter((link) => link.activityId)
      .map((link) => ({
        activityId: link.activityId,
        relationType: link.relationType || 'affected',
        scheduleImpactDays: Number(link.scheduleImpactDays) || 0,
        costImpact: Number(link.costImpact) || 0,
        notes: link.notes?.trim() || undefined,
      })),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Risk' : 'Add Risk'}</DialogTitle>
          <DialogDescription>
            Capture impact, mitigation ownership, and linked schedule activities.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
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

          <div className='grid gap-3 sm:grid-cols-4'>
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
                disabled={!canEditStatus}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as RiskPayload['status'],
                  }))
                }
              >
                <option value='open'>Open</option>
                <option value='monitoring'>Monitoring</option>
              </select>
            </div>
          </div>

          <div className='grid gap-3 sm:grid-cols-3'>
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

            <div className='grid gap-1.5'>
              <Label htmlFor='risk-due-date'>Mitigation Due</Label>
              <Input
                id='risk-due-date'
                type='date'
                value={form.dueDate || ''}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, dueDate: e.target.value }))
                }
              />
            </div>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
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
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-response-plan'>Response Plan</Label>
              <Textarea
                id='risk-response-plan'
                value={form.responsePlan || ''}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, responsePlan: e.target.value }))
                }
                placeholder='Avoid, transfer, mitigate, accept'
              />
            </div>
          </div>

          <div className='grid gap-3 sm:grid-cols-4'>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-residual-probability'>Residual Prob.</Label>
              <select
                id='risk-residual-probability'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.residualProbability}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    residualProbability: e.target
                      .value as RiskPayload['residualProbability'],
                  }))
                }
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
              </select>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-residual-impact'>Residual Impact</Label>
              <select
                id='risk-residual-impact'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.residualImpact}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    residualImpact: e.target
                      .value as RiskPayload['residualImpact'],
                  }))
                }
              >
                <option value='low'>Low</option>
                <option value='medium'>Medium</option>
                <option value='high'>High</option>
              </select>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-residual-severity'>Residual Severity</Label>
              <select
                id='risk-residual-severity'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.residualSeverity}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    residualSeverity: e.target
                      .value as RiskPayload['residualSeverity'],
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
              <Label htmlFor='risk-escalation'>Escalation</Label>
              <select
                id='risk-escalation'
                className='h-9 rounded-md border bg-background px-2 text-sm'
                value={form.escalationLevel}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    escalationLevel: e.target
                      .value as RiskPayload['escalationLevel'],
                  }))
                }
              >
                <option value='none'>None</option>
                <option value='watch'>Watch</option>
                <option value='escalated'>Escalated</option>
              </select>
            </div>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-residual-description'>Residual Risk</Label>
              <Textarea
                id='risk-residual-description'
                value={form.residualDescription || ''}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    residualDescription: e.target.value,
                  }))
                }
                placeholder='Expected exposure after response'
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='risk-escalation-notes'>Escalation Notes</Label>
              <Textarea
                id='risk-escalation-notes'
                value={form.escalationNotes || ''}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    escalationNotes: e.target.value,
                  }))
                }
                placeholder='Escalation basis or next review'
              />
            </div>
          </div>

          <div className='grid gap-2 rounded-md border p-3'>
            <div className='flex items-center justify-between gap-3'>
              <Label>Activity Impact</Label>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={addLink}
                disabled={activities.length === 0}
              >
                <Plus className='h-4 w-4' />
                Link
              </Button>
            </div>

            {activities.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No activities are available for linking.
              </p>
            ) : (form.activityLinks || []).length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No linked activities.
              </p>
            ) : (
              <div className='grid gap-2'>
                {(form.activityLinks || []).map((link, index) => (
                  <div
                    key={`${link.activityId}-${index}`}
                    className='grid gap-2 rounded-md bg-muted/30 p-2 lg:grid-cols-[minmax(180px,1fr)_120px_96px_110px_32px]'
                  >
                    <select
                      className='h-9 min-w-0 rounded-md border bg-background px-2 text-sm'
                      value={link.activityId}
                      onChange={(e) =>
                        updateLink(index, { activityId: e.target.value })
                      }
                    >
                      {activities.map((activity) => (
                        <option key={activity.id} value={activity.id}>
                          {activityLabel(activity)}
                        </option>
                      ))}
                    </select>
                    <select
                      className='h-9 rounded-md border bg-background px-2 text-sm'
                      value={link.relationType || 'affected'}
                      onChange={(e) =>
                        updateLink(index, { relationType: e.target.value })
                      }
                    >
                      <option value='primary'>Primary</option>
                      <option value='affected'>Affected</option>
                      <option value='mitigation'>Mitigation</option>
                    </select>
                    <Input
                      type='number'
                      value={link.scheduleImpactDays ?? 0}
                      onChange={(e) =>
                        updateLink(index, {
                          scheduleImpactDays: Number(e.target.value) || 0,
                        })
                      }
                      aria-label='Schedule impact days'
                    />
                    <Input
                      type='number'
                      min={0}
                      value={link.costImpact ?? 0}
                      onChange={(e) =>
                        updateLink(index, {
                          costImpact: Number(e.target.value) || 0,
                        })
                      }
                      aria-label='Cost impact'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='size-9 text-destructive'
                      onClick={() => removeLink(index)}
                      aria-label='Remove activity link'
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={isSaving || !form.description.trim()}
            onClick={async () => {
              await onSubmit(cleanPayload())
            }}
          >
            {isSaving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Risk'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
