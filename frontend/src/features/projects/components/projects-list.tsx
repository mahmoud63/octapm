import { useState } from 'react'
import { AxiosError } from 'axios'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Project } from '../data/schema'
import { useDeleteProject, useProjects } from '../hooks/use-projects'
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
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)
  const navigate = useNavigate()
  const deleteProject = useDeleteProject()

  const { data, isLoading } = useProjects()
  const projects = data?.items ?? []

  const onDelete = async () => {
    if (!deletingProject) {
      return
    }

    try {
      await deleteProject.mutateAsync(deletingProject.id)
      toast.success('Project deleted successfully.')
      setDeletingProject(null)
    } catch (error) {
      if (error instanceof AxiosError) {
        const errorData = error.response?.data as
          | { error?: { message?: string } }
          | undefined

        toast.error(errorData?.error?.message ?? 'Failed to delete project')
        return
      }

      toast.error('Failed to delete project')
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
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Projects</h2>
          <p className='text-muted-foreground'>
            Manage portfolio projects and open details.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>+ New Project</Button>
      </div>

      {projects.length === 0 ? (
        <div className='mt-4 flex flex-col items-center justify-center rounded-md border py-20 text-center'>
          <FolderOpen className='mb-3 h-10 w-10 text-muted-foreground' />
          <p className='mb-4 text-muted-foreground'>No projects yet.</p>
          <Button onClick={() => setCreateOpen(true)}>+ Create Project</Button>
        </div>
      ) : (
        <div className='mt-4 overflow-hidden rounded-md border'>
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
                        onClick={() => setEditingProject(project)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant='ghost'
                        size='sm'
                        className='text-destructive hover:text-destructive'
                        onClick={() => setDeletingProject(project)}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
        open={Boolean(deletingProject)}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingProject(null)
          }
        }}
        project={deletingProject}
        onConfirm={onDelete}
        isDeleting={deleteProject.isPending}
      />
    </>
  )
}
