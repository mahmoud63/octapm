import { Navigate } from '@tanstack/react-router'
import { useIsCompanyAdmin } from '@/lib/permissions'
import { PermissionTemplatesPage } from '@/features/permissions/components/permission-templates-page'
import { ContentSection } from '../components/content-section'

export function SettingsPermissions() {
  const canManage = useIsCompanyAdmin()
  if (!canManage) {
    return <Navigate to='/settings' replace />
  }

  return (
    <ContentSection
      title='Permissions'
      desc='Templates decide what each person can see and do on a project. Assign them per project from the Team module.'
    >
      <PermissionTemplatesPage />
    </ContentSection>
  )
}
