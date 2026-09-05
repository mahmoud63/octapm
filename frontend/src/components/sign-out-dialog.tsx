import { useState } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { logout } from '@/services/auth/api'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { clearOfflineData } from '@/lib/offline/outbox'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { auth } = useAuthStore()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await logout()
      auth.reset()
      // Offline caches and the outbox belong to the signed-in user.
      void clearOfflineData()
      onOpenChange(false)

      // Preserve current location for redirect after sign-in
      const currentPath = location.href
      navigate({
        to: '/sign-in',
        search: { redirect: currentPath },
        replace: true,
      })
    } catch {
      toast.error('Unable to sign out. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title='Sign out'
      desc='Are you sure you want to sign out? You will need to sign in again to access your account.'
      confirmText='Sign out'
      destructive
      handleConfirm={() => {
        void handleSignOut()
      }}
      isLoading={isSigningOut}
      className='sm:max-w-sm'
    />
  )
}
