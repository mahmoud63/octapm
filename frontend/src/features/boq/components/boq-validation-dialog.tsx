import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertTriangle } from 'lucide-react'

interface ValidationError {
  row?: number
  field?: string
  message: string
}

interface BoqValidationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  errors: ValidationError[]
}

export function BoqValidationDialog({
  open,
  onOpenChange,
  errors,
}: BoqValidationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2 text-destructive'>
            <AlertTriangle className='h-5 w-5' />
            Validation Errors
          </DialogTitle>
          <DialogDescription>
            Fix these errors in your Excel file and re-upload.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-80'>
          <div className='space-y-2 pr-2'>
            {errors.map((err, i) => (
              <div
                key={i}
                className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm'
              >
                {err.row && (
                  <span className='mr-2 font-medium text-muted-foreground'>
                    Row {err.row}
                    {err.field ? ` · ${err.field}` : ''}:
                  </span>
                )}
                <span>{err.message}</span>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
