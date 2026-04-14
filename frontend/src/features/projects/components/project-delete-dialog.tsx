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
          <AlertDialogTitle>Delete {project?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The project and all linked planning
            context may become unavailable.
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
