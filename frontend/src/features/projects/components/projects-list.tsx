import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import { useSubscription } from '@/features/billing/hooks/use-billing'
import type { Project } from '../data/schema'
import { useArchiveProject, useProjects } from '../hooks/use-projects'
import { ProjectCreateDialog } from './project-create-dialog'
import { ProjectDeleteDialog } from './project-delete-dialog'
import { ProjectEditDialog } from './project-edit-dialog'
import { ProjectStatusBadge } from './project-status-badge'

const formatDate = (value: string | null) => {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleDateString()
}

const formatMoney = (value: number | null, currency: string) => {
  if (value === null) {
    return '-'
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function ProjectsList() {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [archivingProject, setArchivingProject] = useState<Project | null>(null)
  const navigate = useNavigate()
  const archiveProject = useArchiveProject()

  const { data, isLoading } = useProjects()
  const { data: subscription } = useSubscription()
  const subscriptionAllowsWrites = subscription?.hasAccess !== false
  const projects = data?.items ?? []

  const onArchive = async () => {
    if (!archivingProject) {
      return
    }

    try {
      await archiveProject.mutateAsync(archivingProject.id)
      toast.success('Project archived successfully.')
      setArchivingProject(null)
    } catch (error) {
      toast.error(getServerErrorMessage(error, 'Failed to archive project'))
    }
  }

  if (isLoading) {
    return (
      <div className='py-12 text-center text-muted-foreground'>
        Loading projects...
      </div>
    )
  }

  return (
    <>
      <div data-testid='uat-projects-page' className='space-y-4'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Projects</h2>
            <p className='text-muted-foreground'>
              Manage portfolio projects and open details.
            </p>
          </div>
          <Button
            disabled={!subscriptionAllowsWrites}
            title={
              subscriptionAllowsWrites
                ? undefined
                : 'Subscribe to continue changing projects.'
            }
            onClick={() => setCreateOpen(true)}
          >
            + New Project
          </Button>
        </div>

        {projects.length === 0 ? (
          <div className='flex flex-col items-center justify-center rounded-md border py-20 text-center'>
            <FolderOpen className='mb-3 h-10 w-10 text-muted-foreground' />
            <p className='mb-4 text-muted-foreground'>No projects yet.</p>
            <Button
              disabled={!subscriptionAllowsWrites}
              title={
                subscriptionAllowsWrites
                  ? undefined
                  : 'Subscribe to continue changing projects.'
              }
              onClick={() => setCreateOpen(true)}
            >
              + Create Project
            </Button>
          </div>
        ) : (
          <div className='overflow-hidden rounded-md border'>
            <table className='w-full text-sm'>
              <thead className='border-b bg-muted/50'>
                <tr>
                  <th className='p-3 text-left font-medium'>Name</th>
                  <th className='p-3 text-left font-medium'>Start Date</th>
                  <th className='p-3 text-left font-medium'>End Date</th>
                  <th className='p-3 text-left font-medium'>Status</th>
                  <th className='p-3 text-left font-medium'>Contract Value</th>
                  <th className='p-3 text-left font-medium'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className='border-b hover:bg-muted/25'>
                    <td className='p-3 font-medium'>{project.name}</td>
                    <td className='p-3 text-muted-foreground'>
                      {formatDate(project.startDate)}
                    </td>
                    <td className='p-3 text-muted-foreground'>
                      {formatDate(project.endDate)}
                    </td>
                    <td className='p-3'>
                      <ProjectStatusBadge status={project.status} />
                    </td>
                    <td className='p-3 text-muted-foreground'>
                      {formatMoney(project.contractValue, project.currency)}
                    </td>
                    <td className='p-3'>
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() =>
                            navigate({
                              to: '/projects/$projectId',
                              params: { projectId: project.id },
                            })
                          }
                        >
                          View
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          disabled={!subscriptionAllowsWrites}
                          onClick={() => setEditingProject(project)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='text-destructive hover:text-destructive'
                          disabled={!subscriptionAllowsWrites}
                          onClick={() => setArchivingProject(project)}
                        >
                          Archive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProjectCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ProjectEditDialog
        open={Boolean(editingProject)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProject(null)
          }
        }}
        project={editingProject}
      />
      <ProjectDeleteDialog
        open={Boolean(archivingProject)}
        onOpenChange={(open) => {
          if (!open) {
            setArchivingProject(null)
          }
        }}
        project={archivingProject}
        onConfirm={onArchive}
        isDeleting={archiveProject.isPending}
      />
    </>
  )
}
