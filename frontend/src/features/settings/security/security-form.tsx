import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  disableMfa,
  enableMfa,
  getMfaStatus,
  regenerateMfaBackupCodes,
  startMfaSetup,
} from '@/services/auth/api'
import type { MfaSetup } from '@/services/auth/types'
import { Copy, KeyRound, Loader2, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { getServerErrorMessage } from '@/lib/handle-server-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/password-input'

const MFA_KEY = ['auth', 'mfa-status'] as const

function CodeInput({
  value,
  onChange,
  onComplete,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: () => void
}) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
    >
      <InputOTPGroup>
        <InputOTPSlot index={0} />
        <InputOTPSlot index={1} />
        <InputOTPSlot index={2} />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot index={3} />
        <InputOTPSlot index={4} />
        <InputOTPSlot index={5} />
      </InputOTPGroup>
    </InputOTP>
  )
}

function BackupCodes({
  codes,
  onDone,
}: {
  codes: string[]
  onDone: () => void
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      toast.success('Backup codes copied')
    } catch {
      toast.error('Copy failed — select the codes and copy them by hand')
    }
  }
  return (
    <div
      className='space-y-3 rounded-md border p-4'
      data-testid='uat-mfa-backup-codes'
    >
      <div>
        <p className='font-medium'>Your backup codes</p>
        <p className='text-sm text-muted-foreground'>
          Each code signs you in once if you lose your phone. Store them
          somewhere safe — they are shown only now.
        </p>
      </div>
      <div className='grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5'>
        {codes.map((code) => (
          <span key={code} className='rounded bg-muted px-2 py-1 text-center'>
            {code}
          </span>
        ))}
      </div>
      <div className='flex gap-2'>
        <Button size='sm' variant='outline' onClick={copy}>
          <Copy className='mr-2 h-4 w-4' /> Copy
        </Button>
        <Button size='sm' onClick={onDone} data-testid='uat-mfa-codes-done'>
          I have saved them
        </Button>
      </div>
    </div>
  )
}

