import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useUpdateDailyLogSettings,
  type DailyLogSection,
  type DailyLogSettings,
} from '../hooks/use-daily-log'

const ROLE_LABEL: Record<string, string> = {
  pm: 'Project manager',
  planning_eng: 'Planning engineer',
  qs: 'Quantity surveyor',
  cost_controller: 'Cost controller',
  site_engineer: 'Site engineer',
  finance: 'Finance',
  procurement: 'Procurement',
  warehouse: 'Warehouse',
}

const timezones = (): string[] => {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[]
  }
  try {
    return intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

const numberOrNull = (value: string) =>
  value.trim() === '' ? null : Number(value)

/** Site coordinates, weather thresholds and the evening distribution list. */
export function DailyLogSettingsDialog({
  settings,
  open,
  onOpenChange,
}: {
  settings: DailyLogSettings
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateDailyLogSettings(settings.projectId)
  const [latitude, setLatitude] = useState(
    settings.latitude === null ? '' : String(settings.latitude)
  )
  const [longitude, setLongitude] = useState(
    settings.longitude === null ? '' : String(settings.longitude)
  )
  const [timezone, setTimezone] = useState(settings.timezone ?? '')
  const [feedEnabled, setFeedEnabled] = useState(settings.weatherFeedEnabled)
  const [thresholds, setThresholds] = useState({
    rainMm:
      settings.thresholds.rainMm === null
        ? ''
        : String(settings.thresholds.rainMm),
    tempMinC:
      settings.thresholds.tempMinC === null
        ? ''
        : String(settings.thresholds.tempMinC),
    tempMaxC:
      settings.thresholds.tempMaxC === null
        ? ''
        : String(settings.thresholds.tempMaxC),
    windKph:
      settings.thresholds.windKph === null
        ? ''
        : String(settings.thresholds.windKph),
  })
  const [roles, setRoles] = useState<string[]>(settings.distributionRoles)
  const [emails, setEmails] = useState(settings.distributionEmails.join('\n'))
  const [autoAt, setAutoAt] = useState(settings.autoDistributeAt ?? '')
  const [copySections, setCopySections] = useState<DailyLogSection[]>(
    settings.copySections
  )
  const zones = timezones()

  const toggle = (list: string[], value: string) =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'
        data-testid='uat-dailylog-settings'
      >
        <DialogHeader>
          <DialogTitle>Daily log settings</DialogTitle>
          <DialogDescription>
            Where the site is (for the weather feed), what counts as a weather
            alert, and who gets the evening PDF.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-5'>
          <section className='space-y-2'>
            <p className='text-sm font-medium'>Site location</p>
            <div className='grid gap-3 sm:grid-cols-3'>
              <div className='space-y-1'>
                <Label htmlFor='dl-lat'>Latitude</Label>
                <Input
                  id='dl-lat'
                  type='number'
                  step='0.0001'
                  min={-90}
                  max={90}
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder='24.7136'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='dl-lng'>Longitude</Label>
                <Input
                  id='dl-lng'
                  type='number'
                  step='0.0001'
                  min={-180}
                  max={180}
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder='46.6753'
                />
              </div>
              <div className='space-y-1'>
                <Label htmlFor='dl-tz'>Time zone</Label>
                <Input
                  id='dl-tz'
                  list='dl-tz-options'
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder='Asia/Riyadh'
                />
                {zones.length > 0 && (
                  <datalist id='dl-tz-options'>
                    {zones.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                )}
              </div>
            </div>
            <div className='flex items-center gap-2'>
              <Switch
                id='dl-feed'
                checked={feedEnabled}
                onCheckedChange={setFeedEnabled}
                disabled={!settings.weatherFeedAvailable}
              />
              <Label htmlFor='dl-feed' className='text-sm'>
                Fill weather automatically from the feed
                {!settings.weatherFeedAvailable && (
                  <span className='ml-1 text-xs text-muted-foreground'>
                    (switched off on the server)
                  </span>
                )}
              </Label>
            </div>
          </section>

          <section className='space-y-2'>
            <p className='text-sm font-medium'>Weather alert thresholds</p>
            <p className='text-xs text-muted-foreground'>
              A day that reaches any of these gets a suggested weather delay for
              the site team to confirm. Leave a field empty to ignore it.
            </p>
            <div className='grid gap-3 sm:grid-cols-4'>
              {(
                [
                  ['rainMm', 'Rain ≥ mm'],
                  ['tempMinC', 'Low ≤ °C'],
                  ['tempMaxC', 'High ≥ °C'],
                  ['windKph', 'Wind ≥ km/h'],
                ] as const
              ).map(([field, label]) => (
                <div key={field} className='space-y-1'>
                  <Label htmlFor={`dl-${field}`}>{label}</Label>
                  <Input
                    id={`dl-${field}`}
                    type='number'
                    step='0.1'
                    value={thresholds[field]}
                    onChange={(e) =>
                      setThresholds({ ...thresholds, [field]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          <section className='space-y-2'>
            <p className='text-sm font-medium'>Distribution</p>
            <div className='grid gap-2 sm:grid-cols-2'>
              {settings.distributionRoleOptions.map((role) => (
                <label key={role} className='flex items-center gap-2 text-sm'>
                  <Checkbox
                    checked={roles.includes(role)}
                    onCheckedChange={() => setRoles(toggle(roles, role))}
                  />
                  {ROLE_LABEL[role] ?? role}
                </label>
              ))}
            </div>
            <div className='space-y-1'>
              <Label htmlFor='dl-emails'>
                External addresses (client, consultant) — one per line
              </Label>
              <Textarea
                id='dl-emails'
                rows={3}
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder='client@example.com'
              />
              <p className='text-xs text-muted-foreground'>
                External readers get a plain-text digest of the day; the PDF is
                filed on the log for anyone with access.
              </p>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1'>
                <Label htmlFor='dl-auto'>
                  Send automatically at (site time)
                </Label>
                <Input
                  id='dl-auto'
                  type='time'
                  value={autoAt}
                  onChange={(e) => setAutoAt(e.target.value)}
                />
                <p className='text-xs text-muted-foreground'>
                  Leave empty to send by hand only.
                </p>
              </div>
              <div className='space-y-1'>
                <Label>Copy previous day brings</Label>
                <div className='flex gap-4 pt-2 text-sm'>
                  {(['manpower', 'equipment'] as DailyLogSection[]).map(
                    (section) => (
                      <label key={section} className='flex items-center gap-2'>
                        <Checkbox
                          checked={copySections.includes(section)}
                          onCheckedChange={() =>
                            setCopySections(
                              toggle(copySections, section) as DailyLogSection[]
                            )
                          }
                        />
                        {section === 'manpower' ? 'Manpower' : 'Equipment'}
                      </label>
                    )
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={update.isPending}
            data-testid='uat-dailylog-settings-save'
            onClick={async () => {
              try {
                await update.mutateAsync({
                  latitude: numberOrNull(latitude),
                  longitude: numberOrNull(longitude),
                  timezone: timezone.trim() || null,
                  weatherFeedEnabled: feedEnabled,
                  thresholds: {
                    rainMm: numberOrNull(thresholds.rainMm),
                    tempMinC: numberOrNull(thresholds.tempMinC),
                    tempMaxC: numberOrNull(thresholds.tempMaxC),
                    windKph: numberOrNull(thresholds.windKph),
                  },
                  distributionRoles: roles,
                  distributionEmails: emails
                    .split(/[\n,;]+/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                  autoDistributeAt: autoAt || null,
                  copySections,
                })
                toast.success('Daily log settings saved')
                onOpenChange(false)
              } catch (error) {
                toast.error(getServerErrorMessage(error))
              }
            }}
          >
            {update.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
