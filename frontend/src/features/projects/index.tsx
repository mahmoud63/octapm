import { Main } from '@/components/layout/main'
import { ProjectsList } from './components/projects-list'

export function Projects() {
  return (
    <>
      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <ProjectsList />
      </Main>
    </>
  )
}
