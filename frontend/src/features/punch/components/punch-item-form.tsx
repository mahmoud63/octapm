import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CompanyPicker, UserPicker } from '@/components/user-picker'
import { useSheets } from '@/features/drawings/hooks/use-drawings'
import { LocationPicker } from '@/features/locations/components/location-picker'
import {
  OBSERVATION_TYPES,
  OBSERVATION_TYPE_LABEL,
  PUNCH_PRIORITIES,
  type ObservationType,
  type PunchKind,
  type PunchPriority,
} from '../hooks/use-punch'
import type { PunchFormValue } from '../lib/form'

const NO_SHEET = '__none'

/**
 * The punch item / observation fields, shared by create (single and bulk
 * defaults) and edit. Assignees come from the project team so ball-in-court
 * and company visibility work; the sheet ties the item to a drawing.
 */
export function PunchItemForm({
  projectId,
  value,
  onChange,
  kind = 'punch',
  hideTitle = false,
  disabled = false,
  idPrefix = 'punch',
}: {
  projectId: string
  value: PunchFormValue
  onChange: (next: PunchFormValue) => void
  kind?: PunchKind
  hideTitle?: boolean
  disabled?: boolean
  idPrefix?: string
}) {
  const observation = kind === 'observation'
  const { data: sheets } = useSheets(projectId, { status: 'current' })
  const sheetOptions = sheets?.items ?? []
  const set = <K extends keyof PunchFormValue>(
    key: K,
    next: PunchFormValue[K]
  ) => onChange({ ...value, [key]: next })

  return (
    <div className='space-y-3' data-testid='uat-punch-form'>
      {!hideTitle && (
        <div className='space-y-1'>
          <Label htmlFor={`${idPrefix}-title`}>
            {observation ? 'What was observed' : 'What needs fixing'}
          </Label>
          <Input
            id={`${idPrefix}-title`}
            value={value.title}
            onChange={(event) => set('title', event.target.value)}
            placeholder={
              observation
                ? 'e.g. Unguarded slab edge on level 3'
                : 'e.g. Paint scuffed on corridor wall, gridline C4'
            }
            maxLength={200}
            disabled={disabled}
            data-testid='uat-punch-title'
          />
        </div>
      )}
      <div className='space-y-1'>
        <Label htmlFor={`${idPrefix}-description`}>Details</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(event) => set('description', event.target.value)}
          rows={3}
          placeholder={
            observation
              ? 'What you saw, who was involved, what was done on the spot'
              : 'What is wrong and what "done" looks like'
          }
          disabled={disabled}
        />
      </div>
      {observation && (
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1'>
            <Label>Type</Label>
            <Select
              value={value.observationType}
              onValueChange={(next) =>
                set('observationType', next as ObservationType)
              }
              disabled={disabled}
            >
              <SelectTrigger data-testid='uat-observation-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBSERVATION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {OBSERVATION_TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor={`${idPrefix}-hazard`}>Hazard</Label>
            <Input
              id={`${idPrefix}-hazard`}
              value={value.hazard}
              onChange={(event) => set('hazard', event.target.value)}
              placeholder='Fall from height, struck by, electrical…'
              maxLength={120}
              disabled={disabled}
              data-testid='uat-observation-hazard'
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor={`${idPrefix}-condition`}>
              Contributing condition
            </Label>
            <Textarea
              id={`${idPrefix}-condition`}
              value={value.contributingCondition}
              onChange={(event) =>
                set('contributingCondition', event.target.value)
              }
              rows={2}
              placeholder='Missing guardrail, poor lighting, no permit…'
              maxLength={2000}
              disabled={disabled}
            />
          </div>
        </div>
      )}
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label>Priority</Label>
          <Select
            value={value.priority}
            onValueChange={(next) => set('priority', next as PunchPriority)}
            disabled={disabled}
          >
            <SelectTrigger data-testid='uat-punch-priority'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PUNCH_PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor={`${idPrefix}-trade`}>Trade</Label>
          <Input
            id={`${idPrefix}-trade`}
            value={value.trade}
            onChange={(event) => set('trade', event.target.value)}
            placeholder='Painting, Joinery, MEP…'
            maxLength={80}
            disabled={disabled}
          />
        </div>
        <div className='space-y-1'>
          <Label>Location</Label>
          <LocationPicker
            projectId={projectId}
            value={value.locationId}
            onChange={(next) => set('locationId', next)}
            allowRoot
            rootLabel='No location'
            placeholder='Building / level / room'
            disabled={disabled}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor={`${idPrefix}-location-text`}>Exact spot</Label>
          <Input
            id={`${idPrefix}-location-text`}
            value={value.locationText}
            onChange={(event) => set('locationText', event.target.value)}
            placeholder='e.g. behind door D-204'
            maxLength={200}
            disabled={disabled}
          />
        </div>
        {sheetOptions.length > 0 && (
          <div className='space-y-1'>
            <Label>Drawing</Label>
            <Select
              value={value.sheetId ?? NO_SHEET}
              onValueChange={(next) =>
                set('sheetId', next === NO_SHEET ? null : next)
              }
              disabled={disabled}
            >
              <SelectTrigger data-testid='uat-punch-sheet'>
                <SelectValue placeholder='No drawing' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SHEET}>No drawing</SelectItem>
                {sheetOptions.map((sheet) => (
                  <SelectItem key={sheet.id} value={sheet.id}>
                    {sheet.number} · {sheet.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className='space-y-1'>
          <Label htmlFor={`${idPrefix}-due`}>Due</Label>
          <Input
            id={`${idPrefix}-due`}
            type='date'
            value={value.dueDate}
            onChange={(event) => set('dueDate', event.target.value)}
            disabled={disabled}
            data-testid='uat-punch-due'
          />
        </div>
        <div className='space-y-1'>
          <Label>Responsible company</Label>
          <CompanyPicker
            projectId={projectId}
            value={value.assigneeCompanyId}
            onChange={(next) => set('assigneeCompanyId', next)}
            placeholder='Which subcontractor'
            disabled={disabled}
            testId='uat-punch-company'
          />
        </div>
        <div className='space-y-1'>
          <Label>Assignee</Label>
          <UserPicker
            projectId={projectId}
            value={value.assigneeUserId}
            onChange={(next) => set('assigneeUserId', next)}
            placeholder='Person doing the work'
            disabled={disabled}
            testId='uat-punch-assignee'
          />
        </div>
        <div className='space-y-1'>
          <Label>Manager</Label>
          <UserPicker
            projectId={projectId}
            value={value.managerUserId}
            onChange={(next) => set('managerUserId', next)}
            placeholder='Who follows it up'
            disabled={disabled}
          />
        </div>
        <div className='space-y-1'>
          <Label>Final approver</Label>
          <UserPicker
            projectId={projectId}
            value={value.finalApproverUserId}
            onChange={(next) => set('finalApproverUserId', next)}
            placeholder='Who signs it off'
            disabled={disabled}
            testId='uat-punch-approver'
          />
          <p className='text-xs text-muted-foreground'>
            When set, only this person can close the item.
          </p>
        </div>
      </div>
    </div>
  )
}
