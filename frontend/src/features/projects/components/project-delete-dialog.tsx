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
import type { Project } from '../data/schema'

type ProjectDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
  onConfirm: () => void
  isDeleting?: boolean
}

export function ProjectDeleteDialog({
  open,
  onOpenChange,
  project,
  onConfirm,
  isDeleting = false,
}: ProjectDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {project?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The project will be hidden from active lists, but its linked
            planning, cost, and workflow history will be retained.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className='text-destructive-foreground bg-destructive hover:bg-destructive/90'
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? 'Archiving...' : 'Archive'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
