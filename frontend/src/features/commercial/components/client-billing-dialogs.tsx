import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABEL,
  useRecordAdvance,
  useUpdatePrimeContract,
  type ContractType,
  type PrimeContract,
} from '../hooks/use-prime-contract'

/** A percentage field, with what it means underneath rather than in a tooltip. */
function RateField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div className='relative'>
        <Input
          id={id}
          inputMode='decimal'
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className='pe-7'
          data-testid={`uat-contract-${id}`}
        />
        <span className='absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground'>
          %
        </span>
      </div>
      <p className='text-[11px] text-muted-foreground'>{hint}</p>
    </div>
  )
}

/**
 * The dialog only mounts its body while it is open, so the form starts from
 * what is stored every time — no effect resetting state behind the user, and
 * nothing typed and abandoned survives to the next open.
 */
export function ContractTermsDialog({
  projectId,
  contract,
  open,
  onOpenChange,
}: {
  projectId: string
  contract: PrimeContract
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ContractTermsForm
          projectId={projectId}
          contract={contract}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function ContractTermsForm({
  projectId,
  contract,
  onDone,
}: {
  projectId: string
  contract: PrimeContract
  onDone: () => void
}) {
  const update = useUpdatePrimeContract(projectId)
  const [form, setForm] = useState(() => toForm(contract))

  const set = (patch: Partial<ReturnType<typeof toForm>>) =>
    setForm((current) => ({ ...current, ...patch }))

  const submit = () => {
    update.mutate(
      {
        title: form.title.trim(),
        contractType: form.contractType,
        originalValue: Number(form.originalValue) || 0,
        retentionRate: Number(form.retentionRate) || 0,
        retentionCapRate: form.retentionCapRate === '' ? null : Number(form.retentionCapRate),
        advanceRate: Number(form.advanceRate) || 0,
        advanceRecoveryRate: Number(form.advanceRecoveryRate) || 0,
        materialsOnSiteRate: Number(form.materialsOnSiteRate) || 0,
        taxRate: Number(form.taxRate) || 0,
        paymentTermsDays: Number(form.paymentTermsDays) || 0,
        notes: form.notes.trim() || null,
      } as Partial<PrimeContract>,
      {
        onSuccess: () => {
          toast.success('Contract terms saved')
          onDone()
        },
        onError: (error) => toast.error(getServerErrorMessage(error)),
      }
    )
  }

  return (
    <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='font-display'>Contract terms</DialogTitle>
          <DialogDescription>
            Entered once here. Every certificate, the forecast and the cash flow read
            these — approved change orders move the value by themselves.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='contract-title'>Title</Label>
              <Input
                id='contract-title'
                value={form.title}
                onChange={(event) => set({ title: event.target.value })}
              />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='contract-type'>Contract type</Label>
              <Select
                value={form.contractType}
                onValueChange={(value) => set({ contractType: value as ContractType })}
              >
                <SelectTrigger id='contract-type'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {CONTRACT_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='contract-value'>Original contract value</Label>
              <Input
                id='contract-value'
                inputMode='decimal'
                value={form.originalValue}
                onChange={(event) => set({ originalValue: event.target.value })}
                data-testid='uat-contract-original-value'
              />
              <p className='text-[11px] text-muted-foreground'>
                Approved change orders are added on top; they are never typed here.
              </p>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='contract-terms-days'>Payment terms</Label>
              <div className='relative'>
                <Input
                  id='contract-terms-days'
                  inputMode='numeric'
                  value={form.paymentTermsDays}
                  onChange={(event) => set({ paymentTermsDays: event.target.value })}
                  className='pe-14'
                />
                <span className='absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground'>
                  days
                </span>
              </div>
              <p className='text-[11px] text-muted-foreground'>
                Used to age an invoice that carries no due date of its own.
              </p>
            </div>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <RateField
              id='retention'
              label='Retention'
              hint='Held back from each certificate.'
              value={form.retentionRate}
              onChange={(retentionRate) => set({ retentionRate })}
            />
            <RateField
              id='retention-cap'
              label='Retention cap'
              hint='Retention stops at this share of the contract. Leave empty for no cap.'
              value={form.retentionCapRate}
              onChange={(retentionCapRate) => set({ retentionCapRate })}
            />
            <RateField
              id='advance'
              label='Advance payment'
              hint='Percentage of the contract paid up front.'
              value={form.advanceRate}
              onChange={(advanceRate) => set({ advanceRate })}
            />
            <RateField
              id='advance-recovery'
              label='Advance recovery'
              hint='Share of each gross certificate withheld to pay the advance back.'
              value={form.advanceRecoveryRate}
              onChange={(advanceRecoveryRate) => set({ advanceRecoveryRate })}
            />
            <RateField
              id='materials'
              label='Stored materials'
              hint='Share of delivered-but-uninstalled material that may be certified.'
              value={form.materialsOnSiteRate}
              onChange={(materialsOnSiteRate) => set({ materialsOnSiteRate })}
            />
            <RateField
              id='tax'
              label='Tax'
              hint='Applied after retention, advance recovery and deductions.'
              value={form.taxRate}
              onChange={(taxRate) => set({ taxRate })}
            />
          </div>

          <div className='grid gap-1.5'>
            <Label htmlFor='contract-notes'>Notes</Label>
            <Textarea
              id='contract-notes'
              rows={3}
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />
          </div>
        </div>

      <DialogFooter>
        <Button variant='outline' onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={update.isPending}
          data-testid='uat-contract-save'
        >
          {update.isPending && <Loader2 className='me-1.5 size-4 animate-spin' />}
          Save terms
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

const toForm = (contract: PrimeContract) => ({
  title: contract.title,
  contractType: contract.contractType,
  originalValue: String(contract.originalValue),
  retentionRate: String(contract.retentionRate),
  retentionCapRate: contract.retentionCapRate == null ? '' : String(contract.retentionCapRate),
  advanceRate: String(contract.advanceRate),
  advanceRecoveryRate: String(contract.advanceRecoveryRate),
  materialsOnSiteRate: String(contract.materialsOnSiteRate),
  taxRate: String(contract.taxRate),
  paymentTermsDays: String(contract.paymentTermsDays),
  notes: contract.notes ?? '',
})

export function RecordAdvanceDialog({
  projectId,
  contract,
  open,
  onOpenChange,
}: {
  projectId: string
  contract: PrimeContract
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <RecordAdvanceForm
          projectId={projectId}
          contract={contract}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function RecordAdvanceForm({
  projectId,
  contract,
  onDone,
}: {
  projectId: string
  contract: PrimeContract
  onDone: () => void
}) {
  const record = useRecordAdvance(projectId)
  const remaining = Math.max(0, contract.advanceAmount - contract.advancePaidAmount)
  const [amount, setAmount] = useState(String(remaining))
  const [note, setNote] = useState('')

  return (
    <DialogContent>
        <DialogHeader>
          <DialogTitle className='font-display'>Record an advance payment</DialogTitle>
          <DialogDescription>
            The advance agreed is {contract.advanceAmount.toLocaleString()}, of which{' '}
            {contract.advancePaidAmount.toLocaleString()} has been received. Each
            certificate then recovers {contract.advanceRecoveryRate}% of its gross until
            it is repaid.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4'>
          <div className='grid gap-1.5'>
            <Label htmlFor='advance-amount'>Amount received</Label>
            <Input
              id='advance-amount'
              inputMode='decimal'
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid='uat-advance-amount'
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='advance-note'>Note</Label>
            <Input
              id='advance-note'
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder='Bank reference, date received'
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!Number(amount) || record.isPending}
            onClick={() =>
              record.mutate(
                { amount: Number(amount), note: note.trim() || undefined },
                {
                  onSuccess: () => {
                    toast.success('Advance recorded')
                    onDone()
                  },
                  onError: (error) => toast.error(getServerErrorMessage(error)),
                }
              )
            }
            data-testid='uat-advance-save'
          >
            {record.isPending && <Loader2 className='me-1.5 size-4 animate-spin' />}
            Record
          </Button>
        </DialogFooter>
    </DialogContent>
  )
}
