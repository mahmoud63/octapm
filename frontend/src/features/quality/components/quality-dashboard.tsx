import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useCreateDefect,
  useCreateItp,
  useCreateMaterialTest,
  useCreateNcr,
  useCreateSafetyIncident,
  useDefects,
  useItps,
  useMaterialTests,
  useNcrs,
  useQualityDashboard,
  useSafetyIncidents,
} from '../hooks/use-quality'

export function QualityDashboard({
  projectId,
  activeTab,
  onTabChange,
  showTabList = true,
}: {
  projectId: string
  activeTab?: string
  onTabChange?: (value: string) => void
  showTabList?: boolean
}) {
  const { data: dashboard } = useQualityDashboard(projectId)
  const { data: ncrs } = useNcrs(projectId)
  const { data: itps } = useItps(projectId)
  const { data: defects } = useDefects(projectId)
  const { data: safety } = useSafetyIncidents(projectId)
  const { data: tests } = useMaterialTests(projectId)

  const createNcr = useCreateNcr(projectId)
  const createItp = useCreateItp(projectId)
  const createDefect = useCreateDefect(projectId)
  const createSafety = useCreateSafetyIncident(projectId)
  const createTest = useCreateMaterialTest(projectId)

  const [ncrDescription, setNcrDescription] = useState('')
  const [itpTitle, setItpTitle] = useState('')
  const [defectTitle, setDefectTitle] = useState('')
  const [safetyTitle, setSafetyTitle] = useState('')
  const [testType, setTestType] = useState('')

  const metrics = dashboard?.metrics

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'ncr' }

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Quality Score</p>
          <p className='text-2xl font-bold'>{metrics?.qualityScore ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Major NCR</p>
          <p className='text-2xl font-bold'>{metrics?.majorNcrs ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Failed ITP</p>
          <p className='text-2xl font-bold'>{metrics?.failedItps ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Open Defects</p>
          <p className='text-2xl font-bold'>{metrics?.openDefects ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Safety Open</p>
          <p className='text-2xl font-bold'>{metrics?.safetyOpen ?? 0}</p>
        </div>
      </div>

      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='ncr'>NCR</TabsTrigger>
            <TabsTrigger value='itp'>ITP</TabsTrigger>
            <TabsTrigger value='defects'>Defects</TabsTrigger>
            <TabsTrigger value='safety'>Safety</TabsTrigger>
            <TabsTrigger value='tests'>Material Tests</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='ncr' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='New NCR description'
              value={ncrDescription}
              onChange={(e) => setNcrDescription(e.target.value)}
            />
            <Button
              disabled={createNcr.isPending || !ncrDescription}
              onClick={async () => {
                try {
                  await createNcr.mutateAsync({ description: ncrDescription })
                  setNcrDescription('')
                  toast.success('NCR created')
                } catch {
                  toast.error('Failed to create NCR')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {ncrs?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> -{' '}
                {row.description || 'No description'} ({row.severity}/
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='itp' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='ITP title'
              value={itpTitle}
              onChange={(e) => setItpTitle(e.target.value)}
            />
            <Button
              disabled={createItp.isPending || !itpTitle}
              onClick={async () => {
                try {
                  await createItp.mutateAsync({ title: itpTitle })
                  setItpTitle('')
                  toast.success('ITP created')
                } catch {
                  toast.error('Failed to create ITP')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {itps?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.title} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='defects' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Defect title'
              value={defectTitle}
              onChange={(e) => setDefectTitle(e.target.value)}
            />
            <Button
              disabled={createDefect.isPending || !defectTitle}
              onClick={async () => {
                try {
                  await createDefect.mutateAsync({ title: defectTitle })
                  setDefectTitle('')
                  toast.success('Defect created')
                } catch {
                  toast.error('Failed to create defect')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {defects?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.title} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='safety' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Incident title'
              value={safetyTitle}
              onChange={(e) => setSafetyTitle(e.target.value)}
            />
            <Button
              disabled={createSafety.isPending || !safetyTitle}
              onClick={async () => {
                try {
                  await createSafety.mutateAsync({
                    title: safetyTitle,
                    incidentType: 'near_miss',
                  })
                  setSafetyTitle('')
                  toast.success('Incident logged')
                } catch {
                  toast.error('Failed to log incident')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {safety?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.title} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='tests' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Test type'
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
            />
            <Button
              disabled={createTest.isPending || !testType}
              onClick={async () => {
                try {
                  await createTest.mutateAsync({ testType })
                  setTestType('')
                  toast.success('Material test logged')
                } catch {
                  toast.error('Failed to create test')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {tests?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.testType}{' '}
                ({row.result})
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  )
}