/** Enrol, confirm, manage backup codes and turn two-factor off. */
export function SecurityForm() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: MFA_KEY,
    queryFn: getMfaStatus,
  })
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [disabling, setDisabling] = useState(false)
  const [password, setPassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [regenCode, setRegenCode] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: MFA_KEY })
  const start = useMutation({
    mutationFn: startMfaSetup,
    onSuccess: (result) => {
      setSetup(result)
      setCode('')
    },
    onError: (error) => toast.error(getServerErrorMessage(error)),
  })
  const enable = useMutation({
    mutationFn: enableMfa,
    onSuccess: (result) => {
      setSetup(null)
      setBackupCodes(result.backupCodes)
      invalidate()
      qc.invalidateQueries({ queryKey: ['auth'] })
      toast.success('Two-factor authentication is on')
    },
    onError: (error) => toast.error(getServerErrorMessage(error)),
  })
  const disable = useMutation({
    mutationFn: disableMfa,
    onSuccess: () => {
      setDisabling(false)
      setPassword('')
      setDisableCode('')
      invalidate()
      toast.success('Two-factor authentication is off')
    },
    onError: (error) => toast.error(getServerErrorMessage(error)),
  })
  const regenerate = useMutation({
    mutationFn: regenerateMfaBackupCodes,
    onSuccess: (result) => {
      setBackupCodes(result.backupCodes)
      setRegenCode('')
      invalidate()
    },
    onError: (error) => toast.error(getServerErrorMessage(error)),
  })

  if (isLoading || !status) {
    return (
      <p className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' /> Loading…
      </p>
    )
  }

  if (backupCodes)
    return (
      <BackupCodes codes={backupCodes} onDone={() => setBackupCodes(null)} />
    )

  return (
    <div className='space-y-6' data-testid='uat-security-form'>
      <div className='flex flex-wrap items-center gap-3 rounded-md border p-4'>
        {status.enabled ? (
          <ShieldCheck className='h-6 w-6 text-emerald-600' />
        ) : (
          <ShieldOff className='h-6 w-6 text-muted-foreground' />
        )}
        <div className='min-w-0 flex-1'>
          <p className='font-medium'>
            Two-factor authentication{' '}
            <Badge variant='outline' className='ml-1'>
              {status.enabled ? 'on' : 'off'}
            </Badge>
          </p>
          <p className='text-sm text-muted-foreground'>
            {status.enabled
              ? `Enrolled ${status.enrolledAt ? new Date(status.enrolledAt).toLocaleDateString() : ''} · ${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? '' : 's'} left`
              : 'Sign-ins ask for a code from your authenticator app after the password.'}
          </p>
          {status.enrollmentRequired && (
            <p className='mt-1 text-sm text-amber-700 dark:text-amber-300'>
              Your organisation requires two-factor authentication — set it up
              now.
            </p>
          )}
          {status.ssoLinked && (
            <p className='mt-1 text-xs text-muted-foreground'>
              You also sign in with single sign-on; your identity provider
              handles its own second factor.
            </p>
          )}
        </div>
        {!status.enabled && !setup && (
          <Button
            onClick={() => start.mutate()}
            disabled={start.isPending}
            data-testid='uat-mfa-setup'
          >
            {start.isPending ? (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            ) : (
              <KeyRound className='mr-2 h-4 w-4' />
            )}
            Set up
          </Button>
        )}
      </div>

      {setup && (
        <div
          className='space-y-3 rounded-md border p-4'
          data-testid='uat-mfa-enrol'
        >
          <p className='font-medium'>
            1 · Scan the code with your authenticator app
          </p>
          <p className='text-sm text-muted-foreground'>
            Google Authenticator, Microsoft Authenticator, 1Password, Authy… If
            you cannot scan, enter the key by hand.
          </p>
          <div className='flex flex-wrap items-start gap-4'>
            <div
              className='h-44 w-44 rounded bg-white p-1 [&>svg]:h-full [&>svg]:w-full'
              // The SVG is generated by our own server from the otpauth URL.
              dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
            />
            <div className='space-y-1 text-sm'>
              <p className='text-muted-foreground'>Account</p>
              <p>
                {setup.issuer} · {setup.account}
              </p>
              <p className='text-muted-foreground'>Key</p>
              <p className='font-mono break-all'>
                {setup.secret.match(/.{1,4}/g)?.join(' ')}
              </p>
            </div>
          </div>
          <p className='font-medium'>
            2 · Enter the 6-digit code the app shows
          </p>
          <div className='flex flex-wrap items-center gap-3'>
            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={() => enable.mutate(code)}
            />
            <Button
              disabled={code.length < 6 || enable.isPending}
              onClick={() => enable.mutate(code)}
              data-testid='uat-mfa-enable'
            >
              {enable.isPending && (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              )}
              Turn on
            </Button>
            <Button variant='ghost' onClick={() => setSetup(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status.enabled && (
        <div className='space-y-4'>
          <div className='space-y-2 rounded-md border p-4'>
            <p className='font-medium'>Backup codes</p>
            <p className='text-sm text-muted-foreground'>
              Generate a fresh set of ten codes; the old ones stop working.
              Enter a current code from the app to confirm.
            </p>
            <div className='flex flex-wrap items-center gap-3'>
              <CodeInput value={regenCode} onChange={setRegenCode} />
              <Button
                variant='outline'
                disabled={regenCode.length < 6 || regenerate.isPending}
                onClick={() => regenerate.mutate(regenCode)}
                data-testid='uat-mfa-regenerate'
              >
                {regenerate.isPending && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                New backup codes
              </Button>
            </div>
          </div>
          <div className='space-y-2 rounded-md border p-4'>
            <p className='font-medium'>Turn off two-factor authentication</p>
            {status.required && (
              <p className='text-sm text-amber-700 dark:text-amber-300'>
                Your organisation requires it — a company admin can reset it if
                you lose your device.
              </p>
            )}
            {disabling ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='space-y-1'>
                  <Label>Password</Label>
                  <PasswordInput
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                <div className='space-y-1'>
                  <Label>Code from the app or a backup code</Label>
                  <Input
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                    placeholder='123456 or xxxx-xxxx'
                  />
                </div>
                <div className='flex gap-2 sm:col-span-2'>
                  <Button
                    variant='destructive'
                    disabled={
                      !password || disableCode.length < 6 || disable.isPending
                    }
                    onClick={() =>
                      disable.mutate({ password, code: disableCode })
                    }
                    data-testid='uat-mfa-disable-confirm'
                  >
                    {disable.isPending && (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    )}
                    Turn off
                  </Button>
                  <Button variant='ghost' onClick={() => setDisabling(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant='outline'
                onClick={() => setDisabling(true)}
                data-testid='uat-mfa-disable'
              >
                <ShieldOff className='mr-2 h-4 w-4' /> Turn off…
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
