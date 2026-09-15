import { useState } from 'react'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { UserPicker } from '@/components/user-picker'
import { useActivities } from '@/features/activities/hooks/use-activities'
import { useProjectParties } from '@/features/projects/hooks/use-projects'
import {
  useCreateMaterialTest,
  useCreateNcr,
  useCreateSafetyIncident,
} from '../hooks/use-quality'

/**
 * Raising a quality record properly (Phase 22B).
 *
 * The quick-add on each tab stays for the fast path — one line and "Add" —
 * but an NCR, a safety incident or a material test that will be worked on
 * needs its severity, the activity it sits on, the person or company that must
 * answer it and a date, and the Phase 22 audit found those typed later or not
 * at all. Every reference here is picked from what the project already has:
 * its activities, its people, its parties.
 */
export type QualityCreateKind = 'ncr' | 'safety' | 'material_test'

const NONE = '__none__'
const today = () => new Date().toISOString().slice(0, 10)

const TITLES: Record<QualityCreateKind, { title: string; description: string; submit: string; success: string }> = {
  ncr: {
    title: 'New non-conformance',
    description:
      'What does not conform, how serious it is, where it sits in the programme, and who must answer it.',
    submit: 'Raise NCR',
    success: 'NCR raised',
  },
  safety: {
    title: 'Record a safety incident',
    description:
      'What happened, how serious it was, and who is responsible for the follow-up.',
    submit: 'Record incident',
    success: 'Incident recorded',
  },
  material_test: {
    title: 'Log a material test',
    description:
      'The test, the activity it covers, when it was or will be taken, and who reviews the result.',
    submit: 'Log test',
    success: 'Material test logged',
  },
}

