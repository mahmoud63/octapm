import { Main } from '@/components/layout/main'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { TasksDialogs } from './components/tasks-dialogs'
import { TasksPrimaryButtons } from './components/tasks-primary-buttons'
import { TasksProvider } from './components/tasks-provider'
import { TasksTable } from './components/tasks-table'
import { useTasksQuery } from './hooks/use-tasks'

export function Tasks() {
  const { data, isError, isLoading } = useTasksQuery({
    sortBy: 'due',
    sortDir: 'asc',
  })
  const tasks = data?.rows ?? []

  return (
    <TasksProvider>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Tasks</h2>
            <p className='text-muted-foreground'>
              Assigned project actions, due dates, comments, and closeout.
            </p>
          </div>
          <TasksPrimaryButtons />
        </div>
        {data && (
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <div className='rounded-md border px-4 py-3'>
              <p className='text-sm text-muted-foreground'>Open tasks</p>
              <p className='text-2xl font-semibold'>{data.summary.open}</p>
            </div>
            <div className='rounded-md border px-4 py-3'>
              <p className='text-sm text-muted-foreground'>Overdue</p>
              <p className='text-2xl font-semibold text-destructive'>
                {data.summary.overdue}
              </p>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className='space-y-3'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-80 w-full' />
          </div>
        ) : isError ? (
          <Alert variant='destructive'>
            <AlertTitle>Tasks unavailable</AlertTitle>
            <AlertDescription>
              The task workflow could not be loaded. Check your project access
              or try again.
            </AlertDescription>
          </Alert>
        ) : (
          <TasksTable data={tasks} />
        )}
      </Main>

      <TasksDialogs />
    </TasksProvider>
  )
}
