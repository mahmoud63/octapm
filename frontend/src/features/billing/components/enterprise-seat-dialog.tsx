import { useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useEnterpriseLead } from '../hooks/use-billing'

type Band = 'lte_100' | 'gt_100'

export function EnterpriseSeatDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [band, setBand] = useState<Band>('lte_100')
  const lead = useEnterpriseLead()

  const submit = () =>
    lead.mutate(band, {
      onSuccess: () => {
        toast.success('Thanks — our sales team will contact you within one business day.')
        onOpenChange(false)
      },
      onError: () => toast.error('Could not submit. Please try again.'),
    })

  const options: { value: Band; title: string; sub: string }[] = [
    { value: 'lte_100', title: '100 seats or fewer', sub: 'Standard enterprise management and SSO.' },
    { value: 'gt_100', title: 'More than 100 seats', sub: 'Volume licensing and multi-department governance.' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enterprise Seat Configuration</DialogTitle>
          <DialogDescription>
            Select your team's scale to unlock dedicated resources and custom governance.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          {options.map((o) => (
            <button
              key={o.value}
              type='button'
              onClick={() => setBand(o.value)}
              className={`w-full rounded-lg border p-4 text-left transition ${
                band === o.value ? 'border-primary ring-primary/30 ring-2' : 'border-border'
              }`}
            >
              <div className='font-medium'>{o.title}</div>
              <div className='text-muted-foreground text-sm'>{o.sub}</div>
            </button>
          ))}
        </div>
        <Button onClick={submit} disabled={lead.isPending}>
          {lead.isPending ? 'Submitting…' : 'Contact Sales'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
