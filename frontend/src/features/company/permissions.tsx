import { PermissionTemplatesPage } from '@/features/permissions/components/permission-templates-page'
import { CompanySection } from './components/company-section'

export function CompanyPermissions() {
  return (
    <CompanySection
      title='Permissions'
      description='Permission templates decide what each person can see and do on a project. Assign them per project from the Team module.'
    >
      <PermissionTemplatesPage />
    </CompanySection>
  )
}
