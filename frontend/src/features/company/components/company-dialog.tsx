import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateCompany,
  useUpdateCompany,
  type CompanyDirectoryEntry,
} from '../hooks/use-company'

/**
 * A company in the directory, entered once (Phase 22B).
 *
 * Owners, consultants, contractors and vendors all live here; the parties,
 * bids, commitments and supplier invoices of every project reference these
 * rows rather than retyping a name. Vendors keep their own page for trades,
 * payment terms and prequalification.
 */
const COMPANY_TYPES = [
  ['external', 'External'],
  ['owner', 'Owner / client'],
  ['consultant', 'Consultant'],
  ['contractor', 'Contractor'],
  ['subcontractor', 'Subcontractor'],
  ['supplier', 'Supplier'],
] as const

type Draft = {
  name: string
  tradeName: string
  type: string
  email: string
  phone: string
  website: string
  address: string
  status: 'active' | 'inactive'
}

const emptyDraft = (): Draft => ({
  name: '',
  tradeName: '',
  type: 'external',
  email: '',
  phone: '',
  website: '',
  address: '',
  status: 'active',
})

const draftFrom = (company: CompanyDirectoryEntry | null): Draft =>
  company
    ? {
        name: company.name,
        tradeName: company.tradeName || '',
        type: company.type || 'external',
        email: company.email || '',
        phone: company.phone || '',
        website: company.website || '',
        address: company.address || '',
        status: company.status,
      }
    : emptyDraft()

export function CompanyDialog({
  open,
  company,
  onOpenChange,
}: {
  open: boolean
  /** The company being edited; null creates one. */
  company: CompanyDirectoryEntry | null
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateCompany()
  const update = useUpdateCompany()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(company))
  // a different company (or a fresh create) resets the form when the dialog opens
  const [seenFor, setSeenFor] = useState<string | null>(company?.id ?? null)
  const key = open ? (company?.id ?? '__new__') : null
  useEffect(() => {
    if (key && key !== seenFor) {
      setSeenFor(key)
      setDraft(draftFrom(company))
    }
  }, [key, seenFor, company])

  const busy = create.isPending || update.isPending
  const set = (field: keyof Draft, value: string) =>
    setDraft((prev) => ({ ...prev, [field]: value }))

  const submit = async () => {
    const payload = {
      name: draft.name.trim(),
      tradeName: draft.tradeName.trim() || null,
      type: draft.type,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      website: draft.website.trim() || null,
      address: draft.address.trim() || null,
      status: draft.status,
    }
    try {
      if (company) {
        await update.mutateAsync({ companyId: company.id, payload })
        toast.success(`${payload.name} updated.`)
      } else {
        await create.mutateAsync(payload)
        toast.success(`${payload.name} added to the directory.`)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[90vh] overflow-y-auto sm:max-w-xl'
        data-testid='uat-company-dialog'
      >
        <DialogHeader>
          <DialogTitle>{company ? `Edit ${company.name}` : 'Add a company'}</DialogTitle>
          <DialogDescription>
            {company
              ? 'Parties, bids and commitments that name this company keep their link.'
              : 'Entered once here, then picked everywhere a company is named.'}
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='company-name'>Name</Label>
            <Input
              id='company-name'
              value={draft.name}
              placeholder='Meridian Consulting Engineers'
              onChange={(e) => set('name', e.target.value)}
              data-testid='uat-company-name'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='company-trade-name'>Trade name</Label>
            <Input
              id='company-trade-name'
              value={draft.tradeName}
              onChange={(e) => set('tradeName', e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label>Type</Label>
            <Select value={draft.type} onValueChange={(value) => set('type', value)}>
              <SelectTrigger data-testid='uat-company-type'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPANY_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='company-email'>Email</Label>
            <Input
              id='company-email'
              type='email'
              value={draft.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='company-phone'>Phone</Label>
            <Input
              id='company-phone'
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='company-website'>Website</Label>
            <Input
              id='company-website'
              value={draft.website}
              onChange={(e) => set('website', e.target.value)}
            />
          </div>
          <div className='space-y-1 sm:col-span-2'>
            <Label htmlFor='company-address'>Address</Label>
            <Textarea
              id='company-address'
              rows={2}
              value={draft.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>
          <div className='flex items-center gap-2 sm:col-span-2'>
            <Switch
              id='company-active'
              checked={draft.status === 'active'}
              onCheckedChange={(checked) => set('status', checked ? 'active' : 'inactive')}
            />
            <Label htmlFor='company-active'>
              {draft.status === 'active'
                ? 'Active — can be picked on projects'
                : 'Inactive — kept for history, not offered on new records'}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !draft.name.trim()}
            data-testid='uat-company-save'
          >
            {busy ? 'Saving…' : company ? 'Save changes' : 'Add company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
