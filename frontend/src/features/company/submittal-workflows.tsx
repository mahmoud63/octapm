import { SubmittalWorkflowList } from '@/features/doc-control/components/submittal-workflow-editor'
import { CompanySection } from './components/company-section'

/** Company library of submittal review workflows. */
export function CompanySubmittalWorkflows() {
  return (
    <CompanySection
      title='Submittal review workflows'
      description='Review routes every project can put its submittals through: ordered steps, each with reviewers (people, a party, or a role), days allowed and whether one or all must approve.'
    >
      <SubmittalWorkflowList projectId={null} canEdit />
    </CompanySection>
  )
}
