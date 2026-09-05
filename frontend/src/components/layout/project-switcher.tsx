import * as React from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Check, ChevronsUpDown, FolderKanban, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useProjects } from '@/features/projects/hooks/use-projects'

const statusLabel = (status: string | null | undefined) =>
  status ? status.replace(/_/g, ' ') : ''

/**
 * Header project picker: shows the project currently open (from the route)
 * and lets the user jump to any other project they can access.
 */
export function ProjectSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { projectId?: string }
  const currentProjectId = params.projectId
  const { data, isLoading } = useProjects()
  const [open, setOpen] = React.useState(false)

  const projects = React.useMemo(() => data?.items ?? [], [data?.items])
  const current = projects.find((project) => project.id === currentProjectId)

  const select = (projectId: string) => {
    setOpen(false)
    if (projectId === currentProjectId) return
    navigate({
      to: '/projects/$projectId',
      params: { projectId },
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          role='combobox'
          aria-expanded={open}
          aria-label='Switch project'
          data-testid='project-switcher'
          className={cn(
            'h-8 max-w-56 justify-between gap-2 px-2.5 font-medium',
            className
          )}
        >
          <FolderKanban className='size-4 shrink-0 text-muted-foreground' />
          <span className='truncate'>
            {current
              ? current.name
              : currentProjectId
                ? 'Loading project…'
                : 'Select project'}
          </span>
          <ChevronsUpDown className='size-3.5 shrink-0 opacity-60' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-72 p-0'>
        <Command>
          <CommandInput placeholder='Find a project…' />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading projects…' : 'No projects found.'}
            </CommandEmpty>
            <CommandGroup heading='Projects'>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.name} ${project.status ?? ''}`}
                  onSelect={() => select(project.id)}
                  className='gap-2'
                >
                  <Check
                    className={cn(
                      'size-4 shrink-0',
                      project.id === currentProjectId
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  <span className='min-w-0 flex-1 truncate'>
                    {project.name}
                  </span>
                  {project.status && (
                    <span className='shrink-0 text-[11px] text-muted-foreground capitalize'>
                      {statusLabel(project.status)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem asChild value='all projects'>
                <Link to='/projects' onClick={() => setOpen(false)}>
                  <FolderKanban className='size-4' />
                  All projects
                </Link>
              </CommandItem>
              <CommandItem asChild value='new project'>
                <Link to='/projects' onClick={() => setOpen(false)}>
                  <Plus className='size-4' />
                  New project
                </Link>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
