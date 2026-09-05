import { CustomFieldsAdmin } from '@/features/custom-fields/components/custom-fields-admin'
import { CompanySection } from './components/company-section'

/** Company library of custom fields, fieldsets and record types. */
export function CompanyCustomFields() {
  return (
    <CompanySection
      title='Custom fields'
      description='Extra fields on RFIs, submittals, change orders, correspondence and other records — shown on every project, validated on save, available in reports and workflow rules. Fieldsets choose which fields a project or record type shows.'
    >
      <CustomFieldsAdmin projectId={null} />
    </CompanySection>
  )
}
