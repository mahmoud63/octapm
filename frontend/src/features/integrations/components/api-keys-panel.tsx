import { useState } from 'react'
import { Copy, KeyRound, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
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
import { useProjects } from '@/features/projects/hooks/use-projects'
import {
  useApiClients,
  useApiScopes,
  useCreateApiClient,
  useRevokeApiClient,
  type ApiClientRecord,
} from '../hooks/use-integrations'

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—'

const copy = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  } catch {
    toast.error('Copy failed — select the text and copy it by hand')
  }
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (client: ApiClientRecord) => void
}) {
  const { data: scopeData } = useApiScopes()
  const { data: projects } = useProjects()
  const create = useCreateApiClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scopes, setScopes] = useState<Set<string>>(new Set(['*:read']))
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set())
  const [expiresAt, setExpiresAt] = useState('')
  const [limitProjects, setLimitProjects] = useState(false)
  const modules = (scopeData?.scopes ?? []).filter(
    (scope) => scope.module !== '*'
  )
  const grouped = new Map<
    string,
    { label: string; read: string; write: string }
  >()
  for (const scope of modules) {
    const entry = grouped.get(scope.module) ?? {
      label: scope.label.split(' — ')[0],
      read: '',
      write: '',
    }
    if (scope.access === 'read') entry.read = scope.scope
    else entry.write = scope.scope
    grouped.set(scope.module, entry)
  }
  const toggle = (scope: string, on: boolean) =>
    setScopes((prev) => {
      const next = new Set(prev)
      if (on) next.add(scope)
      else next.delete(scope)
      return next
    })

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Give the key a name')
      return
    }
    if (scopes.size === 0) {
      toast.error('Pick at least one scope')
      return
    }
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        scopes: [...scopes],
        projectIds: limitProjects ? [...projectIds] : [],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      })
      onCreated(created)
      onOpenChange(false)
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>New API key</DialogTitle>
          <DialogDescription>
            The key acts as you, limited to the scopes below. Reads cover
            listing and exports; writes cover create, update, submit, approve
            and delete.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label htmlFor='key-name'>Name</Label>
              <Input
                id='key-name'
                data-testid='uat-api-key-name'
                placeholder='ERP sync'
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className='space-y-1'>
              <Label htmlFor='key-expires'>Expires (optional)</Label>
              <Input
                id='key-expires'
                type='date'
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
          </div>
          <div className='space-y-1'>
            <Label htmlFor='key-description'>What it is for</Label>
            <Input
              id='key-description'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>Scopes</Label>
            <div className='flex flex-wrap gap-4 rounded-md border p-2 text-sm'>
              <label className='flex items-center gap-1.5'>
                <Checkbox
                  checked={scopes.has('*:read')}
                  onCheckedChange={(state) => toggle('*:read', state === true)}
                  data-testid='uat-api-scope-all-read'
                />
                Read everything
              </label>
              <label className='flex items-center gap-1.5'>
                <Checkbox
                  checked={scopes.has('*:write')}
                  onCheckedChange={(state) => toggle('*:write', state === true)}
                />
                Read & write everything
              </label>
            </div>
            <div className='grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2 text-xs sm:grid-cols-2'>
              {[...grouped.entries()].map(([module, entry]) => (
                <div
                  key={module}
                  className='flex items-center justify-between gap-2 px-1 py-0.5'
                >
                  <span className='truncate'>{entry.label}</span>
                  <span className='flex shrink-0 gap-3'>
                    <label className='flex items-center gap-1'>
                      <Checkbox
                        checked={scopes.has(entry.read)}
                        onCheckedChange={(state) =>
                          toggle(entry.read, state === true)
                        }
                      />
                      read
                    </label>
                    <label className='flex items-center gap-1'>
                      <Checkbox
                        checked={scopes.has(entry.write)}
                        onCheckedChange={(state) =>
                          toggle(entry.write, state === true)
                        }
                      />
                      write
                    </label>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <Switch
              checked={limitProjects}
              onCheckedChange={setLimitProjects}
            />
            Limit to some projects
          </label>
          {limitProjects && (
            <div className='grid max-h-40 gap-1 overflow-y-auto rounded-md border p-2 text-sm sm:grid-cols-2'>
              {(projects?.items ?? []).map((project) => (
                <label key={project.id} className='flex items-center gap-1.5'>
                  <Checkbox
                    checked={projectIds.has(project.id)}
                    onCheckedChange={(state) =>
                      setProjectIds((prev) => {
                        const next = new Set(prev)
                        if (state === true) next.add(project.id)
                        else next.delete(project.id)
                        return next
                      })
                    }
                  />
                  <span className='truncate'>{project.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={create.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type='button'
            disabled={create.isPending}
            data-testid='uat-api-key-create'
            onClick={submit}
          >
            {create.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevealDialog({
  client,
  prefix,
  onClose,
}: {
  client: ApiClientRecord | null
  prefix: string
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(client)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Copy your key now</DialogTitle>
          <DialogDescription>
            This is the only time the full key is shown. Send it as{' '}
            <code>Authorization: Bearer {prefix}…</code>.
          </DialogDescription>
        </DialogHeader>
        <div className='flex items-center gap-2'>
          <Input
            readOnly
            value={client?.token ?? ''}
            data-testid='uat-api-key-token'
            className='font-mono text-xs'
          />
          <Button
            type='button'
            variant='outline'
            size='icon'
            aria-label='Copy key'
            onClick={() => client?.token && copy(client.token)}
          >
            <Copy className='h-4 w-4' />
          </Button>
        </div>
        <DialogFooter>
          <Button type='button' onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Company API keys: list, create (key shown once), revoke. */
export function ApiKeysPanel() {
  const [includeRevoked, setIncludeRevoked] = useState(false)
  const { data: clients = [], isLoading } = useApiClients(includeRevoked)
  const { data: scopeData } = useApiScopes()
  const revoke = useRevokeApiClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [revealed, setRevealed] = useState<ApiClientRecord | null>(null)

  return (
    <div className='space-y-3' data-testid='uat-api-keys'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>
          Keys let other systems call the OctaPM API as the person who created
          them, limited to the scopes and projects chosen. Only the key's prefix
          is kept here.
        </p>
        <div className='flex items-center gap-3'>
          <label className='flex items-center gap-2 text-sm'>
            <Switch
              checked={includeRevoked}
              onCheckedChange={setIncludeRevoked}
            />
            Show revoked
          </label>
          <Button
            size='sm'
            data-testid='uat-api-key-new'
            onClick={() => {
              setNonce((value) => value + 1)
              setCreateOpen(true)
            }}
          >
            <Plus className='mr-1 h-4 w-4' />
            New key
          </Button>
        </div>
      </div>
      {isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : clients.length === 0 ? (
        <p className='rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground'>
          No API keys yet.
        </p>
      ) : (
        <ul className='divide-y rounded-md border'>
          {clients.map((client) => (
            <li
              key={client.id}
              className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
              data-testid='uat-api-key-row'
            >
              <KeyRound className='h-4 w-4 text-muted-foreground' />
              <span className='font-medium'>{client.name}</span>
              <code className='rounded bg-muted px-1 text-xs'>
                {client.keyPrefix}…
              </code>
              {client.status === 'revoked' && (
                <Badge variant='secondary'>Revoked</Badge>
              )}
              {client.expiresAt && new Date(client.expiresAt) < new Date() && (
                <Badge variant='destructive'>Expired</Badge>
              )}
              <span className='text-xs text-muted-foreground'>
                acts as {client.owner.name ?? client.owner.email ?? 'owner'} ·{' '}
                {client.scopes.join(', ')}
                {client.projectIds.length
                  ? ` · ${client.projectIds.length} project${client.projectIds.length === 1 ? '' : 's'}`
                  : ''}
                {' · '}last used {formatDate(client.lastUsedAt)}
              </span>
              {client.status === 'active' && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='ml-auto'
                  disabled={revoke.isPending}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Revoke "${client.name}"? Anything using it stops working at once.`
                      )
                    )
                      return
                    try {
                      await revoke.mutateAsync(client.id)
                      toast.success('Key revoked')
                    } catch (error) {
                      toast.error(getServerErrorMessage(error))
                    }
                  }}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {createOpen && (
        <CreateKeyDialog
          key={nonce}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(client) => {
            toast.success('Key created')
            setRevealed(client)
          }}
        />
      )}
      <RevealDialog
        client={revealed}
        prefix={scopeData?.prefix ?? 'octapm_'}
        onClose={() => setRevealed(null)}
      />
    </div>
  )
}
