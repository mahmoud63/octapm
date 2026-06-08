import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useCorrespondence,
  useCreateCorrespondence,
  useCreateDrawing,
  useCreateRfi,
  useCreateSubmittal,
  useCreateTransmittal,
  useDocControlDashboard,
  useDrawings,
  useRfis,
  useSubmittals,
  useTransmittals,
} from '../hooks/use-doc-control'

export function DocControlDashboard({
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
  const { data: dashboard } = useDocControlDashboard(projectId)
  const { data: rfis } = useRfis(projectId)
  const { data: submittals } = useSubmittals(projectId)
  const { data: drawings } = useDrawings(projectId)
  const { data: transmittals } = useTransmittals(projectId)
  const { data: correspondence } = useCorrespondence(projectId)

  const createRfi = useCreateRfi(projectId)
  const createSubmittal = useCreateSubmittal(projectId)
  const createDrawing = useCreateDrawing(projectId)
  const createTransmittal = useCreateTransmittal(projectId)
  const createCorrespondence = useCreateCorrespondence(projectId)

  const [rfiSubject, setRfiSubject] = useState('')
  const [submittalTitle, setSubmittalTitle] = useState('')
  const [drawingNumber, setDrawingNumber] = useState('')
  const [drawingTitle, setDrawingTitle] = useState('')
  const [transmittalSubject, setTransmittalSubject] = useState('')
  const [correspondenceSubject, setCorrespondenceSubject] = useState('')

  const metrics = dashboard?.metrics

  const tabsProps =
    activeTab !== undefined
      ? { value: activeTab, onValueChange: onTabChange }
      : { defaultValue: 'rfi' }

  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Open RFI</p>
          <p className='text-2xl font-bold'>{metrics?.rfiOpen ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Overdue RFI</p>
          <p className='text-2xl font-bold'>{metrics?.rfiOverdue ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Pending Submittal</p>
          <p className='text-2xl font-bold'>{metrics?.submittalPending ?? 0}</p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Pending Ack</p>
          <p className='text-2xl font-bold'>
            {metrics?.transmittalPendingAck ?? 0}
          </p>
        </div>
        <div className='rounded border p-3'>
          <p className='text-xs text-muted-foreground'>Notices</p>
          <p className='text-2xl font-bold'>
            {metrics?.contractualNotices ?? 0}
          </p>
        </div>
      </div>

      <Tabs {...tabsProps} className='space-y-3'>
        {showTabList && (
          <TabsList className='flex-wrap'>
            <TabsTrigger value='rfi'>RFI</TabsTrigger>
            <TabsTrigger value='submittals'>Submittals</TabsTrigger>
            <TabsTrigger value='drawings'>Drawings</TabsTrigger>
            <TabsTrigger value='transmittals'>Transmittals</TabsTrigger>
            <TabsTrigger value='correspondence'>Correspondence</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value='rfi' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='RFI subject'
              value={rfiSubject}
              onChange={(e) => setRfiSubject(e.target.value)}
            />
            <Button
              disabled={createRfi.isPending || !rfiSubject}
              onClick={async () => {
                try {
                  await createRfi.mutateAsync({ subject: rfiSubject })
                  setRfiSubject('')
                  toast.success('RFI created')
                } catch {
                  toast.error('Failed to create RFI')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {rfis?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.subject} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='submittals' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Submittal title'
              value={submittalTitle}
              onChange={(e) => setSubmittalTitle(e.target.value)}
            />
            <Button
              disabled={createSubmittal.isPending || !submittalTitle}
              onClick={async () => {
                try {
                  await createSubmittal.mutateAsync({ title: submittalTitle })
                  setSubmittalTitle('')
                  toast.success('Submittal created')
                } catch {
                  toast.error('Failed to create submittal')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {submittals?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.title} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='drawings' className='space-y-2'>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
            <Input
              placeholder='Drawing no'
              value={drawingNumber}
              onChange={(e) => setDrawingNumber(e.target.value)}
            />
            <Input
              placeholder='Drawing title'
              value={drawingTitle}
              onChange={(e) => setDrawingTitle(e.target.value)}
            />
            <Button
              disabled={
                createDrawing.isPending || !drawingNumber || !drawingTitle
              }
              onClick={async () => {
                try {
                  await createDrawing.mutateAsync({
                    drawingNumber,
                    title: drawingTitle,
                  })
                  setDrawingNumber('')
                  setDrawingTitle('')
                  toast.success('Drawing created')
                } catch {
                  toast.error('Failed to create drawing')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {drawings?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> -{' '}
                {row.drawingNumber} / {row.title} ({row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='transmittals' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Transmittal subject'
              value={transmittalSubject}
              onChange={(e) => setTransmittalSubject(e.target.value)}
            />
            <Button
              disabled={createTransmittal.isPending || !transmittalSubject}
              onClick={async () => {
                try {
                  await createTransmittal.mutateAsync({
                    subject: transmittalSubject,
                    sender: 'PM Team',
                    recipient: 'Consultant',
                  })
                  setTransmittalSubject('')
                  toast.success('Transmittal created')
                } catch {
                  toast.error('Failed to create transmittal')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {transmittals?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.subject} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value='correspondence' className='space-y-2'>
          <div className='flex gap-2'>
            <Input
              placeholder='Correspondence subject'
              value={correspondenceSubject}
              onChange={(e) => setCorrespondenceSubject(e.target.value)}
            />
            <Button
              disabled={
                createCorrespondence.isPending || !correspondenceSubject
              }
              onClick={async () => {
                try {
                  await createCorrespondence.mutateAsync({
                    direction: 'outgoing',
                    type: 'letter',
                    subject: correspondenceSubject,
                  })
                  setCorrespondenceSubject('')
                  toast.success('Correspondence created')
                } catch {
                  toast.error('Failed to create correspondence')
                }
              }}
            >
              Add
            </Button>
          </div>
          <ul className='rounded border p-2 text-sm'>
            {correspondence?.rows.map((row) => (
              <li key={row.id} className='border-b p-2 last:border-b-0'>
                <span className='font-medium'>{row.ref}</span> - {row.subject} (
                {row.status})
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  )
}
