import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'

/** Wide variant of the settings ContentSection for tables. */
export function CompanySection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className='flex flex-1 flex-col'>
      <div className='flex flex-none flex-wrap items-start justify-between gap-2'>
        <div>
          <h3 className='text-lg font-medium'>{title}</h3>
          <p className='text-sm text-muted-foreground'>{description}</p>
        </div>
        {actions}
      </div>
      <Separator className='my-4 flex-none' />
      <div className='faded-bottom h-full w-full overflow-y-auto scroll-smooth pe-4 pb-12'>
        <div className='-mx-1 px-1.5'>{children}</div>
      </div>
    </div>
  )
}