export function QualityCreateDialog({
  projectId,
  kind,
  onOpenChange,
}: {
  projectId: string
  kind: QualityCreateKind | null
  onOpenChange: (open: boolean) => void
}) {
  const open = kind !== null
  const { data: activities } = useActivities(projectId)
  const { data: parties } = useProjectParties(projectId)
  const createNcr = useCreateNcr(projectId)
  const createSafety = useCreateSafetyIncident(projectId)
  const createTest = useCreateMaterialTest(projectId)

  const [text, setText] = useState('')
  const [severity, setSeverity] = useState('minor')
  const [incidentType, setIncidentType] = useState('near_miss')
  const [incidentSeverity, setIncidentSeverity] = useState('low')
  const [activityId, setActivityId] = useState('')
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(null)
  const [assigneeCompanyId, setAssigneeCompanyId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [testDate, setTestDate] = useState(today())

  const reset = () => {
    setText('')
    setSeverity('minor')
    setIncidentType('near_miss')
    setIncidentSeverity('low')
    setActivityId('')
    setAssigneeUserId(null)
    setAssigneeCompanyId('')
    setDueDate('')
    setTestDate(today())
  }
  const close = () => {
    reset()
    onOpenChange(false)
  }

  const busy = createNcr.isPending || createSafety.isPending || createTest.isPending
  const copy = kind ? TITLES[kind] : TITLES.ncr
  const canSubmit = text.trim().length > 0 && !busy

  const submit = async () => {
    if (!kind) return
    const common = {
      activityId: activityId || null,
      assigneeUserId: assigneeUserId || null,
      assigneeCompanyId: assigneeCompanyId || null,
      dueDate: dueDate || undefined,
    }
    try {
      if (kind === 'ncr') {
        await createNcr.mutateAsync({
          description: text.trim(),
          severity: severity as 'major' | 'minor',
          ...common,
        })
      } else if (kind === 'safety') {
        await createSafety.mutateAsync({
          title: text.trim(),
          incidentType: incidentType as 'near_miss' | 'first_aid' | 'lti' | 'fatality',
          severity: incidentSeverity,
          ...common,
        })
      } else {
        await createTest.mutateAsync({
          testType: text.trim(),
          testDate: testDate || undefined,
          ...common,
        })
      }
      toast.success(copy.success)
      close()
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-xl'
        data-testid='uat-quality-create'
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className='grid gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='quality-create-text'>
              {kind === 'ncr'
                ? 'What does not conform'
                : kind === 'safety'
                  ? 'What happened'
                  : 'Test type'}
            </Label>
            {kind === 'material_test' ? (
              <Input
                id='quality-create-text'
                value={text}
                placeholder='Concrete cube compressive strength, 28 days'
                onChange={(e) => setText(e.target.value)}
                data-testid='uat-quality-create-text'
              />
            ) : (
              <Textarea
                id='quality-create-text'
                value={text}
                placeholder={
                  kind === 'ncr'
                    ? 'Honeycombing on column C2 below level 1, 40 mm deep over 0.3 m²'
                    : 'Near miss: unsecured scaffold board fell from level 3, nobody below'
                }
                onChange={(e) => setText(e.target.value)}
                data-testid='uat-quality-create-text'
              />
            )}
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            {kind === 'ncr' && (
              <div className='grid gap-1.5'>
                <Label>Severity</Label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger data-testid='uat-quality-create-severity'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='minor'>Minor — 8 points off the quality score</SelectItem>
                    <SelectItem value='major'>Major — 20 points off the quality score</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {kind === 'safety' && (
              <>
                <div className='grid gap-1.5'>
                  <Label>Incident type</Label>
                  <Select value={incidentType} onValueChange={setIncidentType}>
                    <SelectTrigger data-testid='uat-quality-create-incident-type'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='near_miss'>Near miss</SelectItem>
                      <SelectItem value='first_aid'>First aid</SelectItem>
                      <SelectItem value='lti'>Lost-time injury</SelectItem>
                      <SelectItem value='fatality'>Fatality</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='grid gap-1.5'>
                  <Label>Severity</Label>
                  <Select value={incidentSeverity} onValueChange={setIncidentSeverity}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='low'>Low</SelectItem>
                      <SelectItem value='medium'>Medium</SelectItem>
                      <SelectItem value='high'>High</SelectItem>
                      <SelectItem value='critical'>Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {kind === 'material_test' && (
              <div className='grid gap-1.5'>
                <Label htmlFor='quality-create-test-date'>Test date</Label>
                <Input
                  id='quality-create-test-date'
                  type='date'
                  value={testDate}
                  onChange={(e) => setTestDate(e.target.value)}
                />
              </div>
            )}
            <div className='grid gap-1.5'>
              <Label>Activity</Label>
              <Select
                value={activityId || NONE}
                onValueChange={(value) => setActivityId(value === NONE ? '' : value)}
              >
                <SelectTrigger data-testid='uat-quality-create-activity'>
                  <SelectValue placeholder='No activity' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No activity</SelectItem>
                  {(activities || []).map((activity) => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {activity.activityCode || activity.wbsCode
                        ? `${activity.activityCode || activity.wbsCode} · `
                        : ''}
                      {activity.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='quality-create-person'>
                {kind === 'material_test' ? 'Reviewed by' : 'Responsible person'}
              </Label>
              <UserPicker
                id='quality-create-person'
                projectId={projectId}
                value={assigneeUserId}
                onChange={setAssigneeUserId}
                placeholder='Pick a person'
                testId='uat-quality-create-person'
              />
            </div>
            <div className='grid gap-1.5'>
              <Label>Responsible company</Label>
              <Select
                value={assigneeCompanyId || NONE}
                onValueChange={(value) => setAssigneeCompanyId(value === NONE ? '' : value)}
              >
                <SelectTrigger data-testid='uat-quality-create-company'>
                  <SelectValue placeholder='Own company' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Own company</SelectItem>
                  {(parties?.items || [])
                    .filter((party) => party.companyId)
                    .map((party) => (
                      <SelectItem key={party.id} value={party.companyId}>
                        {party.company?.name || 'Company'}
                        {party.roleLabel || party.role
                          ? ` (${party.roleLabel || party.role})`
                          : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-1.5 sm:max-w-xs'>
            <Label htmlFor='quality-create-due'>
              {kind === 'material_test' ? 'Result due' : 'Close out by'}
            </Label>
            <Input
              id='quality-create-due'
              type='date'
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              data-testid='uat-quality-create-due'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit}
            data-testid='uat-quality-create-submit'
          >
            {busy ? 'Saving…' : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
