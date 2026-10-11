import { useEffect, useState } from 'react'
import { Loader2, Mail, Shield, Star, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { useCanPerform } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { type AccessSelection, type ConsultantsOverview, useConsultants, useInviteConsultant, useSetConsultantAccess } from '../hooks/use-external-reviews'
import { formatDay } from '../lib/duration'

const REVIEW_LABEL: Record<string, string> = { rfi: 'RFIs', submittal: 'Submittals', progress_report: 'Reports', itp: 'Inspections', ncr: 'NCR corrective actions', closeout_deliverable: 'Closeout deliverables' }

/**
 * Module × action access for one consultant: VIEW per module, REVIEW per
 * record type (needs VIEW), COMMENT / UPLOAD on their reviews. Cost and
 * procurement are offered but off by default; internal contractor notes are
 * never visible to any consultant whatever is chosen here.
 */
export function AccessEditor({ overview, value, onChange }: { overview: ConsultantsOverview; value: AccessSelection; onChange: (value: AccessSelection) => void }) {
  const setModule = (module: string, on: boolean) => {
    const review = overview.modules.find((row) => row.module === module)?.review
    onChange({ ...value, modules: { ...value.modules, [module]: on ? 'read_only' : 'none' }, reviews: on || !review ? value.reviews : value.reviews.filter((type) => type !== review) })
  }
  const setReview = (type: string, on: boolean) => onChange({ ...value, reviews: on ? [...new Set([...value.reviews, type])] as AccessSelection['reviews'] : value.reviews.filter((row) => row !== type) })
  return (
    <div className='overflow-x-auto rounded-md border' data-testid='uat-consultant-access-editor'>
      <table className='w-full text-sm'>
        <thead className='bg-muted/40 text-xs text-muted-foreground'>
          <tr><th className='px-3 py-1.5 text-left font-medium'>Module</th><th className='px-3 py-1.5 text-center font-medium'>View</th><th className='px-3 py-1.5 text-center font-medium'>Review / decide</th></tr>
        </thead>
        <tbody>
          {overview.modules.map((row) => {
            const on = value.modules[row.module] === 'read_only'
            const sensitive = ['cost', 'procurement'].includes(row.module)
            return (
              <tr key={row.module} className='border-t'>
                <td className='px-3 py-1.5'>{row.label}{sensitive && <span className='ms-1 text-[11px] text-amber-700 dark:text-amber-400'>(contractor finances)</span>}</td>
                <td className='px-3 py-1.5 text-center'><Checkbox checked={on} onCheckedChange={(checked) => setModule(row.module, checked === true)} aria-label={`View ${row.label}`} /></td>
                <td className='px-3 py-1.5 text-center'>{row.review ? <Checkbox disabled={!on} checked={value.reviews.includes(row.review)} onCheckedChange={(checked) => setReview(row.review as string, checked === true)} aria-label={`Review ${row.label}`} /> : <span className='text-xs text-muted-foreground'>—</span>}</td>
              </tr>
            )
          })}
          <tr className='border-t'>
            <td className='px-3 py-1.5'>Comment and upload on their reviews</td>
            <td className='px-3 py-1.5 text-center' colSpan={2}><Checkbox checked={value.comment || value.reviews.length > 0} disabled={value.reviews.length > 0} onCheckedChange={(checked) => onChange({ ...value, comment: checked === true })} /></td>
          </tr>
          <tr className='border-t bg-muted/30'>
            <td className='px-3 py-1.5 text-xs text-muted-foreground' colSpan={3}><Shield className='me-1 inline h-3.5 w-3.5' /> Internal contractor notes: never visible to consultants.</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function InviteDialog({ projectId, overview, open, onClose }: { projectId: string; overview: ConsultantsOverview; open: boolean; onClose: () => void }) {
  const invite = useInviteConsultant(projectId)
  const empty = { companyName: '', discipline: 'lead', contactName: '', email: '', jobTitle: '', projectRole: '', isPrimaryReviewer: true, notes: '', templateKey: 'lead' }
  const [form, setForm] = useState(empty)
  const [customise, setCustomise] = useState(false)
  const template = overview.templates.find((row) => row.key === form.templateKey)
  const [access, setAccess] = useState<AccessSelection | null>(template?.selection ?? null)
  useEffect(() => {
    if (open) {
      setForm(empty)
      setCustomise(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (template) setAccess(template.selection)
  }, [template])
  const set = (patch: Partial<typeof form>) => setForm((value) => ({ ...value, ...patch }))
  const valid = form.companyName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && form.templateKey
  return (
    <Dialog open={open} onOpenChange={(value) => !value && !invite.isPending && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-2xl' data-testid='uat-invite-consultant'>
        <DialogHeader>
          <DialogTitle>Invite Consultant</DialogTitle>
          <DialogDescription>They receive the standard OctaPM invitation and set up their own sign-in. Access starts only when they accept, and only on this project.</DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='consultant-company'>Consultant company</Label>
            <Input id='consultant-company' list='consultant-companies' value={form.companyName} onChange={(event) => set({ companyName: event.target.value })} placeholder='e.g. ABC Engineering' />
            <datalist id='consultant-companies'>{overview.parties.map((party) => <option key={party.id} value={party.name} />)}</datalist>
          </div>
          <div className='space-y-1.5'>
            <Label>Consultant type / discipline</Label>
            <Select value={form.discipline} onValueChange={(discipline) => set({ discipline })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(overview.types).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='consultant-contact'>Contact name</Label>
            <Input id='consultant-contact' value={form.contactName} onChange={(event) => set({ contactName: event.target.value })} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='consultant-email'>Email</Label>
            <Input id='consultant-email' type='email' value={form.email} onChange={(event) => set({ email: event.target.value })} />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='consultant-title'>Job title</Label>
            <Input id='consultant-title' value={form.jobTitle} onChange={(event) => set({ jobTitle: event.target.value })} placeholder='e.g. Structural Engineer' />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='consultant-role'>Project role</Label>
            <Input id='consultant-role' value={form.projectRole} onChange={(event) => set({ projectRole: event.target.value })} placeholder='e.g. Resident Engineer' />
          </div>
          <label className='flex items-center gap-2 text-sm sm:col-span-2'>
            <Switch checked={form.isPrimaryReviewer} onCheckedChange={(checked) => set({ isPrimaryReviewer: checked })} />
            Primary reviewer — can issue the company’s responses and reassign its reviews
          </label>
          <div className='space-y-1.5 sm:col-span-2'>
            <Label>Access template</Label>
            <Select value={form.templateKey} onValueChange={(templateKey) => set({ templateKey })}>
              <SelectTrigger data-testid='uat-invite-template'><SelectValue /></SelectTrigger>
              <SelectContent>{overview.templates.map((row) => <SelectItem key={row.key} value={row.key}>{row.name}</SelectItem>)}</SelectContent>
            </Select>
            {template && <p className='text-xs text-muted-foreground'>{template.description}</p>}
          </div>
          <div className='space-y-2 sm:col-span-2'>
            <Button type='button' size='sm' variant='outline' onClick={() => setCustomise((value) => !value)} data-testid='uat-invite-customise'>{customise ? 'Hide access' : 'Customize Access'}</Button>
            {customise && access && <AccessEditor overview={overview} value={access} onChange={setAccess} />}
          </div>
          <div className='space-y-1.5 sm:col-span-2'>
            <Label htmlFor='consultant-notes'>Notes (in the invitation)</Label>
            <Textarea id='consultant-notes' rows={2} value={form.notes} onChange={(event) => set({ notes: event.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || invite.isPending} onClick={async () => {
            try {
              const result = await invite.mutateAsync({ ...form, companyName: form.companyName.trim(), email: form.email.trim(), access: customise ? access : null })
              toast.success(`Invitation sent to ${result.invitation.email} (${result.party.name}, ${result.access.template}${result.access.customised ? ', customised' : ''})`)
              onClose()
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }} data-testid='uat-invite-send'>
            {invite.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Mail className='h-4 w-4' />} Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditAccessDialog({ projectId, overview, member, onClose }: { projectId: string; overview: ConsultantsOverview; member: ConsultantsOverview['parties'][number]['members'][number] | null; onClose: () => void }) {
  const save = useSetConsultantAccess(projectId)
  const [templateKey, setTemplateKey] = useState('lead')
  const [access, setAccess] = useState<AccessSelection | null>(null)
  const [primary, setPrimary] = useState(false)
  useEffect(() => {
    if (!member) return
    setTemplateKey(member.access.templateKey || 'read_only')
    setAccess(member.access.selection || overview.templates.find((row) => row.key === (member.access.templateKey || 'read_only'))?.selection || null)
    setPrimary(member.isPrimaryReviewer)
  }, [member, overview])
  if (!member || !access) return null
  return (
    <Dialog open onOpenChange={(value) => !value && !save.isPending && onClose()}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-2xl' data-testid='uat-consultant-access'>
        <DialogHeader>
          <DialogTitle>Access — {member.name}</DialogTitle>
          <DialogDescription>Decided on the server for every request. Changes apply on their next action and are kept in the audit.</DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label>Access template</Label>
            <Select value={templateKey} onValueChange={(key) => { setTemplateKey(key); setAccess(overview.templates.find((row) => row.key === key)?.selection || access) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{overview.templates.map((row) => <SelectItem key={row.key} value={row.key}>{row.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <AccessEditor overview={overview} value={access} onChange={setAccess} />
          <label className='flex items-center gap-2 text-sm'><Switch checked={primary} onCheckedChange={setPrimary} /> Primary reviewer of their company</label>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={async () => {
            try {
              await save.mutateAsync({ userId: member.userId, templateKey, access, isPrimaryReviewer: primary })
              toast.success('Access saved')
              onClose()
            } catch (error) {
              toast.error(getServerErrorMessage(error))
            }
          }}>{save.isPending && <Loader2 className='h-4 w-4 animate-spin' />} Save access</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Project → Consultants: the consultant companies, their people and access, pending invitations, Invite Consultant. */
export function ConsultantsPanel({ projectId, inviteOpen, onInviteOpenChange }: { projectId: string; inviteOpen: boolean; onInviteOpenChange: (open: boolean) => void }) {
  const { data, isLoading } = useConsultants(projectId)
  const canInvite = useCanPerform('external_review', 'update', 'external_review.invite')
  const [editing, setEditing] = useState<ConsultantsOverview['parties'][number]['members'][number] | null>(null)
  if (isLoading || !data) return <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' /> Loading consultants…</p>
  return (
    <div className='space-y-3' data-testid='uat-consultants-panel'>
      {canInvite && (
        <div className='flex justify-end'>
          <Button size='sm' onClick={() => onInviteOpenChange(true)} data-testid='uat-invite-consultant-button'><UserPlus className='h-4 w-4' /> Invite Consultant</Button>
        </div>
      )}
      {!data.parties.length && <p className='rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground'>No consultant on this project yet.</p>}
      {data.parties.map((party) => (
        <section key={party.id} className='rounded-md border'>
          <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
            <h3 className='text-sm font-semibold'>{party.name}</h3>
            <span className='rounded bg-muted px-1.5 py-0.5 text-[11px]'>{party.disciplineLabel}</span>
            {party.status !== 'active' && <span className='text-xs text-destructive'>{party.status}</span>}
          </div>
          <table className='w-full text-sm'>
            <tbody>
              {party.members.map((member) => (
                <tr key={member.userId} className={cn('border-t first:border-t-0', member.status !== 'active' && 'opacity-60')}>
                  <td className='px-3 py-1.5'>
                    <p className='font-medium'>{member.name} {member.isPrimaryReviewer && <Star className='inline h-3.5 w-3.5 fill-amber-400 text-amber-500' aria-label='Primary reviewer' />}</p>
                    <p className='text-xs text-muted-foreground'>{[member.jobTitle, member.projectRole, member.email].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className='px-3 py-1.5 text-xs'>{member.status === 'active' ? `Joined ${formatDay(member.acceptedAt)}` : member.status}</td>
                  <td className='px-3 py-1.5 text-xs'>
                    <p>{member.access.template}{member.access.customised ? ' · customised' : ''}</p>
                    <p className='text-muted-foreground'>Reviews: {member.access.selection?.reviews.map((type) => REVIEW_LABEL[type] || type).join(', ') || 'none'}</p>
                  </td>
                  <td className='px-3 py-1.5 text-right'>{canInvite && member.status === 'active' && <Button size='sm' variant='ghost' className='h-7 text-xs' onClick={() => setEditing(member)} data-testid='uat-consultant-edit-access'>Access…</Button>}</td>
                </tr>
              ))}
              {party.pendingInvitations.map((invitation) => (
                <tr key={invitation.id} className='border-t bg-muted/20'>
                  <td className='px-3 py-1.5'>
                    <p className='font-medium'>{invitation.contactName || invitation.email}</p>
                    <p className='text-xs text-muted-foreground'>{[invitation.jobTitle, invitation.email].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className='px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400'>Invited {formatDay(invitation.invitedAt)} · awaiting acceptance</td>
                  <td className='px-3 py-1.5 text-xs'>{invitation.template || '—'}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <InviteDialog projectId={projectId} overview={data} open={inviteOpen} onClose={() => onInviteOpenChange(false)} />
      <EditAccessDialog projectId={projectId} overview={data} member={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
