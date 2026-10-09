import { useEffect, useState } from 'react'
import { Copy, Loader2, PlugZap, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PasswordInput } from '@/components/password-input'
import { CompanySection } from './components/company-section'
import {
  useCompanySecurity,
  useResetUserMfa,
  useTestSso,
  useUpdateSso,
  type SsoTestResult,
} from './hooks/use-security'

/** Company › Security: single sign-on, the two-factor policy and every user's status. */
export function CompanySecurity() {
  const { data, isLoading } = useCompanySecurity()
  const update = useUpdateSso()
  const test = useTestSso()
  const reset = useResetUserMfa()
  const [form, setForm] = useState({
    enabled: false,
    issuer: '',
    clientId: '',
    clientSecret: '',
    domains: '',
    required: false,
    mfaRequired: false,
  })
  const [dirty, setDirty] = useState(false)
  const [testResult, setTestResult] = useState<SsoTestResult | null>(null)

  useEffect(() => {
    if (!data) return
    setForm({
      enabled: data.sso.enabled,
      issuer: data.sso.issuer ?? '',
      clientId: data.sso.clientId ?? '',
      clientSecret: '',
      domains: data.sso.domains.join(', '),
      required: data.sso.required,
      mfaRequired: data.mfaRequired,
    })
    setDirty(false)
  }, [data])

  const set = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        enabled: form.enabled,
        issuer: form.issuer.trim() || null,
        clientId: form.clientId.trim() || null,
        clientSecret: form.clientSecret.trim() || null,
        domains: form.domains
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        // Single sign-on never creates accounts (owner decision D-ID-1):
        // auto-provisioning and its default role are not sent at all.
        required: form.required,
        mfaRequired: form.mfaRequired,
      })
      toast.success('Security settings saved')
    } catch (error) {
      toast.error(getServerErrorMessage(error))
    }
  }

  const runTest = async () => {
    if (dirty) {
      const ok = await save()
        .then(() => true)
        .catch(() => false)
      if (!ok) return
    }
    try {
      setTestResult(await test.mutateAsync())
      toast.success('The identity provider answered')
    } catch (error) {
      setTestResult(null)
      toast.error(getServerErrorMessage(error))
    }
  }

  const copyRedirect = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.sso.redirectUri)
      toast.success('Redirect URI copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  return (
    <CompanySection
      title='Security'
      description='Let people sign in with your identity provider (Microsoft Entra, Okta, Google Workspace, Auth0 — any OpenID Connect provider), decide whether passwords stay allowed, and require a second factor across the organisation.'
      actions={
        <Button
          size='sm'
          disabled={!dirty || update.isPending}
          onClick={save}
          data-testid='uat-security-save'
        >
          {update.isPending ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <Save className='mr-2 h-4 w-4' />
          )}
          Save
        </Button>
      }
    >
      {isLoading || !data ? (
        <p className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading…
        </p>
      ) : (
        <div className='space-y-6' data-testid='uat-company-security'>
          <section className='space-y-4 rounded-md border p-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <div className='min-w-0 flex-1'>
                <p className='font-medium'>Single sign-on (OpenID Connect)</p>
                <p className='text-sm text-muted-foreground'>
                  Register this redirect URI with the provider, then paste the
                  issuer, client id and client secret from the app registration.
                </p>
              </div>
              <label className='flex items-center gap-2 text-sm'>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(value) => set('enabled', value)}
                  data-testid='uat-sso-enabled'
                />{' '}
                Enabled
              </label>
            </div>
            <div className='flex flex-wrap items-center gap-2 rounded bg-muted/50 px-3 py-2 text-xs'>
              <span className='text-muted-foreground'>Redirect URI</span>
              <code className='min-w-0 flex-1 truncate'>
                {data.sso.redirectUri}
              </code>
              <Button
                size='sm'
                variant='ghost'
                className='h-7'
                onClick={copyRedirect}
              >
                <Copy className='h-3.5 w-3.5' />
              </Button>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1 sm:col-span-2'>
                <Label>Issuer URL</Label>
                <Input
                  value={form.issuer}
                  onChange={(event) => set('issuer', event.target.value)}
                  placeholder='https://login.microsoftonline.com/<tenant>/v2.0'
                  data-testid='uat-sso-issuer'
                />
                <p className='text-xs text-muted-foreground'>
                  The provider publishes its endpoints at
                  &lt;issuer&gt;/.well-known/openid-configuration.
                </p>
              </div>
              <div className='space-y-1'>
                <Label>Client id</Label>
                <Input
                  value={form.clientId}
                  onChange={(event) => set('clientId', event.target.value)}
                  data-testid='uat-sso-client-id'
                />
              </div>
              <div className='space-y-1'>
                <Label>
                  Client secret{' '}
                  {data.sso.clientSecretSet ? (
                    <Badge variant='outline' className='ml-1'>
                      set
                    </Badge>
                  ) : null}
                </Label>
                <PasswordInput
                  value={form.clientSecret}
                  onChange={(event) => set('clientSecret', event.target.value)}
                  placeholder={
                    data.sso.clientSecretSet
                      ? 'Leave blank to keep the current secret'
                      : ''
                  }
                />
              </div>
              <div className='space-y-1 sm:col-span-2'>
                <Label>Email domains</Label>
                <Input
                  value={form.domains}
                  onChange={(event) => set('domains', event.target.value)}
                  placeholder='constech.ae, constech.com'
                  data-testid='uat-sso-domains'
                />
                <p className='text-xs text-muted-foreground'>
                  People with these email domains see the SSO button on the
                  sign-in page.
                </p>
              </div>
              <div className='space-y-3 sm:col-span-2'>
                <p
                  className='text-xs text-muted-foreground'
                  data-testid='uat-sso-invitation-note'
                >
                  Single sign-on never creates accounts. People join by
                  invitation from People; once they have accepted, they can
                  sign in with SSO.
                </p>
                <label className='flex items-center gap-2 text-sm'>
                  <Switch
                    checked={form.required}
                    onCheckedChange={(value) => set('required', value)}
                    data-testid='uat-sso-required'
                  />{' '}
                  SSO only for these domains (company admins keep their
                  password)
                </label>
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={!form.issuer.trim() || test.isPending}
                onClick={runTest}
                data-testid='uat-sso-test'
              >
                {test.isPending ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <PlugZap className='mr-2 h-4 w-4' />
                )}
                Test connection
              </Button>
              {testResult && (
                <span className='text-xs text-muted-foreground'>
                  {testResult.issuer} · PKCE{' '}
                  {testResult.codeChallengeMethods.includes('S256')
                    ? 'S256 ✓'
                    : 'S256 not listed'}{' '}
                  · scopes {testResult.scopes.slice(0, 6).join(', ')}
                </span>
              )}
            </div>
          </section>

          <section className='space-y-2 rounded-md border p-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <div className='min-w-0 flex-1'>
                <p className='font-medium'>Two-factor authentication</p>
                <p className='text-sm text-muted-foreground'>
                  {data.summary.mfaEnabled} of {data.summary.users} people have
                  a second factor. Requiring it asks everyone else to enrol at
                  their next sign-in and stops them turning it off.
                </p>
              </div>
              <label className='flex items-center gap-2 text-sm'>
                <Switch
                  checked={form.mfaRequired}
                  onCheckedChange={(value) => set('mfaRequired', value)}
                  data-testid='uat-mfa-required'
                />{' '}
                Required for everyone
              </label>
            </div>
          </section>

          <section className='space-y-2'>
            <p className='font-medium'>People</p>
            <div className='overflow-x-auto rounded-md border'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/50 text-xs text-muted-foreground'>
                  <tr>
                    <th className='px-2 py-1 text-left'>Name</th>
                    <th className='px-2 py-1 text-left'>Email</th>
                    <th className='px-2 py-1 text-left'>Role</th>
                    <th className='px-2 py-1 text-left'>Two-factor</th>
                    <th className='px-2 py-1 text-left'>SSO</th>
                    <th className='px-2 py-1 text-left'>Last sign-in</th>
                    <th className='px-2 py-1' />
                  </tr>
                </thead>
                <tbody data-testid='uat-security-users'>
                  {data.users.map((user) => (
                    <tr key={user.id} className='border-t'>
                      <td className='px-2 py-1'>
                        {user.name}
                        {user.isCompanyAdmin ? (
                          <Badge variant='outline' className='ml-1 text-[10px]'>
                            admin
                          </Badge>
                        ) : null}
                      </td>
                      <td className='px-2 py-1 text-xs'>{user.email}</td>
                      <td className='px-2 py-1 text-xs'>{user.role}</td>
                      <td className='px-2 py-1'>
                        <Badge
                          variant='outline'
                          className={
                            user.mfaEnabled
                              ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                              : ''
                          }
                        >
                          {user.mfaEnabled ? 'on' : 'off'}
                        </Badge>
                      </td>
                      <td className='px-2 py-1'>
                        <Badge variant='outline'>
                          {user.ssoLinked ? 'linked' : '—'}
                        </Badge>
                      </td>
                      <td className='px-2 py-1 text-xs text-muted-foreground'>
                        {user.lastLogin
                          ? new Date(user.lastLogin).toLocaleString()
                          : '—'}
                      </td>
                      <td className='px-2 py-1 text-right'>
                        {user.mfaEnabled && (
                          <Button
                            size='sm'
                            variant='ghost'
                            className='h-7'
                            disabled={reset.isPending}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Reset two-factor for ${user.name}? They will enrol again at their next sign-in.`
                                )
                              )
                                return
                              reset.mutate(user.id, {
                                onSuccess: () =>
                                  toast.success('Second factor reset'),
                                onError: (error) =>
                                  toast.error(getServerErrorMessage(error)),
                              })
                            }}
                            data-testid='uat-mfa-reset'
                          >
                            <RotateCcw className='mr-1 h-3.5 w-3.5' /> Reset 2FA
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </CompanySection>
  )
}
