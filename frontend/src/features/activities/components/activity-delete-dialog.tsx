import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Activity } from '../data/schema'

type ActivityDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activity: Activity | null
  onConfirm: () => void
  isDeleting?: boolean
}

export function ActivityDeleteDialog({
  open,
  onOpenChange,
  activity,
  onConfirm,
  isDeleting = false,
}: ActivityDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {activity?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Activity-linked updates may be removed
            from active planning workflows.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
